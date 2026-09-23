import "server-only";

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  activatePlan,
  activeApiPlan,
  activeSubscriptionPlan,
  linkPlan,
  removePlan,
  useCli,
  useEnv,
  type LinkPlanInput,
} from "./plans";
import type { PublicPlan, UsageEvent, UsagePlan, UsageProvider } from "./types";

/**
 * On-disk storage for the usage ledger and linked plans.
 *
 * Same home-dir pattern as lessons and the counseling library. Secrets are
 * mode 0o600 and never leave this module toward the client.
 */

export const USAGE_DIR = path.join(os.homedir(), ".slates", "usage");
const LEDGER = path.join(USAGE_DIR, "ledger.jsonl");
const PLANS = path.join(USAGE_DIR, "plans.json");
const SECRETS = path.join(USAGE_DIR, "secrets.json");

const MAX_LEDGER_BYTES = 2 * 1024 * 1024;
const KEEP_LINES = 4000;

const ENV_KEYS: Partial<Record<UsageProvider, string>> = {
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  elevenlabs: "ELEVENLABS_API_KEY",
};

function ensureDir(): void {
  fs.mkdirSync(USAGE_DIR, { recursive: true });
}

function readJsonFile<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(file: string, value: unknown, mode?: number): void {
  ensureDir();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode });
  fs.renameSync(tmp, file);
  if (mode !== undefined) {
    try {
      fs.chmodSync(file, mode);
    } catch {
      // Best effort on platforms that ignore mode bits.
    }
  }
}

export function readPlans(): UsagePlan[] {
  const raw = readJsonFile<{ plans?: UsagePlan[] } | UsagePlan[]>(PLANS, []);
  return Array.isArray(raw) ? raw : (raw.plans ?? []);
}

function writePlans(plans: UsagePlan[]): void {
  writeJsonFile(PLANS, { plans });
}

function readSecrets(): Record<string, string> {
  return readJsonFile<Record<string, string>>(SECRETS, {});
}

function writeSecrets(secrets: Record<string, string>): void {
  writeJsonFile(SECRETS, secrets, 0o600);
}

export function keyHintOf(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length < 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}

export function appendEvent(event: UsageEvent): void {
  try {
    ensureDir();
    fs.appendFileSync(LEDGER, `${JSON.stringify(event)}\n`);
    trimLedgerIfNeeded();
  } catch (err) {
    console.error("[ai-usage] append failed", err);
  }
}

function trimLedgerIfNeeded(): void {
  try {
    const stat = fs.statSync(LEDGER);
    if (stat.size < MAX_LEDGER_BYTES) return;
    const text = fs.readFileSync(LEDGER, "utf8");
    const lines = text.split("\n").filter((l) => l.trim());
    const kept = lines.slice(-KEEP_LINES);
    const tmp = `${LEDGER}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${kept.join("\n")}\n`);
    fs.renameSync(tmp, LEDGER);
  } catch (err) {
    console.error("[ai-usage] trim failed", err);
  }
}

/** Read every ledger event, skipping corrupt lines. */
export function readEvents(): UsageEvent[] {
  try {
    const text = fs.readFileSync(LEDGER, "utf8");
    const out: UsageEvent[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as UsageEvent);
      } catch {
        // Skip a corrupt line rather than losing the whole ledger.
      }
    }
    return out;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    console.error("[ai-usage] read failed", err);
    return [];
  }
}

export function getSecret(planId: string): string | null {
  const secrets = readSecrets();
  return secrets[planId] ?? null;
}

/**
 * The API key agents should use for a provider: active linked secret, else env.
 */
export function activeApiSecret(provider: UsageProvider): string | null {
  const plans = readPlans();
  const active = activeApiPlan(plans, provider);
  if (active) {
    const secret = getSecret(active.id);
    if (secret) return secret;
  }
  const envName = ENV_KEYS[provider];
  if (!envName) return null;
  const env = process.env[envName];
  return env && env.trim() ? env.trim() : null;
}

export function hasSecret(provider: UsageProvider): boolean {
  return !!activeApiSecret(provider);
}

/** Plan id to attribute a call to, when one is active (api or subscription). */
export function activePlanId(provider: UsageProvider): string | null {
  const plans = readPlans();
  const api = activeApiPlan(plans, provider);
  if (api) return api.id;
  const sub = activeSubscriptionPlan(plans, provider);
  if (sub) return sub.id;
  if (ENV_KEYS[provider] && process.env[ENV_KEYS[provider]!]?.trim()) return `env:${provider}`;
  if (provider === "claude-code") return "cli:claude-code";
  if (provider === "cursor") return "cli:cursor";
  return null;
}

export function linkApiPlan(
  input: LinkPlanInput & { secret?: string }
): { plans: UsagePlan[]; plan: UsagePlan } {
  const plans = readPlans();
  const hint = input.secret ? keyHintOf(input.secret) : (input.keyHint ?? null);
  const next = linkPlan(plans, { ...input, keyHint: hint });
  const plan = next[next.length - 1]!;
  writePlans(next);
  if (input.secret && input.kind === "api") {
    const secrets = readSecrets();
    secrets[plan.id] = input.secret.trim();
    writeSecrets(secrets);
  }
  return { plans: next, plan };
}

export function setActivePlan(id: string): UsagePlan[] {
  const next = activatePlan(readPlans(), id);
  writePlans(next);
  return next;
}

export function deletePlan(id: string): UsagePlan[] {
  const next = removePlan(readPlans(), id);
  writePlans(next);
  const secrets = readSecrets();
  if (secrets[id]) {
    delete secrets[id];
    writeSecrets(secrets);
  }
  return next;
}

export function deactivateApiPlans(provider: UsageProvider): UsagePlan[] {
  const next = useEnv(readPlans(), provider);
  writePlans(next);
  return next;
}

export function deactivateSubscriptions(provider: UsageProvider): UsagePlan[] {
  const next = useCli(readPlans(), provider);
  writePlans(next);
  return next;
}

const CLI_CACHE = new Map<string, { ok: boolean; at: number }>();
const CLI_TTL_MS = 60_000;

/** Resolve a CLI binary with a short timeout; result is cached briefly. */
export function cliResolves(bin: string): boolean {
  const cached = CLI_CACHE.get(bin);
  if (cached && Date.now() - cached.at < CLI_TTL_MS) return cached.ok;
  try {
    execFileSync(bin, ["--version"], { timeout: 1500, stdio: "ignore" });
    CLI_CACHE.set(bin, { ok: true, at: Date.now() });
    return true;
  } catch (e) {
    // A non-zero exit still means the binary exists; ENOENT means it doesn't.
    const ok = (e as NodeJS.ErrnoException).code !== "ENOENT";
    CLI_CACHE.set(bin, { ok, at: Date.now() });
    return ok;
  }
}

function envHint(provider: UsageProvider): string | null {
  const envName = ENV_KEYS[provider];
  if (!envName) return null;
  const v = process.env[envName];
  return v?.trim() ? keyHintOf(v) : null;
}

/** Public plan list for the dashboard — linked + synthetic env/cli rows. */
export function publicPlans(): PublicPlan[] {
  const linked = readPlans().map((p) => ({ ...p, removable: true as const }));
  const synth: PublicPlan[] = [];

  for (const provider of ["openai", "openrouter", "elevenlabs"] as UsageProvider[]) {
    const hint = envHint(provider);
    if (!hint) continue;
    const hasActiveApi = linked.some((p) => p.provider === provider && p.kind === "api" && p.active);
    synth.push({
      id: `env:${provider}`,
      provider,
      label: `${provider === "openai" ? "OpenAI" : provider === "openrouter" ? "OpenRouter" : "ElevenLabs"} (.env)`,
      kind: "api",
      monthlyUsd: null,
      keyHint: hint,
      active: !hasActiveApi,
      linkedAt: null,
      source: "env",
      removable: false,
    });
  }

  if (cliResolves("claude")) {
    const hasActiveSub = linked.some(
      (p) => p.provider === "claude-code" && p.kind === "subscription" && p.active
    );
    synth.push({
      id: "cli:claude-code",
      provider: "claude-code",
      label: "Claude Code (this machine)",
      kind: "subscription",
      monthlyUsd: null,
      keyHint: null,
      active: !hasActiveSub,
      linkedAt: null,
      source: "cli",
      removable: false,
    });
  }

  if (cliResolves("cursor-agent")) {
    const hasActiveSub = linked.some(
      (p) => p.provider === "cursor" && p.kind === "subscription" && p.active
    );
    synth.push({
      id: "cli:cursor",
      provider: "cursor",
      label: "Cursor (this machine)",
      kind: "subscription",
      monthlyUsd: null,
      keyHint: null,
      active: !hasActiveSub,
      linkedAt: null,
      source: "cli",
      removable: false,
    });
  }

  return [...linked, ...synth];
}

export function monthlyPlanUsd(plans: PublicPlan[]): number {
  return plans
    .filter((p) => p.source === "linked" && p.kind === "subscription" && p.monthlyUsd != null)
    .reduce((sum, p) => sum + (p.monthlyUsd ?? 0), 0);
}
