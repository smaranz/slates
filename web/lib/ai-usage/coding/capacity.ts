import "server-only";

import fs from "node:fs";
import path from "node:path";

import { USAGE_DIR } from "../store";
import { calibrationFor } from "./antigravity";
import type { AccountLimits, AccountRow, CodingRequest, LimitWindow } from "./types";
import { tokensOf } from "./types";

/**
 * How much each plan could do in a month if every window were used to the top.
 *
 * A limit window reports how full it is, and the logs say what was spent since
 * it opened. Dividing one by the other sizes a full window; times the number
 * of such windows in a month, that's what the window allows. The tightest
 * window is the plan's real ceiling — five-hour windows usually allow more
 * than the weekly one lets you keep up.
 *
 * Numbers from a nearly empty window are noise, so the best reading seen so
 * far (the one taken with the most of the window used) is kept on disk and
 * reused until a fuller one comes along.
 */

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const FILE = path.join(USAGE_DIR, "capacity.json");
/** Below this, a window says more about rounding than about the plan. */
const MIN_PCT = 3;
const STALE_MS = 21 * 24 * 60 * 60 * 1000;
/**
 * Meters count use from anywhere — claude.ai, another computer — but the logs
 * only see this Mac. A window with barely any logged spend behind its percent
 * was mostly filled elsewhere and would size the plan absurdly small.
 */
const MIN_LOGGED_USD = 0.5;

export interface WindowCapacity {
  id: string;
  label: string;
  usedPct: number;
  windowMs: number;
  perMonth: number;
  /** A full window, estimated. */
  tokens: number;
  usd: number;
  monthTokens: number;
  monthUsd: number;
  /** When this estimate was read, and from how full a window. */
  measuredAt: number;
  measuredPct: number;
  live: boolean;
}

export interface AccountCapacity {
  key: string;
  tool: AccountRow["tool"];
  label: string;
  email: string | null;
  plan: string | null;
  windows: WindowCapacity[];
  /** The binding windows' monthly ceiling (summed across separate quota groups). */
  monthTokens: number | null;
  monthUsd: number | null;
  /** Labels of the windows that set the ceiling — one per quota group. */
  binding: string[];
  used30Tokens: number;
  used30Usd: number;
  note: string | null;
  /** Sized from another plan rather than measured. */
  estimated: boolean;
  /** The home to measure through, for tools that are sized by probing (Antigravity). */
  measureHomeId: string | null;
}

export interface CapacitySnapshot {
  accounts: AccountCapacity[];
  totals: { monthTokens: number; monthUsd: number; used30Tokens: number; used30Usd: number; estimated: number };
}

type Stored = Record<string, Omit<WindowCapacity, "live" | "usedPct">>;

function readStored(): Stored {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8")) as Stored;
  } catch {
    return {};
  }
}

function writeStored(s: Stored): void {
  try {
    fs.mkdirSync(USAGE_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(s));
  } catch {
    // Next time.
  }
}

/** How long a window runs, from its name. Cursor's meters are the billing cycle. */
function windowLength(w: LimitWindow, tool: AccountRow["tool"]): number | null {
  const s = w.label.toLowerCase();
  if (s.includes("5-hour")) return 5 * 60 * 60 * 1000;
  if (s.includes("weekly") || s.includes("7-day")) return 7 * 24 * 60 * 60 * 1000;
  if (s.includes("daily") || s.includes("1-day")) return 24 * 60 * 60 * 1000;
  if (tool === "cursor") return MONTH_MS;
  return null;
}

function sumSince(mine: CodingRequest[], from: number, to: number): { tokens: number; usd: number } {
  let tokens = 0;
  let usd = 0;
  for (const r of mine) {
    if (r.at < from || r.at > to) continue;
    tokens += tokensOf(r);
    usd += r.costUsd;
  }
  return { tokens, usd };
}

/**
 * The window that allows the least in a month is the plan's ceiling. Windows
 * named "<group> · <window>" belong to separate quota groups (Antigravity's
 * Gemini and Claude & GPT pools), each with its own ceiling; those add up.
 */
function ceilings(windows: WindowCapacity[]): WindowCapacity[] {
  const groups = new Map<string, WindowCapacity>();
  for (const w of windows) {
    const g = w.label.includes(" · ") ? w.label.split(" · ")[0]! : "";
    const cur = groups.get(g);
    if (!cur || w.monthUsd < cur.monthUsd) groups.set(g, w);
  }
  return [...groups.values()];
}

export function buildCapacity(
  accounts: AccountRow[],
  limits: Record<string, AccountLimits>,
  reqs: CodingRequest[]
): CapacitySnapshot {
  const stored = readStored();
  let changed = false;
  const now = Date.now();
  const byAccount = new Map<string, CodingRequest[]>();
  for (const r of reqs) {
    let list = byAccount.get(r.accountKey);
    if (!list) byAccount.set(r.accountKey, (list = []));
    list.push(r);
  }

  interface Pending {
    a: AccountRow;
    lim: AccountLimits | undefined;
    windows: WindowCapacity[];
    used30Tokens: number;
    used30Usd: number;
    scaledFrom: string | null;
  }
  const pending: Pending[] = [];

  for (const a of accounts) {
    const lim = limits[a.key];
    if (!lim?.windows.length && !a.canLink) continue;
    const mine = byAccount.get(a.key) ?? [];
    const last30 = sumSince(mine, now - MONTH_MS, now);

    const windows: WindowCapacity[] = [];
    // Antigravity keeps no token counts, but a measuring prompt sized its windows.
    const cal = a.tool === "antigravity" ? calibrationFor(a.key) : null;
    for (const w of cal ? (lim?.windows ?? []) : []) {
      const m = cal!.windows[w.id];
      const length = windowLength(w, a.tool);
      if (!m || !length) continue;
      const perMonth = MONTH_MS / length;
      windows.push({
        id: w.id,
        label: w.label,
        usedPct: w.usedPct,
        windowMs: length,
        perMonth,
        tokens: m.tokens,
        usd: m.usd,
        monthTokens: m.tokens * perMonth,
        monthUsd: m.usd * perMonth,
        measuredAt: m.measuredAt,
        measuredPct: m.deltaPct,
        live: false,
      });
    }
    for (const w of lim?.windows ?? []) {
      if (!a.tracksTokens) continue;
      // Cursor's pool meter covers everything; its $20 and per-bucket meters are slices of it.
      if (a.tool === "cursor" && w.id !== "pool") continue;
      const start = w.startsAt ?? null;
      const length = start && w.resetsAt ? w.resetsAt - start : windowLength(w, a.tool);
      if (!length) continue;
      const storeKey = `${a.key}::${w.id}`;
      const perMonth = MONTH_MS / length;
      // A provider that reports its own spend reports a precise percent too, so a
      // small reading is still a real one.
      const minPct = w.spentUsd != null ? 0.2 : MIN_PCT;
      let live: WindowCapacity | null = null;
      if (w.usedPct >= minPct && w.resetsAt) {
        const from = start ?? w.resetsAt - length;
        const logged = sumSince(mine, from, now);
        const usd = w.spentUsd ?? logged.usd;
        if (logged.tokens > 0 && usd >= MIN_LOGGED_USD) {
          const k = 100 / w.usedPct;
          live = {
            id: w.id,
            label: w.label,
            usedPct: w.usedPct,
            windowMs: length,
            perMonth,
            tokens: logged.tokens * k,
            usd: usd * k,
            monthTokens: logged.tokens * k * perMonth,
            monthUsd: usd * k * perMonth,
            measuredAt: now,
            measuredPct: w.usedPct,
            live: true,
          };
        }
      }
      const prev = stored[storeKey];
      const prevUsable = prev && now - prev.measuredAt < STALE_MS;
      // Keep whichever reading saw more of a window; a fuller window is a better measure.
      if (live && (!prevUsable || live.measuredPct >= prev.measuredPct)) {
        stored[storeKey] = {
          id: live.id,
          label: live.label,
          windowMs: live.windowMs,
          perMonth: live.perMonth,
          tokens: live.tokens,
          usd: live.usd,
          monthTokens: live.monthTokens,
          monthUsd: live.monthUsd,
          measuredAt: live.measuredAt,
          measuredPct: live.measuredPct,
        };
        changed = true;
        windows.push(live);
      } else if (prevUsable) {
        windows.push({ ...prev, label: w.label, usedPct: w.usedPct, perMonth, live: false });
      }
    }
    pending.push({ a, lim, windows, used30Tokens: last30.tokens, used30Usd: last30.usd, scaledFrom: null });
  }

  /*
   * A Claude plan that can't be measured from here — used mostly on claude.ai
   * or another computer — is sized from one that can, by how Anthropic sizes
   * its plans against each other (Team Standard is 1.25× Pro, Max 5× is 5×...).
   */
  const reference = pending
    .filter((p) => p.a.tool === "claude" && p.a.planScale && p.windows.length)
    .sort((x, y) => Math.max(...y.windows.map((w) => w.measuredPct)) - Math.max(...x.windows.map((w) => w.measuredPct)))[0];
  if (reference) {
    for (const p of pending) {
      if (p.a.tool !== "claude" || p.windows.length || !p.a.planScale) continue;
      const ratio = p.a.planScale / reference.a.planScale!;
      for (const rw of reference.windows) {
        const own = p.lim?.windows.find((w) => w.label === rw.label);
        p.windows.push({
          ...rw,
          usedPct: own?.usedPct ?? 0,
          tokens: rw.tokens * ratio,
          usd: rw.usd * ratio,
          monthTokens: rw.monthTokens * ratio,
          monthUsd: rw.monthUsd * ratio,
          live: false,
        });
      }
      p.scaledFrom = `${reference.a.planScaleLabel ?? "Pro"} plan (${reference.a.label}) × ${ratio % 1 ? ratio.toFixed(2) : ratio}`;
    }
  }

  const out: AccountCapacity[] = [];
  for (const { a, lim, windows, used30Tokens, used30Usd, scaledFrom } of pending) {
    const binding = ceilings(windows);
    let monthTokens = binding.length ? binding.reduce((s, w) => s + w.monthTokens, 0) : null;
    let monthUsd = binding.length ? binding.reduce((s, w) => s + w.monthUsd, 0) : null;
    let note: string | null = null;
    if (scaledFrom) {
      note = `Estimated: most of this plan's use isn't logged on this Mac, so it's sized from your ${scaledFrom} (${a.planScaleLabel}).`;
    }
    // A plan did at least what it did: a ceiling below the last 30 days is a
    // young window talking (or extra usage billed past it), so history wins.
    if (monthUsd != null && used30Usd > monthUsd) {
      monthUsd = used30Usd;
      monthTokens = used30Tokens;
      note =
        "Raised to what this plan actually did in the last 30 days — the windows open now suggest less, " +
        "either because they've only just started or because extra usage was billed past them.";
    }
    if (a.tool === "antigravity" && windows.length) {
      note = `Measured by sending one short prompt per model group and reading how far each meter moved (${new Date(
        Math.max(...windows.map((w) => w.measuredAt))
      ).toLocaleDateString(undefined, { month: "short", day: "numeric" })}). Gemini and Claude & GPT are separate pools, so their ceilings add up.`;
    } else if (!a.tracksTokens) {
      note =
        a.tool === "antigravity"
          ? "Not measured yet — Measure sends one short prompt per model group and sizes each window from how far its meter moves."
          : "This tool keeps no token counts on this Mac, so its ceiling can't be measured.";
    } else if (!lim?.windows.length) note = "No plan limits to measure against.";
    else if (!windows.length && !note) {
      note =
        a.tool === "cursor"
          ? "Not measured yet — Cursor's pool meter needs a little spend this cycle first."
          : "Not measured yet — a window has to be partly used by work logged on this Mac before it can be sized. " +
            "Use on claude.ai or another computer moves the meter but isn't in these logs.";
    }
    out.push({
      key: a.key,
      tool: a.tool,
      label: a.label,
      email: a.email,
      plan: a.plan ?? lim?.plan ?? null,
      // Each pool's windows together, shortest first.
      windows: windows.sort(
        (x, y) => (x.label.split(" · ")[0] ?? "").localeCompare(y.label.split(" · ")[0] ?? "") || x.windowMs - y.windowMs
      ),
      monthTokens,
      monthUsd,
      binding: binding.map((w) => w.label),
      used30Tokens,
      used30Usd,
      note,
      estimated: !!scaledFrom,
      measureHomeId: a.tool === "antigravity" ? ((a.homes.find((h) => h.owned) ?? a.homes[0])?.id ?? null) : null,
    });
  }
  if (changed) writeStored(stored);

  const totals = { monthTokens: 0, monthUsd: 0, used30Tokens: 0, used30Usd: 0, estimated: 0 };
  for (const c of out) {
    if (c.monthTokens == null) continue;
    totals.monthTokens += c.monthTokens;
    totals.monthUsd += c.monthUsd ?? 0;
    totals.used30Tokens += c.used30Tokens;
    totals.used30Usd += c.used30Usd;
    totals.estimated += 1;
  }
  out.sort((x, y) => (y.monthUsd ?? -1) - (x.monthUsd ?? -1));
  return { accounts: out, totals };
}
