import "server-only";

import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { USAGE_DIR } from "../store";
import { identityOf, planName, type Home } from "./accounts";
import { bucketsToWindows, readBuckets } from "./antigravity";
import { appSession, fetchPlan } from "./cursor";
import type { RateLimitSnap } from "./scan";
import type { AccountLimits, LimitWindow } from "./types";

/**
 * Live plan limits — the "5-hour" and "weekly" meters each CLI shows in its
 * own /usage or /status screen — fetched per account with that account's
 * login, so a second account's meters are visible without signing into it.
 *
 * Logins are read where each CLI keeps them and never leave this process,
 * and never refreshed here: Claude and ChatGPT rotate their refresh tokens,
 * so refreshing one would sign the CLI out. When an access token has lapsed
 * we say so and fall back to what the logs last recorded. Antigravity is
 * asked through its own CLI, so its login stays entirely with agy.
 */

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: AccountLimits; stale?: boolean }>();

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v && Number.isFinite(Number(v)) ? Number(v) : null;
}

function toMs(v: unknown): number | null {
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  const n = num(v);
  if (n == null) return null;
  return n < 1e12 ? n * 1000 : n;
}

function none(note: string, plan: string | null = null): AccountLimits {
  return { windows: [], source: "none", fetchedAt: null, plan, note };
}

function windowLabel(minutes: number): string {
  if (minutes >= 10_000 && minutes <= 10_100) return "Weekly";
  if (minutes === 300) return "5-hour";
  if (minutes >= 1440 && minutes % 1440 === 0) return `${minutes / 1440}-day`;
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}-hour`;
  return `${minutes}-min`;
}

async function getJson(url: string, init: RequestInit): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8_000) });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // leave null
  }
  return { ok: res.ok, status: res.status, body };
}

/** The provider is rate-limiting or down: worth showing the last good numbers, not an error. */
class Throttled extends Error {
  constructor(readonly provider: string) {
    super(`${provider} is throttled`);
  }
}

// ── Claude ────────────────────────────────────────────────────────────────

interface ClaudeCreds {
  claudeAiOauth?: { accessToken?: string; expiresAt?: number; subscriptionType?: string };
}

function keychain(service: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("/usr/bin/security", ["find-generic-password", "-s", service, "-w"], { timeout: 5_000 }, (err, out) =>
      resolve(err ? null : out.trim() || null)
    );
  });
}

/** Claude Code names its keychain item after a hash of CLAUDE_CONFIG_DIR when one is set. */
async function claudeCreds(home: Home): Promise<ClaudeCreds | null> {
  const services = home.owned
    ? [`Claude Code-credentials-${createHash("sha256").update(home.dir).digest("hex").slice(0, 8)}`]
    : ["Claude Code-credentials"];
  if (process.platform === "darwin") {
    for (const s of services) {
      const raw = await keychain(s);
      if (raw) {
        try {
          return JSON.parse(raw) as ClaudeCreds;
        } catch {
          // fall through to the file
        }
      }
    }
  }
  return readJson<ClaudeCreds>(path.join(home.dir, ".credentials.json"));
}

const CLAUDE_LABELS: Record<string, string> = {
  five_hour: "5-hour",
  seven_day: "Weekly",
  seven_day_opus: "Weekly · Opus",
  seven_day_sonnet: "Weekly · Sonnet",
  seven_day_oauth_apps: "Weekly · apps",
};

async function claudeLimits(home: Home): Promise<AccountLimits> {
  const creds = await claudeCreds(home);
  const oauth = creds?.claudeAiOauth;
  const plan = planName(oauth?.subscriptionType ? `claude_${oauth.subscriptionType}` : null);
  if (!oauth?.accessToken) return none("Sign in to see this plan's limits.", plan);
  if (oauth.expiresAt && oauth.expiresAt < Date.now()) {
    return none("Login expired — open Claude Code as this account once to refresh it.", plan);
  }
  const res = await getJson("https://api.anthropic.com/api/oauth/usage", {
    headers: {
      Authorization: `Bearer ${oauth.accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
      "Content-Type": "application/json",
    },
  });
  if (res.status === 429 || res.status >= 500) throw new Throttled("Anthropic");
  if (!res.ok || !res.body || typeof res.body !== "object") {
    return none(res.status === 401 ? "Login expired — open Claude Code as this account once to refresh it." : `Anthropic answered ${res.status}.`, plan);
  }
  const windows: LimitWindow[] = [];
  for (const [id, v] of Object.entries(res.body as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const w = v as Record<string, unknown>;
    const used = num(w.utilization);
    if (used == null) continue;
    if (id === "extra_usage" && w.is_enabled === false) continue;
    // Windows we don't know the name of only earn a row once they're in use.
    if (!CLAUDE_LABELS[id] && !used && !w.resets_at) continue;
    windows.push({
      id,
      label: CLAUDE_LABELS[id] ?? id.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
      usedPct: Math.max(0, Math.min(100, used)),
      resetsAt: toMs(w.resets_at),
    });
  }
  return { windows, source: "live", fetchedAt: Date.now(), plan, note: windows.length ? null : "No limits reported for this plan." };
}

// ── Codex ─────────────────────────────────────────────────────────────────

function fromLog(snap: RateLimitSnap | undefined, plan: string | null, note: string): AccountLimits {
  if (!snap) return none(note, plan);
  const now = Date.now();
  return {
    windows: snap.windows.map((w) => ({
      id: `w${w.minutes}`,
      label: windowLabel(w.minutes),
      // A window that has rolled over since the log line is empty again.
      usedPct: w.resetsAt && w.resetsAt < now ? 0 : w.usedPct,
      resetsAt: w.resetsAt && w.resetsAt < now ? null : w.resetsAt,
    })),
    source: "log",
    fetchedAt: snap.at,
    plan: planName(snap.plan) ?? plan,
    note,
  };
}

async function codexLimits(home: Home, snap: RateLimitSnap | undefined): Promise<AccountLimits> {
  const auth = readJson<{ tokens?: { access_token?: string; account_id?: string } }>(path.join(home.dir, "auth.json"));
  const token = auth?.tokens?.access_token;
  if (!token) return fromLog(snap, null, "Sign in to see this plan's limits.");
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "User-Agent": "codex-cli" };
  if (auth?.tokens?.account_id) headers["ChatGPT-Account-Id"] = auth.tokens.account_id;
  try {
    const res = await getJson("https://chatgpt.com/backend-api/wham/usage", { headers });
    const body = res.body as {
      plan_type?: string;
      rate_limit?: { primary_window?: Record<string, unknown> | null; secondary_window?: Record<string, unknown> | null };
    } | null;
    if (!res.ok || !body?.rate_limit) {
      return fromLog(snap, null, res.status === 401 ? "Login expired — showing the last numbers Codex logged." : "Showing the last numbers Codex logged.");
    }
    const windows: LimitWindow[] = [];
    for (const [id, w] of [
      ["primary", body.rate_limit.primary_window],
      ["secondary", body.rate_limit.secondary_window],
    ] as const) {
      if (!w) continue;
      const seconds = num(w.limit_window_seconds);
      const resetAfter = num(w.reset_after_seconds);
      windows.push({
        id,
        label: seconds ? windowLabel(Math.round(seconds / 60)) : id === "primary" ? "5-hour" : "Weekly",
        usedPct: Math.max(0, Math.min(100, num(w.used_percent) ?? 0)),
        resetsAt: toMs(w.reset_at) ?? (resetAfter != null ? Date.now() + resetAfter * 1000 : null),
      });
    }
    return { windows, source: "live", fetchedAt: Date.now(), plan: planName(body.plan_type), note: null };
  } catch {
    return fromLog(snap, null, "Offline — showing the last numbers Codex logged.");
  }
}

// ── Antigravity ───────────────────────────────────────────────────────────

/**
 * `agy` answers its read-only slash commands in print mode without running a
 * model: `agy -p /usage` prints one tab-separated row per limit window and
 * `/credits` the G1 balance. Running it under the account's HOME reads that
 * account's keychain login, so nothing here ever touches a token.
 */
function agyBinary(): string {
  const local = path.join(os.homedir(), ".local", "bin", "agy");
  return fs.existsSync(local) ? local : "agy";
}

function runAgy(home: Home, command: string): Promise<{ out: string; signedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(agyBinary(), ["-p", command, "--print-timeout", "30s"], {
      cwd: home.dir,
      env: { ...process.env, HOME: home.dir, AGY_CLI_HIDE_LOGO: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let done = false;
    const finish = (signedOut: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (child.exitCode == null) child.kill("SIGTERM");
      resolve({ out, signedOut });
    };
    // Signed out, agy prints a sign-in link and waits a minute; don't wait with it.
    const onData = (b: Buffer) => {
      out += b.toString("utf8");
      if (/Authentication required|not logged into Antigravity/i.test(out)) finish(true);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", () => finish(false));
    child.on("close", () => finish(false));
    const timer = setTimeout(() => finish(false), 45_000);
  });
}

async function antigravityLimits(home: Home): Promise<AccountLimits> {
  const [buckets, credits] = await Promise.all([readBuckets(home), runAgy(home, "/credits")]);
  if (!buckets) return none("Signed out — use Reopen sign-in to log this account back in.");
  const windows = bucketsToWindows(buckets);
  const creditRow = credits.out.split("\n").find((l) => /^remaining credits\t/i.test(l));
  const balance = creditRow ? num(creditRow.split("\t")[1]) : null;
  const note = windows.length
    ? balance
      ? `${balance.toLocaleString()} G1 credits left for when these run out.`
      : null
    : "Antigravity didn't report any limits.";
  return { windows, source: "live", fetchedAt: Date.now(), plan: null, note };
}

// ── Cursor ────────────────────────────────────────────────────────────────

/**
 * Cursor reports plan usage on its dashboard, for the account the Cursor app
 * is signed into. Other Cursor accounts get their numbers once the app is.
 */
async function cursorLimits(home: Home): Promise<AccountLimits> {
  const id = identityOf(home);
  if (!id) return none("Sign in to see this plan's usage.");
  const session = await appSession();
  if (!session || session.email.toLowerCase() !== id.email.toLowerCase()) {
    return none(`Cursor shows usage for the account its app is signed into. Sign the Cursor app into ${id.email} once to bring this account's numbers in.`);
  }
  return fetchPlan(session);
}

// ── cache ─────────────────────────────────────────────────────────────────

const inFlight = new Map<string, Promise<AccountLimits>>();

/**
 * Anthropic's usage endpoint rate-limits hard, and agy takes a few seconds a
 * call, so those are checked less often than Codex.
 */
function ttlFor(home: Home): number {
  if (home.tool === "antigravity" || home.tool === "cursor") return 5 * 60_000;
  if (home.tool === "claude") return 3 * 60_000;
  return TTL_MS;
}

// The last good live numbers per home, kept on disk so a throttled check after
// a restart still has something honest to show.
const LAST_GOOD_FILE = path.join(USAGE_DIR, "limits-last.json");
let lastGood: Record<string, AccountLimits> | null = null;

function readLastGood(): Record<string, AccountLimits> {
  if (!lastGood) lastGood = readJson<Record<string, AccountLimits>>(LAST_GOOD_FILE) ?? {};
  return lastGood;
}

function rememberGood(homeId: string, value: AccountLimits): void {
  const all = readLastGood();
  all[homeId] = value;
  try {
    fs.mkdirSync(USAGE_DIR, { recursive: true });
    fs.writeFileSync(LAST_GOOD_FILE, JSON.stringify(all));
  } catch {
    // Memory is enough until next time.
  }
}

function minutesAgo(at: number): string {
  const m = Math.max(1, Math.round((Date.now() - at) / 60_000));
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
}

async function fetchLimits(home: Home, logSnap?: RateLimitSnap): Promise<AccountLimits> {
  try {
    let value: AccountLimits;
    if (home.tool === "claude") value = await claudeLimits(home);
    else if (home.tool === "codex") value = await codexLimits(home, logSnap);
    else if (home.tool === "antigravity") value = await antigravityLimits(home);
    else if (home.tool === "cursor") value = await cursorLimits(home);
    else return none("Gemini CLI no longer signs personal accounts in.");
    if (value.source === "live" && value.windows.length) rememberGood(home.id, value);
    return value;
  } catch (err) {
    if (home.tool === "codex") return fromLog(logSnap, null, "Offline — showing the last numbers Codex logged.");
    const who = err instanceof Throttled ? `${err.provider} is rate-limiting usage checks` : "Couldn't reach the provider";
    const prev = readLastGood()[home.id];
    if (prev?.fetchedAt) return { ...prev, note: `${who}; these are from ${minutesAgo(prev.fetchedAt)} ago.` };
    return none(`${who} right now. Try Refresh in a few minutes.`);
  }
}

/** Even a forced refresh reuses numbers this fresh, so auto-refresh can't trip a rate limit. */
function floorFor(home: Home): number {
  return home.tool === "claude" ? 90_000 : home.tool === "antigravity" ? 60_000 : 20_000;
}

export async function limitsFor(home: Home, logSnap?: RateLimitSnap): Promise<AccountLimits> {
  const hit = cache.get(home.id);
  const age = hit ? Date.now() - hit.at : Infinity;
  // An empty answer (a sign-in still settling, a hiccup) is retried soon, not kept for minutes.
  const empty = !!hit && hit.value.windows.length === 0;
  const floor = empty ? 0 : floorFor(home);
  const ttl = empty ? 30_000 : ttlFor(home);
  if (hit && (age < floor || (!hit.stale && age < ttl))) return hit.value;
  // The screen polls; a slow agy call shouldn't be started twice.
  let pending = inFlight.get(home.id);
  if (!pending) {
    pending = fetchLimits(home, logSnap).then((value) => {
      cache.set(home.id, { at: Date.now(), value });
      inFlight.delete(home.id);
      return value;
    });
    inFlight.set(home.id, pending);
  }
  return pending;
}

/** Ask for fresh numbers next time — subject to each provider's minimum interval. */
export function forgetLimits(homeId?: string): void {
  for (const [id, entry] of cache) if (!homeId || id === homeId) entry.stale = true;
}

export const _test = { windowLabel, toMs };
