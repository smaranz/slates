/**
 * Estimated USD rates for the usage ledger.
 *
 * These are list-price guesses so the dashboard has something useful to show —
 * not invoices. Claude Code and Cursor calls still get a listUsd; they are
 * marked covered so costUsd stays 0 (included in the local login).
 */

export type RateUnit = "tokens" | "characters" | "images";

export interface ModelRate {
  /** USD per 1M input tokens, or per 1K characters, or flat per image. */
  input: number;
  /** USD per 1M output tokens. Unused for characters/images. */
  output: number;
  unit: RateUnit;
}

const DEFAULT_TOKEN: ModelRate = { input: 2, output: 8, unit: "tokens" };

/** Prefix-matched rates. Longer / more specific prefixes should come first. */
const TOKEN_RATES: { match: string; rate: ModelRate }[] = [
  { match: "gpt-5.6-sol", rate: { input: 5, output: 30, unit: "tokens" } },
  { match: "gpt-5.6-terra", rate: { input: 1.25, output: 10, unit: "tokens" } },
  { match: "gpt-5.6-luna", rate: { input: 0.15, output: 0.6, unit: "tokens" } },
  { match: "gpt-realtime-2.1-mini", rate: { input: 10, output: 20, unit: "tokens" } },
  { match: "gpt-4o-mini-transcribe", rate: { input: 0.5, output: 0, unit: "tokens" } },
  { match: "claude-opus", rate: { input: 15, output: 75, unit: "tokens" } },
  { match: "claude-sonnet", rate: { input: 3, output: 15, unit: "tokens" } },
  { match: "claude-haiku", rate: { input: 1, output: 5, unit: "tokens" } },
  { match: "grok", rate: { input: 3, output: 15, unit: "tokens" } },
  { match: "composer", rate: { input: 1.25, output: 6, unit: "tokens" } },
  { match: "deepseek-v4-pro", rate: { input: 0.5, output: 1.5, unit: "tokens" } },
  { match: "deepseek-v4-flash", rate: { input: 0.1, output: 0.3, unit: "tokens" } },
  { match: "glm-5.3-flash", rate: { input: 0.1, output: 0.4, unit: "tokens" } },
  { match: "glm-5.3", rate: { input: 1, output: 3, unit: "tokens" } },
  { match: "qwen3.8-max", rate: { input: 1.2, output: 6, unit: "tokens" } },
  { match: "qwen3.8-flash", rate: { input: 0.1, output: 0.4, unit: "tokens" } },
  { match: "minimax-m3", rate: { input: 0.3, output: 1.2, unit: "tokens" } },
  { match: "gemini-3.7-flash", rate: { input: 0.15, output: 0.6, unit: "tokens" } },
  { match: "gemini-3.5-flash-lite", rate: { input: 0.05, output: 0.2, unit: "tokens" } },
];

const ELEVENLABS_CHARS: ModelRate = { input: 0.18, output: 0, unit: "characters" };
const ELEVENLABS_IMAGE: ModelRate = { input: 0.04, output: 0, unit: "images" };

export function rateForModel(model: string, unit?: RateUnit): ModelRate {
  if (unit === "images") return ELEVENLABS_IMAGE;
  if (unit === "characters") return ELEVENLABS_CHARS;

  const lower = model.toLowerCase();
  if (/gpt-image|eleven.*image|image-flow/i.test(lower)) return ELEVENLABS_IMAGE;
  if (/eleven_multilingual|elevenlabs|tts/i.test(lower)) return ELEVENLABS_CHARS;

  for (const row of TOKEN_RATES) {
    if (lower.includes(row.match)) return row.rate;
  }
  return DEFAULT_TOKEN;
}

export interface PriceInput {
  model: string;
  inputTokens: number;
  outputTokens?: number;
  unit?: RateUnit;
  /** Claude Code / Cursor — included in the local login. */
  covered?: boolean;
}

export interface PriceResult {
  listUsd: number;
  costUsd: number;
  covered: boolean;
  unit: RateUnit;
}

/** Estimate list and billed cost for one call. */
export function estimatePrice(input: PriceInput): PriceResult {
  const unit = input.unit ?? "tokens";
  const rate = rateForModel(input.model, unit);
  const covered = !!input.covered;
  const inTok = Math.max(0, input.inputTokens || 0);
  const outTok = Math.max(0, input.outputTokens || 0);

  let listUsd = 0;
  if (rate.unit === "characters") {
    listUsd = (inTok / 1000) * rate.input;
  } else if (rate.unit === "images") {
    listUsd = inTok * rate.input;
  } else {
    listUsd = (inTok / 1_000_000) * rate.input + (outTok / 1_000_000) * rate.output;
  }

  return {
    listUsd,
    costUsd: covered ? 0 : listUsd,
    covered,
    unit: rate.unit,
  };
}
