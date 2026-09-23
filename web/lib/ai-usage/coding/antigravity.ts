import "server-only";

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { USAGE_DIR } from "../store";
import type { Home } from "./accounts";
import { priceOf } from "./pricing";
import type { LimitWindow } from "./types";

/**
 * Antigravity, through its own CLI.
 *
 * `agy -p /usage --output-format json` reports every window's remaining
 * fraction to seven places, and Antigravity says quota is "consumed
 * proportionally to the cost of the tokens". It keeps no token counts on disk,
 * but a print-mode prompt reports its own. So a plan can be sized by sending
 * one small prompt per model group and watching how far each meter moves:
 * a full window is the prompt's tokens (and API value) divided by that move.
 */

const CAL_FILE = path.join(USAGE_DIR, "antigravity-calibration.json");

/** One cheap, fixed prompt per quota group, on a model whose price we know. */
const PROBES: { group: string; model: string; priced: string }[] = [
  { group: "Gemini", model: "gemini-3.1-pro-low", priced: "gemini-3.1-pro-preview" },
  { group: "Claude & GPT", model: "claude-sonnet-4-6", priced: "claude-sonnet-4-6" },
];

const PROBE_PROMPT = "Reply with the single word: ok";

export interface AgyBucket {
  group: string;
  window: "5h" | "weekly" | string;
  remaining: number;
  resetsAt: number | null;
}

export interface Calibration {
  /** `${group}-${window}` → a full window, measured. */
  windows: Record<
    string,
    { group: string; window: string; tokens: number; usd: number; model: string; deltaPct: number; measuredAt: number }
  >;
  measuredAt: number;
}

const GROUPS: Record<string, string> = {
  "gemini models": "Gemini",
  "claude and gpt models": "Claude & GPT",
};

function agyBinary(): string {
  const local = path.join(os.homedir(), ".local", "bin", "agy");
  return fs.existsSync(local) ? local : "agy";
}

function scratchDir(): string {
  const dir = path.join(os.tmpdir(), "slates-agy");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Run agy in print mode as this home's account. Resolves null when signed out. */
export function runAgy(home: Home, args: string[], timeoutMs = 90_000): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(agyBinary(), [...args, "--print-timeout", `${Math.round(timeoutMs / 1000)}s`], {
      cwd: scratchDir(),
      env: { ...process.env, HOME: home.dir, AGY_CLI_HIDE_LOGO: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (child.exitCode == null) child.kill("SIGTERM");
      resolve(value);
    };
    const onData = (b: Buffer) => {
      out += b.toString("utf8");
      // Signed out, agy prints a sign-in link and waits; don't wait with it.
      if (/Authentication required|not logged into Antigravity/i.test(out)) finish(null);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", () => finish(null));
    child.on("close", () => finish(out));
    const timer = setTimeout(() => finish(out || null), timeoutMs + 10_000);
  });
}

function lastJson(out: string): Record<string, unknown> | null {
  for (const line of out.trim().split("\n").reverse()) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      return JSON.parse(t) as Record<string, unknown>;
    } catch {
      // keep looking
    }
  }
  return null;
}

/** Every window's precise remaining fraction. Null when signed out. */
export async function readBuckets(home: Home): Promise<AgyBucket[] | null> {
  const out = await runAgy(home, ["-p", "/usage", "--output-format", "json"], 30_000);
  if (out == null) return null;
  const json = lastJson(out) as { command?: { data?: { groups?: { name?: string; buckets?: Record<string, unknown>[] }[] } } } | null;
  const groups = json?.command?.data?.groups ?? [];
  const buckets: AgyBucket[] = [];
  for (const g of groups) {
    const group = GROUPS[String(g.name ?? "").toLowerCase()] ?? String(g.name ?? "Models");
    for (const b of g.buckets ?? []) {
      const remaining = Number(b.remaining_fraction);
      if (!Number.isFinite(remaining)) continue;
      const reset = typeof b.reset_time === "string" ? Date.parse(b.reset_time) : NaN;
      buckets.push({ group, window: String(b.window ?? ""), remaining, resetsAt: Number.isFinite(reset) ? reset : null });
    }
  }
  return buckets;
}

export function windowLabel(window: string): string {
  if (window === "5h") return "5-hour";
  if (window === "weekly") return "Weekly";
  return window;
}

export function bucketsToWindows(buckets: AgyBucket[]): LimitWindow[] {
  return buckets.map((b) => ({
    id: `${b.group}-${b.window}`,
    label: `${b.group} · ${windowLabel(b.window)}`,
    usedPct: Math.max(0, Math.min(100, (1 - b.remaining) * 100)),
    resetsAt: b.resetsAt,
  }));
}

function readAll(): Record<string, Calibration> {
  try {
    return JSON.parse(fs.readFileSync(CAL_FILE, "utf8")) as Record<string, Calibration>;
  } catch {
    return {};
  }
}

export function calibrationFor(accountKey: string): Calibration | null {
  return readAll()[accountKey] ?? null;
}

/**
 * Size each window by sending one probe per group and reading the meters
 * before and after. Costs a sliver of each window — a few thousandths of a
 * percent of the week.
 */
export async function calibrate(home: Home, accountKey: string): Promise<Calibration> {
  const result: Calibration = { windows: {}, measuredAt: Date.now() };
  for (const probe of PROBES) {
    const before = await readBuckets(home);
    if (!before) throw new Error("This Antigravity account is signed out. Use Reopen sign-in first.");
    const out = await runAgy(home, ["-p", PROBE_PROMPT, "--model", probe.model, "--output-format", "json"]);
    const reply = out ? (lastJson(out) as { status?: string; usage?: Record<string, number> } | null) : null;
    const usage = reply?.usage;
    if (!usage || reply?.status !== "SUCCESS") continue;
    const input = Number(usage.input_tokens) || 0;
    const cacheRead = Number(usage.cache_read_tokens) || 0;
    // Thinking is billed as output.
    const output = (Number(usage.output_tokens) || 0) + (Number(usage.thinking_tokens) || 0);
    // input_tokens already includes whatever was served from cache.
    const tokens = Math.max(input, cacheRead) + output;
    const { costUsd } = priceOf(probe.priced, {
      input: Math.max(0, input - cacheRead),
      output,
      cacheRead,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
    });
    const after = await readBuckets(home);
    if (!after) continue;
    for (const b of after.filter((x) => x.group === probe.group)) {
      const prev = before.find((x) => x.group === b.group && x.window === b.window);
      // An unused window's reset time slides with the clock; once the probe
      // opens it, it's fixed. Either way a window that just opened started full.
      const from = prev && prev.resetsAt === b.resetsAt ? prev.remaining : 1;
      const delta = from - b.remaining;
      if (delta <= 0) continue;
      result.windows[`${b.group}-${b.window}`] = {
        group: b.group,
        window: b.window,
        tokens: tokens / delta,
        usd: costUsd / delta,
        model: probe.model,
        deltaPct: delta * 100,
        measuredAt: Date.now(),
      };
    }
  }
  if (!Object.keys(result.windows).length) throw new Error("Antigravity's meters didn't move, so nothing could be measured. Try again in a minute.");
  const all = readAll();
  all[accountKey] = result;
  fs.mkdirSync(USAGE_DIR, { recursive: true });
  fs.writeFileSync(CAL_FILE, JSON.stringify(all, null, 2));
  return result;
}
