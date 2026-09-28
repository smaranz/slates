import { createDecipheriv, pbkdf2Sync } from "node:crypto";

import type { LimitWindow } from "../coding/types";

/**
 * The parts of switching that are only data: which of Claude Code's settings
 * travel with an account, renewed tokens written back into their blob, the
 * formats agy and Devin keep their logins in. No file, keychain or network
 * access here, so all of it is testable as it is.
 */

// ── Claude Code ───────────────────────────────────────────────────────────

/**
 * The keys of ~/.claude.json that belong to the signed-in account rather than
 * to the Mac: who it is, and what Anthropic last told Claude Code about that
 * account's plan, models and flags. A switch moves these and nothing else, so
 * projects, MCP servers and settings changed under one account are still
 * there under the next. Janus swaps the whole file, which rolls those back.
 */
export const CLAUDE_ACCOUNT_KEYS = [
  "oauthAccount",
  "cachedUsageUtilization",
  "hasAvailableSubscription",
  "subscriptionNoticeCount",
  "cachedExtraUsageDisabledReason",
  "s1mAccessCache",
  "modelAccessCache",
  "orgModelDefaultCache",
  "overageCreditGrantCache",
  "passesEligibilityCache",
  "passesLastSeenRemaining",
  "groveConfigCache",
  "claudeCodeFirstTokenDate",
  "additionalModelOptionsCache",
  "additionalModelCostsCache",
  "additionalModelOptionsAnsweredAt",
  "clientDataCacheSlots",
  "penguinModeOrgEnabled",
  "fableOverageConsentV2",
  "cachedGrowthBookFeatures",
  "cachedGrowthBookFeaturesAt",
  "cachedStatsigGates",
  "cachedExperimentData",
  "cachedExperimentFeatures",
  "metricsStatusCache",
] as const;

type Json = Record<string, unknown>;

function parseObject(text: string): Json | null {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
  } catch {
    return null;
  }
}

/** The account's share of a settings file. */
export function claudeAccountPart(settingsText: string): Json {
  const all = parseObject(settingsText) ?? {};
  const part: Json = {};
  for (const key of CLAUDE_ACCOUNT_KEYS) if (key in all) part[key] = all[key];
  return part;
}

/**
 * The live settings file with another account's share put in: its keys
 * replace the live ones, and account keys it doesn't have are dropped rather
 * than left describing the account that was there before. Everything else is
 * the live file's, in its order.
 */
export function withClaudeAccount(liveText: string, part: Json): string {
  const live = parseObject(liveText) ?? {};
  for (const key of CLAUDE_ACCOUNT_KEYS) {
    if (key in part) live[key] = part[key];
    else delete live[key];
  }
  // Two-space JSON with no trailing newline, as Claude Code writes it.
  return JSON.stringify(live, null, 2);
}

export function claudeEmail(settingsPart: Json): string | null {
  const account = settingsPart.oauthAccount as { emailAddress?: unknown } | undefined;
  return typeof account?.emailAddress === "string" && account.emailAddress ? account.emailAddress : null;
}

export interface ClaudeOauth {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  subscriptionType: string | null;
}

export function claudeOauth(credentialsText: string): ClaudeOauth | null {
  const oauth = parseObject(credentialsText)?.claudeAiOauth as Json | undefined;
  if (!oauth || typeof oauth.accessToken !== "string" || !oauth.accessToken) return null;
  return {
    accessToken: oauth.accessToken,
    refreshToken: typeof oauth.refreshToken === "string" && oauth.refreshToken ? oauth.refreshToken : null,
    expiresAt: typeof oauth.expiresAt === "number" ? oauth.expiresAt : null,
    subscriptionType: typeof oauth.subscriptionType === "string" ? oauth.subscriptionType : null,
  };
}

/** Whether a token can still be presented; one about to lapse counts as lapsed. */
export function isFresh(expiresAt: number | null, now: number, marginMs = 120_000): boolean {
  return expiresAt == null || expiresAt - now > marginMs;
}

/**
 * The credentials blob with renewed tokens written in. Built from the blob as
 * it was, so scopes, plan and anything a later Claude Code adds come through.
 */
export function renewedClaudeCredentials(
  credentialsText: string,
  grant: { access_token: string; refresh_token?: string; expires_in?: number },
  now: number
): string {
  const root = parseObject(credentialsText) ?? {};
  const oauth = { ...((root.claudeAiOauth as Json | undefined) ?? {}) };
  oauth.accessToken = grant.access_token;
  if (grant.refresh_token) oauth.refreshToken = grant.refresh_token;
  if (typeof grant.expires_in === "number") oauth.expiresAt = now + grant.expires_in * 1000;
  root.claudeAiOauth = oauth;
  return JSON.stringify(root);
}

// ── Antigravity ───────────────────────────────────────────────────────────

/** agy keeps its login through go-keyring, which files values under this prefix. */
const GO_KEYRING = "go-keyring-base64:";

export function fromGoKeyring(value: string): string {
  return value.startsWith(GO_KEYRING) ? Buffer.from(value.slice(GO_KEYRING.length), "base64").toString("utf8") : value;
}

export function toGoKeyring(text: string): string {
  return GO_KEYRING + Buffer.from(text, "utf8").toString("base64");
}

/** Who an agy token belongs to, from the Google id token inside it. */
export function emailFromAgyToken(text: string): string | null {
  const token = parseObject(text);
  const idToken = typeof token?.id_token === "string" ? token.id_token : "";
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  const claims = parseObject(Buffer.from(payload, "base64url").toString("utf8"));
  return typeof claims?.email === "string" ? claims.email : null;
}

// ── Devin ─────────────────────────────────────────────────────────────────

/** VS Code stores a secret as the JSON of a Buffer; this is how many bytes it holds. */
export function bufferBytes(text: string | null | undefined): number {
  if (!text) return 0;
  const parsed = parseObject(text) as { type?: unknown; data?: unknown } | null;
  return parsed?.type === "Buffer" && Array.isArray(parsed.data) ? parsed.data.length : text.length;
}

/** What the Devin app caches about one account's plan, per `windsurf.reactSettings.cachedPlanInfoData:user-…`. */
export interface DevinPlan {
  planName?: string;
  billingStrategy?: string;
  accountIdentityText?: string;
  dailyRemainingPercent?: number;
  weeklyRemainingPercent?: number;
  dailyResetAtUnix?: number;
  weeklyResetAtUnix?: number;
  hideDailyQuota?: boolean;
  hideWeeklyQuota?: boolean;
}

/** The cached plan of an account; the app labels each one "email - team". */
export function devinPlanFor(email: string, plans: DevinPlan[]): DevinPlan | null {
  const want = email.toLowerCase();
  return plans.find((p) => (p.accountIdentityText ?? "").toLowerCase().split(/\s+-\s+/)[0]?.trim() === want) ?? null;
}

/**
 * A quota plan's daily and weekly windows. The cache only moves while the app
 * is signed in as that account, so a window whose reset has passed since is
 * shown empty and undated rather than as the spend of a window that's over.
 */
export function devinWindows(plan: DevinPlan, now: number): { windows: LimitWindow[]; resetSince: boolean } {
  const windows: LimitWindow[] = [];
  let resetSince = false;
  if (plan.billingStrategy && plan.billingStrategy !== "quota") return { windows, resetSince };
  const add = (id: string, label: string, remaining: number | undefined, resetUnix: number | undefined, hidden: boolean | undefined) => {
    if (hidden || typeof remaining !== "number") return;
    const resetsAt = resetUnix ? resetUnix * 1000 : null;
    if (resetsAt && resetsAt <= now) {
      resetSince = true;
      windows.push({ id, label, usedPct: 0, resetsAt: null });
      return;
    }
    windows.push({ id, label, usedPct: Math.max(0, Math.min(100, 100 - remaining)), resetsAt });
  };
  add("daily", "Daily", plan.dailyRemainingPercent, plan.dailyResetAtUnix, plan.hideDailyQuota);
  add("weekly", "Weekly", plan.weeklyRemainingPercent, plan.weeklyResetAtUnix, plan.hideWeeklyQuota);
  return { windows, resetSince };
}

/**
 * Chromium's safeStorage on macOS, which is how Devin (an Electron app)
 * encrypts its login: "v10", then AES-128-CBC with a key stretched from the
 * password in the app's "… Safe Storage" keychain item.
 */
export function chromiumKey(password: string): Buffer {
  return pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
}

export function chromiumDecrypt(bufferJson: string, key: Buffer): string | null {
  try {
    const parsed = JSON.parse(bufferJson) as { data?: number[] };
    const bytes = Buffer.from(parsed.data ?? []);
    if (bytes.subarray(0, 3).toString() !== "v10") return null;
    const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, " "));
    return Buffer.concat([decipher.update(bytes.subarray(3)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** The signed-in account in Devin's decrypted session list: its id and its API key. */
export function devinSession(sessionsJson: string): { accountId: string; apiKey: string } | null {
  try {
    const first = (JSON.parse(sessionsJson) as { accessToken?: unknown; account?: { id?: unknown } }[])[0];
    return typeof first?.accessToken === "string" && typeof first.account?.id === "string" ? { accountId: first.account.id, apiKey: first.accessToken } : null;
  } catch {
    return null;
  }
}

/**
 * Devin's answer to GetUserStatus: who the key belongs to and, on a quota
 * plan, how much of the day and the week is left. Protobuf's JSON leaves out
 * zeros, so on a quota plan a missing percentage is none left, not unknown.
 */
export function devinStatus(body: unknown): { email: string | null; plan: string | null; quota: boolean; windows: LimitWindow[] } {
  const status = ((body as { userStatus?: Json } | null)?.userStatus ?? {}) as Json;
  const planStatus = (status.planStatus ?? {}) as Json;
  const planInfo = (planStatus.planInfo ?? {}) as Json;
  const quota = String(planInfo.billingStrategy ?? "").endsWith("QUOTA");
  const windows: LimitWindow[] = [];
  if (quota) {
    for (const [id, label, remaining, reset] of [
      ["daily", "Daily", planStatus.dailyQuotaRemainingPercent, planStatus.dailyQuotaResetAtUnix],
      ["weekly", "Weekly", planStatus.weeklyQuotaRemainingPercent, planStatus.weeklyQuotaResetAtUnix],
    ] as const) {
      const left = Number(remaining ?? 0);
      const at = Number(reset ?? 0);
      windows.push({ id, label, usedPct: Math.max(0, Math.min(100, 100 - (Number.isFinite(left) ? left : 0))), resetsAt: at > 0 ? at * 1000 : null });
    }
  }
  return {
    email: typeof status.email === "string" && status.email ? status.email : null,
    plan: typeof planInfo.planName === "string" ? planInfo.planName : null,
    quota,
    windows,
  };
}

// ── shared ────────────────────────────────────────────────────────────────

export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}
