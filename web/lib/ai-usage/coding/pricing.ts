import "server-only";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { USAGE_DIR } from "../store";

/**
 * API-equivalent prices for coding requests.
 *
 * What a subscription request "costs" is what the same tokens would have cost
 * on the pay-as-you-go API. Sources, best first:
 *   1. the Anthropic table below (exact per-model cache rates),
 *   2. models.dev — opencode keeps a copy at ~/.cache/opencode/models.json,
 *      and we fetch our own daily when it's missing or stale,
 *   3. LiteLLM's public price sheet (fetched daily),
 *   4. the built-in table,
 *   5. a sibling from the same family, flagged as an estimate.
 * Long-context tiers are applied per request, the way providers bill them.
 */

export interface Rate {
  /** USD per 1M tokens. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  /** Prices once a request's context passes `size` tokens. */
  tier?: { size: number; rate: Omit<Rate, "tier"> };
}

export interface PriceTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  fast?: boolean;
}

const OPENCODE_MODELS = path.join(os.homedir(), ".cache", "opencode", "models.json");
const MODELS_DEV_FILE = path.join(USAGE_DIR, "models-dev.json");
const LITELLM_FILE = path.join(USAGE_DIR, "prices.json");
const MODELS_DEV_URL = "https://models.dev/api.json";
const LITELLM_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const REFRESH_MS = 24 * 60 * 60 * 1000;

function anthropic(input: number, output: number, cacheRead = input * 0.1): Rate {
  return { input, output, cacheRead, cacheWrite5m: input * 1.25, cacheWrite1h: input * 2 };
}

function flat(input: number, output: number, cacheRead = input * 0.1): Rate {
  return { input, output, cacheRead, cacheWrite5m: input, cacheWrite1h: input };
}

/** Anthropic first-party list prices. These win over every sheet. */
const CLAUDE: { match: string; rate: Rate }[] = [
  { match: "claude-fable-5-1", rate: anthropic(10, 50, 0.25) },
  { match: "claude-mythos-5-1", rate: anthropic(10, 50, 0.25) },
  { match: "claude-fable", rate: anthropic(10, 50) },
  { match: "claude-mythos", rate: anthropic(10, 50) },
  { match: "claude-opus-5-5", rate: anthropic(4, 20, 0.2) },
  { match: "claude-opus-5", rate: anthropic(5, 25) },
  { match: "claude-opus-4-8", rate: anthropic(5, 25) },
  { match: "claude-opus-4-7", rate: anthropic(5, 25) },
  { match: "claude-opus-4-6", rate: anthropic(5, 25) },
  { match: "claude-opus-4-5", rate: anthropic(5, 25) },
  { match: "claude-opus", rate: anthropic(15, 75) },
  { match: "claude-sonnet-5", rate: anthropic(2, 10) },
  { match: "claude-sonnet", rate: anthropic(3, 15) },
  { match: "claude-haiku-4", rate: anthropic(1, 5) },
  { match: "claude-3-5-haiku", rate: anthropic(0.8, 4) },
  { match: "claude-haiku", rate: anthropic(1, 5) },
];

/** Offline floor for everything else. Substring-matched, most specific first. */
const BUILT_IN: { match: string; rate: Rate }[] = [
  { match: "gpt-6-astra", rate: flat(10, 50) },
  { match: "gpt-5.6-sol", rate: flat(4, 20) },
  { match: "gpt-5.6-terra", rate: flat(2, 12) },
  { match: "gpt-5.6-luna", rate: flat(0.2, 1.2) },
  { match: "gpt-5.6", rate: flat(4, 20) },
  { match: "gpt-5.3-codex", rate: flat(1.75, 14) },
  { match: "gpt-5-nano", rate: flat(0.05, 0.4) },
  { match: "gpt-5-mini", rate: flat(0.25, 2) },
  { match: "gpt-5", rate: flat(1.25, 10) },
  { match: "gpt-4.1-mini", rate: flat(0.4, 1.6) },
  { match: "gpt-4.1", rate: flat(2, 8, 0.5) },
  { match: "gpt-4o-mini", rate: flat(0.15, 0.6, 0.075) },
  { match: "gpt-4o", rate: flat(2.5, 10, 1.25) },
  { match: "o4-mini", rate: flat(1.1, 4.4, 0.275) },
  { match: "o3", rate: flat(2, 8, 0.5) },
  { match: "gemini-3.1-pro", rate: flat(2, 12, 0.2) },
  { match: "gemini-3-pro", rate: flat(2, 12, 0.2) },
  { match: "gemini-3.8-flash", rate: flat(0.75, 3.75) },
  { match: "gemini-3.7-flash", rate: flat(0.75, 3.75) },
  { match: "gemini-3.6-flash", rate: flat(0.75, 3.75) },
  { match: "gemini-3.5-flash-lite", rate: flat(0.3, 2.5) },
  { match: "gemini-3.5-flash", rate: flat(1.5, 9) },
  { match: "gemini-3.1-flash-lite", rate: flat(0.25, 1.5) },
  { match: "gemini-3-flash", rate: flat(0.5, 3) },
  { match: "gemini-2.5-pro", rate: flat(1.25, 10, 0.31) },
  { match: "gemini-2.5-flash-lite", rate: flat(0.1, 0.4, 0.025) },
  { match: "gemini-2.5-flash", rate: flat(0.3, 2.5, 0.075) },
];

// ── models.dev ────────────────────────────────────────────────────────────

interface DevCost {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
  tiers?: { input?: number; output?: number; cache_read?: number; cache_write?: number; tier?: { type?: string; size?: number } }[];
}

type DevCatalog = Record<string, { models?: Record<string, { cost?: DevCost }> }>;

let dev: DevIndex | null = null;
let devAt: number | null = null;
let devLoaded = false;

function devRate(c: DevCost): Rate | null {
  if (typeof c.input !== "number" || typeof c.output !== "number") return null;
  const base = (x: { input?: number; output?: number; cache_read?: number; cache_write?: number }) => {
    const input = x.input ?? 0;
    const write = x.cache_write ?? input;
    return { input, output: x.output ?? 0, cacheRead: x.cache_read ?? input * 0.1, cacheWrite5m: write, cacheWrite1h: write * 1.6 };
  };
  const rate: Rate = base(c);
  const t = c.tiers?.find((x) => x.tier?.type === "context" && typeof x.tier.size === "number");
  if (t) rate.tier = { size: t.tier!.size!, rate: base(t) };
  return rate;
}

/**
 * The model makers' own listings. Resellers list the same ids at their own
 * prices (and often without long-context tiers), so they are only a fallback.
 */
const FIRST_PARTY = ["anthropic", "openai", "google", "xai", "deepseek", "mistral", "moonshotai", "zai", "alibaba", "minimax"];

interface DevIndex {
  first: Map<string, Rate>;
  any: Map<string, Rate>;
}

function indexCatalog(cat: DevCatalog): DevIndex {
  const first = new Map<string, Rate>();
  const any = new Map<string, Rate>();
  const providers = Object.keys(cat).sort((a, b) => {
    const ia = FIRST_PARTY.indexOf(a);
    const ib = FIRST_PARTY.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  for (const p of providers) {
    const isFirst = FIRST_PARTY.includes(p);
    for (const [id, m] of Object.entries(cat[p]?.models ?? {})) {
      const key = id.toLowerCase().replace(/^[^/]+\//, "");
      if (!m.cost) continue;
      const rate = devRate(m.cost);
      if (!rate) continue;
      if (isFirst && !first.has(key)) first.set(key, rate);
      if (!any.has(key)) any.set(key, rate);
    }
  }
  return { first, any };
}

function loadDev(): void {
  if (devLoaded) return;
  devLoaded = true;
  // Whichever copy is newer: opencode's, or the one we fetched.
  const candidates = [OPENCODE_MODELS, MODELS_DEV_FILE]
    .map((f) => {
      try {
        return { f, at: fs.statSync(f).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((x): x is { f: string; at: number } => !!x)
    .sort((a, b) => b.at - a.at);
  for (const c of candidates) {
    try {
      dev = indexCatalog(JSON.parse(fs.readFileSync(c.f, "utf8")) as DevCatalog);
      devAt = c.at;
      return;
    } catch {
      // try the next copy
    }
  }
}

// ── LiteLLM ───────────────────────────────────────────────────────────────

interface LiteRow {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
  cache_creation_input_token_cost_above_1hr?: number;
}

let lite: Record<string, LiteRow> | null = null;
let liteAt: number | null = null;
let liteLoaded = false;

function loadLite(): void {
  if (liteLoaded) return;
  liteLoaded = true;
  try {
    const raw = JSON.parse(fs.readFileSync(LITELLM_FILE, "utf8")) as { at: number; models: Record<string, LiteRow> };
    lite = raw.models;
    liteAt = raw.at;
  } catch {
    lite = null;
  }
}

function fromLite(model: string): Rate | null {
  if (!lite) return null;
  const row = lite[model] ?? lite[`anthropic/${model}`] ?? lite[`openai/${model}`] ?? lite[`gemini/${model}`] ?? lite[model.replace(/-\d{8}$/, "")];
  if (!row?.input_cost_per_token || row.output_cost_per_token == null) return null;
  const cw5 = (row.cache_creation_input_token_cost ?? row.input_cost_per_token) * 1e6;
  return {
    input: row.input_cost_per_token * 1e6,
    output: row.output_cost_per_token * 1e6,
    cacheRead: (row.cache_read_input_token_cost ?? row.input_cost_per_token * 0.1) * 1e6,
    cacheWrite5m: cw5,
    cacheWrite1h: row.cache_creation_input_token_cost_above_1hr != null ? row.cache_creation_input_token_cost_above_1hr * 1e6 : cw5 * 1.6,
  };
}

// ── refresh ───────────────────────────────────────────────────────────────

let fetching = false;

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

/** Refresh stale price sheets in the background. Callers never wait on it. */
export function refreshPricesSoon(): void {
  loadDev();
  loadLite();
  if (fetching) return;
  const devStale = !devAt || Date.now() - devAt > REFRESH_MS;
  const liteStale = !liteAt || Date.now() - liteAt > REFRESH_MS;
  if (!devStale && !liteStale) return;
  fetching = true;
  void (async () => {
    try {
      fs.mkdirSync(USAGE_DIR, { recursive: true });
      if (devStale) {
        try {
          const cat = (await fetchJson(MODELS_DEV_URL)) as DevCatalog;
          fs.writeFileSync(MODELS_DEV_FILE, JSON.stringify(cat));
          dev = indexCatalog(cat);
          devAt = Date.now();
        } catch {
          // Offline — keep what we have.
        }
      }
      if (liteStale) {
        try {
          const all = (await fetchJson(LITELLM_URL)) as Record<string, LiteRow>;
          const models: Record<string, LiteRow> = {};
          for (const [k, v] of Object.entries(all)) {
            if (typeof v?.input_cost_per_token === "number" && typeof v?.output_cost_per_token === "number") models[k] = v;
          }
          const at = Date.now();
          fs.writeFileSync(LITELLM_FILE, JSON.stringify({ at, models }));
          lite = models;
          liteAt = at;
        } catch {
          // Offline — keep what we have.
        }
      }
      rateCache.clear();
    } finally {
      fetching = false;
    }
  })();
}

export function pricingSource(): { source: "models.dev" | "litellm" | "built-in"; updatedAt: number | null } {
  loadDev();
  loadLite();
  if (dev) return { source: "models.dev", updatedAt: devAt };
  if (lite) return { source: "litellm", updatedAt: liteAt };
  return { source: "built-in", updatedAt: null };
}

// ── lookup ────────────────────────────────────────────────────────────────

/** Claude, then the maker's own listing. The trusted sources. */
function official(model: string): Rate | null {
  const claude = CLAUDE.find((r) => model.includes(r.match));
  if (claude && model.includes("claude")) return claude.rate;
  return dev?.first.get(model) ?? dev?.first.get(model.replace(/-\d{8}$/, "")) ?? null;
}

/** Anything that lists this exact id, down to the built-in floor. */
function listed(model: string): Rate | null {
  return (
    official(model) ??
    fromLite(model) ??
    dev?.any.get(model) ??
    BUILT_IN.find((r) => model.includes(r.match))?.rate ??
    null
  );
}

/** "gpt-6-astra-fast", "gpt-5.6-sol-low" → the model underneath the mode suffix. */
const MODE_SUFFIX = /-(fast|priority|minimal|low|medium|high|xhigh|max)$/;

/** "gpt-6-sol" → another "gpt-6-…" model; "gemini-3.9-flash" → a "gemini-…-flash". */
function sibling(model: string): Rate | null {
  const parts = model.split("-");
  const maps = dev ? [dev.first, dev.any] : [];
  for (let n = parts.length - 1; n >= 2; n--) {
    const prefix = `${parts.slice(0, n).join("-")}-`;
    for (const m of maps) for (const [id, rate] of m) if (id.startsWith(prefix)) return rate;
    const b = BUILT_IN.find((r) => r.match.startsWith(prefix));
    if (b) return b.rate;
  }
  const tail = parts[parts.length - 1];
  if (parts[0] && tail) {
    for (const m of maps) for (const [id, rate] of m) if (id.startsWith(`${parts[0]}-`) && id.endsWith(`-${tail}`)) return rate;
  }
  return null;
}

function familyGuess(model: string): Rate {
  if (model.includes("claude")) return anthropic(5, 25);
  if (model.includes("gemini")) return model.includes("flash") ? flat(0.5, 3) : flat(2, 12);
  if (/mini|nano|flash|lite|luna/.test(model)) return flat(0.25, 2);
  return flat(2, 12);
}

const rateCache = new Map<string, { rate: Rate; estimated: boolean }>();

export function rateFor(model: string): { rate: Rate; estimated: boolean } {
  const key = model.toLowerCase().replace(/^(anthropic|openai|google|gemini|openrouter)\//, "");
  const hit = rateCache.get(key);
  if (hit) return hit;
  loadDev();
  loadLite();
  let out: { rate: Rate; estimated: boolean };
  const base = key.replace(MODE_SUFFIX, "");
  const trusted = official(key);
  // A mode variant the maker doesn't list is priced as its base model — the
  // way opencode bills it — before any reseller's listing of the variant.
  const viaBase = !trusted && base !== key ? official(base) : null;
  if (trusted) out = { rate: trusted, estimated: false };
  else if (viaBase) out = { rate: viaBase, estimated: true };
  else {
    const any = listed(key) ?? (base !== key ? listed(base) : null);
    out = any ? { rate: any, estimated: base !== key && !listed(key) } : { rate: sibling(key) ?? familyGuess(key), estimated: true };
  }
  rateCache.set(key, out);
  return out;
}

export function priceOf(model: string, t: PriceTokens): { costUsd: number; estimated: boolean } {
  const { rate, estimated } = rateFor(model);
  const context = t.input + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h;
  const r = rate.tier && context > rate.tier.size ? rate.tier.rate : rate;
  const usd =
    (t.input * r.input +
      t.output * r.output +
      t.cacheRead * r.cacheRead +
      t.cacheWrite5m * r.cacheWrite5m +
      t.cacheWrite1h * r.cacheWrite1h) /
    1e6;
  // Claude fast mode bills at twice the standard rate.
  return { costUsd: t.fast ? usd * 2 : usd, estimated };
}
