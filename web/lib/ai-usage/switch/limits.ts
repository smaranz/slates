import "server-only";

import fs from "node:fs";
import path from "node:path";

import { DEFAULT_HOMES } from "../coding/accounts";
import { bucketsToWindows, readBuckets } from "../coding/antigravity";
import { claudeUsage, claudeWindows, limitsFor } from "../coding/limits";
import type { AccountLimits } from "../coding/types";
import { claudeOauth, devinPlanFor, devinStatus, devinWindows, emailFromAgyToken, isFresh, renewedClaudeCredentials, sameEmail, toGoKeyring } from "./core";
import type { SavedAccount, StoredSession } from "./switcher";
import { devin, devinPlans, devinStateDb, devinUserStatus } from "./tools";
import type { SwitchTool } from "./types";
import { SWITCH_DIR, vault } from "./vault";

/**
 * Each account's plan limits. The signed-in account's come from the fetchers
 * the Usage view already uses. A parked account is asked with its own saved
 * login, the one thing that keeps its numbers from freezing the day it was
 * switched away from: Claude's with its token renewed first when it has lapsed
 * (and the renewal stored before it's used, since it spends the old one), agy
 * in a throwaway home holding only that login, Devin with its own API key.
 */

function none(note: string, plan: string | null = null): AccountLimits {
  return { windows: [], source: "none", fetchedAt: null, plan, note };
}

const EXPIRED = "This saved sign-in has expired. Switch to it and sign in again.";

// ── Claude ────────────────────────────────────────────────────────────────

const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
/** Claude Code's public OAuth client id. Not a secret: it's in the browser at every sign-in. */
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

class Throttled extends Error {}

async function renewClaude(account: SavedAccount, session: StoredSession): Promise<StoredSession | null> {
  const oauth = claudeOauth(session.secret.credentials ?? "");
  if (!oauth?.refreshToken) return null;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "refresh_token", refresh_token: oauth.refreshToken, client_id: CLIENT_ID }),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 429 || res.status >= 500) throw new Throttled();
  if (!res.ok) return null;
  const grant = (await res.json().catch(() => null)) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown } | null;
  if (!grant || typeof grant.access_token !== "string") return null;
  const renewed: StoredSession = {
    ...session,
    secret: {
      ...session.secret,
      credentials: renewedClaudeCredentials(
        session.secret.credentials!,
        {
          access_token: grant.access_token,
          refresh_token: typeof grant.refresh_token === "string" ? grant.refresh_token : undefined,
          expires_in: typeof grant.expires_in === "number" ? grant.expires_in : undefined,
        },
        Date.now()
      ),
    },
  };
  // Stored before it's used: the old refresh token is spent, so this is now the only way in.
  await vault.store("claude", account.id, renewed);
  return renewed;
}

async function parkedClaude(account: SavedAccount): Promise<AccountLimits> {
  let session = await vault.load("claude", account.id);
  if (!session) return none("No saved sign-in for this account.", account.plan);
  let oauth = claudeOauth(session.secret.credentials ?? "");
  if (!oauth) return none(EXPIRED, account.plan);
  let renewed = false;
  if (!isFresh(oauth.expiresAt, Date.now())) {
    const next = await renewClaude(account, session);
    if (!next) return none(EXPIRED, account.plan);
    session = next;
    oauth = claudeOauth(next.secret.credentials!)!;
    renewed = true;
  }
  let res = await claudeUsage(oauth.accessToken);
  // Refused while in date happens (a revoked session, a skewed clock); one renewal is worth trying.
  if ((res.status === 401 || res.status === 403) && !renewed) {
    const next = await renewClaude(account, session);
    if (!next) return none(EXPIRED, account.plan);
    res = await claudeUsage(claudeOauth(next.secret.credentials!)!.accessToken);
  }
  if (res.status === 429 || res.status >= 500) throw new Throttled();
  if (res.status === 401 || res.status === 403) return none(EXPIRED, account.plan);
  if (!res.ok || !res.body || typeof res.body !== "object") return none(`Anthropic answered ${res.status}.`, account.plan);
  const windows = claudeWindows(res.body as Record<string, unknown>);
  return { windows, source: "live", fetchedAt: Date.now(), plan: account.plan, note: windows.length ? null : "No limits reported for this plan." };
}

// ── Antigravity ───────────────────────────────────────────────────────────

async function parkedAgy(account: SavedAccount): Promise<AccountLimits> {
  const session = await vault.load("antigravity", account.id);
  const token = session?.secret.file || "";
  if (!session || !emailFromAgyToken(token)) return none("No saved sign-in for this account.");
  fs.mkdirSync(SWITCH_DIR, { recursive: true, mode: 0o700 });
  const dir = fs.mkdtempSync(path.join(SWITCH_DIR, "agy-"));
  try {
    // agy looks in the keychain of $HOME, and there's none here, so it reads the file.
    const file = path.join(dir, ".gemini", "antigravity-cli", "antigravity-oauth-token");
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, token, { mode: 0o600 });
    const buckets = await readBuckets({ id: `switch-${account.id}`, tool: "antigravity", dir, owned: true, createdAt: 0 });
    // agy renews its token as it goes. Keep what it left, or the saved copy holds a spent one.
    const after = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    if (after && after !== token && sameEmail(emailFromAgyToken(after), account.email)) {
      await vault.store("antigravity", account.id, { ...session, secret: { keychain: toGoKeyring(after), file: after } });
    }
    if (!buckets) return none(EXPIRED);
    const windows = bucketsToWindows(buckets);
    return { windows, source: "live", fetchedAt: Date.now(), plan: null, note: windows.length ? null : "Antigravity didn't report any limits." };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── Devin ─────────────────────────────────────────────────────────────────

async function devinLimits(account: SavedAccount | { email: string }, live: boolean): Promise<AccountLimits> {
  const session = live ? (await devin.readLive())?.session : "id" in account ? await vault.load("devin", account.id) : null;
  const res = session ? await devinUserStatus(session.secret).catch(() => null) : null;
  if (res?.status === 200) {
    const status = devinStatus(res.body);
    const note = status.windows.length ? null : `The ${status.plan ?? "current"} plan has no daily or weekly limits.`;
    return { windows: status.windows, source: "live", fetchedAt: Date.now(), plan: status.plan, note };
  }
  if (res && (res.status === 401 || res.status === 403)) return none(live ? "Devin's server refused its sign-in. Sign in to Devin again." : EXPIRED);
  // No key to ask with (the keychain said no) or no answer: what the app last cached.
  return cachedDevinLimits(account.email, live);
}

async function cachedDevinLimits(email: string, live: boolean): Promise<AccountLimits> {
  const plan = devinPlanFor(email, await devinPlans());
  if (!plan) return none(live ? "Devin hasn't reported this plan's limits yet." : "Devin keeps limits for the account it's signed in as. Switch to this one to read them.");
  const { windows, resetSince } = devinWindows(plan, Date.now());
  let fetchedAt: number | null = null;
  if (live) {
    try {
      fetchedAt = fs.statSync(devinStateDb()).mtimeMs;
    } catch {
      // leave it undated
    }
  }
  const note = !windows.length
    ? `The ${plan.planName ?? "current"} plan has no daily or weekly limits.`
    : live
      ? null
      : `As of when Devin was last signed in as this account${resetSince ? "; a limit has reset since" : ""}.`;
  return { windows, source: live ? "live" : "log", fetchedAt, plan: plan.planName ?? null, note };
}

// ── cache ─────────────────────────────────────────────────────────────────

const cache = new Map<string, { at: number; value: AccountLimits }>();
const inFlight = new Map<string, Promise<AccountLimits>>();
const LAST_GOOD = path.join(SWITCH_DIR, "limits-last.json");

function lastGood(): Record<string, AccountLimits> {
  try {
    return JSON.parse(fs.readFileSync(LAST_GOOD, "utf8")) as Record<string, AccountLimits>;
  } catch {
    return {};
  }
}

function remember(key: string, value: AccountLimits): void {
  const all = lastGood();
  all[key] = value;
  try {
    fs.mkdirSync(SWITCH_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(LAST_GOOD, JSON.stringify(all), { mode: 0o600 });
  } catch {
    // memory is enough until next time
  }
}

/** Anthropic rate-limits its usage endpoint and agy takes seconds a call, so those are asked less often. */
const TTL: Record<SwitchTool, number> = { claude: 3 * 60_000, antigravity: 10 * 60_000, devin: 2 * 60_000 };
/** Even a forced refresh reuses numbers this new. */
const FLOOR: Record<SwitchTool, number> = { claude: 90_000, antigravity: 60_000, devin: 20_000 };

async function fetchFor(tool: SwitchTool, account: SavedAccount | { email: string }, live: boolean): Promise<AccountLimits> {
  if (tool === "devin") return devinLimits(account, live);
  if (live) {
    const home = DEFAULT_HOMES.find((h) => h.tool === tool)!;
    return limitsFor(home);
  }
  const saved = account as SavedAccount;
  const key = `${tool}:${saved.id}`;
  try {
    const value = tool === "claude" ? await parkedClaude(saved) : await parkedAgy(saved);
    if (value.windows.length) remember(key, value);
    return value;
  } catch (err) {
    const prev = lastGood()[key];
    const who = err instanceof Throttled ? "Anthropic is rate-limiting usage checks" : "Couldn't reach the provider";
    if (prev?.fetchedAt) return { ...prev, note: `${who}; these are from ${Math.max(1, Math.round((Date.now() - prev.fetchedAt) / 60_000))} min ago.` };
    return none(`${who} right now. Try Refresh in a few minutes.`, saved.plan);
  }
}

function keyOf(tool: SwitchTool, account: { id?: string; email: string }, live: boolean): string {
  return live ? `${tool}:live:${account.email.toLowerCase()}` : `${tool}:${account.id}`;
}

export function peekLimits(tool: SwitchTool, account: { id?: string; email: string }, live: boolean): AccountLimits | null {
  return cache.get(keyOf(tool, account, live))?.value ?? null;
}

export async function accountLimits(tool: SwitchTool, account: SavedAccount | { email: string }, live: boolean, force = false): Promise<AccountLimits> {
  const key = keyOf(tool, account as { id?: string; email: string }, live);
  const hit = cache.get(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && (age < FLOOR[tool] || (!force && age < TTL[tool]))) return hit.value;
  let pending = inFlight.get(key);
  if (!pending) {
    pending = fetchFor(tool, account, live)
      .then((value) => {
        cache.set(key, { at: Date.now(), value });
        return value;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
}

/** After a switch, who's live has changed, so the cached numbers keyed that way are stale. */
export function forgetSwitchLimits(tool: SwitchTool): void {
  for (const key of cache.keys()) if (key.startsWith(`${tool}:`)) cache.delete(key);
}
