import "server-only";

import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { planName } from "./accounts";
import type { RawReq } from "./scan";
import type { AccountLimits, LimitWindow } from "./types";

/**
 * Cursor keeps no token counts on disk — per-request usage lives on its
 * dashboard, per account, whichever client (app or cursor-agent) made the
 * call. The Cursor app keeps its session in its own state database, so the
 * account signed into the app can be read the same way cursor.com/dashboard
 * reads it. What we fetch is kept per email, so signing the app into another
 * account once brings that account's history in too.
 *
 * The session token is read here, used for these two calls, and goes nowhere
 * else.
 */

const STATE_DB = path.join(os.homedir(), "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb");
const DASHBOARD = "https://cursor.com/api/dashboard";
const PAGE_SIZE = 100;
const MAX_PAGES = 40;
const HISTORY_MS = 90 * 24 * 60 * 60 * 1000;

export interface CursorSession {
  email: string;
  plan: string | null;
  cookie: string;
}

function sqlite(db: string, sql: string): Promise<Record<string, string>[]> {
  return new Promise((resolve) => {
    execFile("/usr/bin/sqlite3", ["-readonly", "-json", db, sql], { timeout: 8_000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
      if (err || !out.trim()) return resolve([]);
      try {
        resolve(JSON.parse(out) as Record<string, string>[]);
      } catch {
        resolve([]);
      }
    });
  });
}

/** The account signed into the Cursor app, if any. */
export async function appSession(): Promise<CursorSession | null> {
  const rows = await sqlite(
    STATE_DB,
    "select key, value from ItemTable where key in ('cursorAuth/accessToken','cursorAuth/cachedEmail','cursorAuth/stripeMembershipType')"
  );
  const get = (k: string) => rows.find((r) => r.key === k)?.value?.trim() || null;
  const token = get("cursorAuth/accessToken");
  const email = get("cursorAuth/cachedEmail");
  if (!token || !email) return null;
  // The dashboard's session cookie is "<user id>::<access token>"; the id is the token's subject.
  let sub = "";
  try {
    sub = String((JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { sub?: string }).sub ?? "");
  } catch {
    return null;
  }
  const userId = sub.includes("|") ? sub.split("|").pop()! : sub;
  if (!userId) return null;
  return {
    email,
    plan: planName(get("cursorAuth/stripeMembershipType")),
    cookie: `WorkosCursorSessionToken=${userId}%3A%3A${token}`,
  };
}

async function dashboard(session: CursorSession, route: string, body: object): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${DASHBOARD}/${route}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: session.cookie,
      Origin: "https://cursor.com",
      Referer: "https://cursor.com/dashboard",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // leave null
  }
  return { status: res.status, json };
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Usage events since `since`, newest first from the dashboard. Each carries
 * the model, token counts and what Cursor priced it at, in cents.
 */
export async function fetchEvents(session: CursorSession, since: number): Promise<RawReq[] | null> {
  const start = Math.max(since, Date.now() - HISTORY_MS);
  const out: RawReq[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { status, json } = await dashboard(session, "get-filtered-usage-events", {
      teamId: 0,
      startDate: String(start),
      endDate: String(Date.now()),
      page,
      pageSize: PAGE_SIZE,
    });
    if (status !== 200 || !json || typeof json !== "object") {
      if (page === 1) {
        console.warn("[ai-usage] cursor usage events answered", status, json && typeof json === "object" ? Object.keys(json) : null);
        return null;
      }
      break;
    }
    const events = ((json as { usageEventsDisplay?: unknown[] }).usageEventsDisplay ?? []) as Record<string, unknown>[];
    for (const e of events) {
      const at = num(e.timestamp);
      if (!at) continue;
      const t = (e.tokenUsage ?? {}) as Record<string, unknown>;
      const model = String(e.model ?? "cursor");
      const input = num(t.inputTokens);
      const output = num(t.outputTokens);
      const cacheRead = num(t.cacheReadTokens);
      const cacheWrite = num(t.cacheWriteTokens);
      if (input + output + cacheRead + cacheWrite === 0) continue;
      const cents = num(t.totalCents);
      out.push([
        `${at}:${model}:${input}:${output}:${cacheRead}`,
        at,
        model,
        input,
        output,
        cacheRead,
        cacheWrite,
        0,
        0,
        0,
        null,
        cents > 0 ? cents / 100 : undefined,
      ]);
    }
    if (events.length < PAGE_SIZE) break;
  }
  return out;
}

/** This billing cycle's plan usage, as the dashboard's meters show it. */
export async function fetchPlan(session: CursorSession): Promise<AccountLimits> {
  const { status, json } = await dashboard(session, "get-current-period-usage", {});
  if (status !== 200 || !json || typeof json !== "object") {
    console.warn("[ai-usage] cursor plan usage answered", status, json && typeof json === "object" ? Object.keys(json) : null);
    return { windows: [], source: "none", fetchedAt: null, plan: session.plan, note: `Cursor answered ${status}.` };
  }
  const body = json as Record<string, unknown>;
  const plan = (body.planUsage ?? {}) as Record<string, unknown>;
  const resetsAt = num(body.billingCycleEnd) || null;
  const windows: LimitWindow[] = [];
  const add = (id: string, label: string, pct: unknown) => {
    if (pct == null || !Number.isFinite(Number(pct))) return;
    windows.push({ id, label, usedPct: Math.max(0, Math.min(100, Number(pct))), resetsAt });
  };
  const limit = num(plan.limit);
  const spent = num(plan.totalSpend);
  const startsAt = num(body.billingCycleStart) || null;
  // The dollar figures are what the dashboard's own "$x of $y" line shows; its
  // percent field disagreed with them on a real account, so the meter follows the dollars.
  const included = num(plan.includedSpend) || spent;
  add("total", "Included usage", limit ? (included / limit) * 100 : plan.totalPercentUsed);
  add("auto", "Auto", plan.autoPercentUsed);
  add("api", "API models", plan.apiPercentUsed);
  // The whole included pool — Auto plus bonus usage beyond the $20 — as a
  // precise percent with Cursor's own spend behind it: this is what sizes the plan.
  const poolPct = Number(plan.totalPercentUsed);
  if (Number.isFinite(poolPct)) {
    windows.push({
      id: "pool",
      label: "Total pool",
      usedPct: Math.max(0, Math.min(100, poolPct)),
      resetsAt,
      startsAt,
      spentUsd: spent / 100,
    });
  }
  const note =
    limit > 0 ? `$${(spent / 100).toFixed(2)} of $${(limit / 100).toFixed(2)} included this cycle.` : windows.length ? null : "Cursor didn't report plan usage.";
  return { windows, source: "live", fetchedAt: Date.now(), plan: session.plan, note };
}
