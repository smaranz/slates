import type { ThinkingLevel } from "./tutor-models";

/**
 * Every model family Devin offers this account, as `devin models list` printed
 * it on 2026-10-04, in Devin's own order. Each family's variants are the model
 * UIDs `devin --model` takes, default first; "fast"/"priority" variants (the
 * same model at twice the price) are left out, and Fusion keeps only its
 * Opus 5.5 + SWE-2 pairings. Re-run `devin models list` to refresh.
 */
export const DEVIN_FAMILIES = [
  { slug: "adaptive", label: "Adaptive", variants: ["adaptive"] },
  { slug: "swe-2", label: "SWE-2", variants: ["swe-2-high", "swe-2-medium", "swe-2-max"] },
  { slug: "swe-1.7-lightning", label: "SWE-1.7 Lightning", variants: ["swe-1-7-lightning", "swe-1-7-lightning-medium"] },
  { slug: "claude-fable-5.1", label: "Claude Fable 5.1", variants: ["claude-fable-5-1-medium", "claude-fable-5-1-low", "claude-fable-5-1-high", "claude-fable-5-1-xhigh", "claude-fable-5-1-max"] },
  { slug: "claude-opus-5.5", label: "Claude Opus 5.5", variants: ["claude-opus-5-5-medium", "claude-opus-5-5-low", "claude-opus-5-5-high", "claude-opus-5-5-xhigh", "claude-opus-5-5-max"] },
  { slug: "gpt-6-astra", label: "GPT-6 Astra", variants: ["gpt-6-astra-medium", "gpt-6-astra-low", "gpt-6-astra-high", "gpt-6-astra-xhigh", "gpt-6-astra-max"] },
  { slug: "gpt-6-sol", label: "GPT-6 Sol", variants: ["gpt-6-sol-medium", "gpt-6-sol-none", "gpt-6-sol-low", "gpt-6-sol-high", "gpt-6-sol-xhigh", "gpt-6-sol-max"] },
  { slug: "gpt-6-luna", label: "GPT-6 Luna", variants: ["gpt-6-luna-medium", "gpt-6-luna-none", "gpt-6-luna-low", "gpt-6-luna-high", "gpt-6-luna-xhigh", "gpt-6-luna-max"] },
  { slug: "kimi-k3", label: "Kimi K3", variants: ["kimi-k3-high", "kimi-k3-low", "kimi-k3-max"] },
  { slug: "glm-5.2", label: "GLM-5.2", variants: ["glm-5-2", "glm-5-2-max", "glm-5-2-1m", "glm-5-2-max-1m", "glm-5-2-none", "glm-5-2-none-1m"] },
  { slug: "glm-5.3", label: "GLM-5.3", variants: ["glm-5-3-low", "glm-5-3-high", "glm-5-3-max"] },
  { slug: "claude-sonnet-5.5", label: "Claude Sonnet 5.5", variants: ["claude-sonnet-5-5-medium", "claude-sonnet-5-5-low", "claude-sonnet-5-5-high", "claude-sonnet-5-5-xhigh", "claude-sonnet-5-5-max"] },
  { slug: "gemini-3.8-flash", label: "Gemini 3.8 Flash", variants: ["gemini-3-8-flash-medium", "gemini-3-8-flash-low", "gemini-3-8-flash-high"] },
  { slug: "claude-opus-4.7", label: "Claude Opus 4.7", variants: ["claude-opus-4-7-medium", "claude-opus-4-7-low", "claude-opus-4-7-high", "claude-opus-4-7-xhigh", "claude-opus-4-7-max"] },
  { slug: "claude-opus-4.8", label: "Claude Opus 4.8", variants: ["claude-opus-4-8-medium", "claude-opus-4-8-low", "claude-opus-4-8-high", "claude-opus-4-8-xhigh", "claude-opus-4-8-max"] },
  { slug: "claude-opus-5", label: "Claude Opus 5", variants: ["claude-opus-5-medium", "claude-opus-5-low", "claude-opus-5-high", "claude-opus-5-xhigh", "claude-opus-5-max"] },
  { slug: "claude-fable-5", label: "Claude Fable 5", variants: ["claude-5-fable-low", "claude-5-fable-medium", "claude-5-fable-high", "claude-5-fable-xhigh", "claude-5-fable-max"] },
  { slug: "claude-sonnet-5", label: "Claude Sonnet 5", variants: ["claude-sonnet-5-low", "claude-sonnet-5-medium", "claude-sonnet-5-high", "claude-sonnet-5-xhigh", "claude-sonnet-5-max"] },
  { slug: "gemini-3.5-flash", label: "Gemini 3.5 Flash", variants: ["gemini-3-5-flash-minimal", "gemini-3-5-flash-low", "gemini-3-5-flash-medium", "gemini-3-5-flash-high"] },
  { slug: "gemini-3.6-flash", label: "Gemini 3.6 Flash", variants: ["gemini-3-6-flash-minimal", "gemini-3-6-flash-low", "gemini-3-6-flash-medium", "gemini-3-6-flash-high"] },
  { slug: "gemini-3.7-flash", label: "Gemini 3.7 Flash", variants: ["gemini-3-7-flash-low", "gemini-3-7-flash-medium", "gemini-3-7-flash-high"] },
  { slug: "gpt-5.6-sol", label: "GPT-5.6 Sol", variants: ["gpt-5-6-sol-none", "gpt-5-6-sol-low", "gpt-5-6-sol-medium", "gpt-5-6-sol-high", "gpt-5-6-sol-xhigh", "gpt-5-6-sol-max"] },
  { slug: "gpt-5.6-terra", label: "GPT-5.6 Terra", variants: ["gpt-5-6-terra-none", "gpt-5-6-terra-low", "gpt-5-6-terra-medium", "gpt-5-6-terra-high", "gpt-5-6-terra-xhigh", "gpt-5-6-terra-max"] },
  { slug: "gpt-5.6-luna", label: "GPT-5.6 Luna", variants: ["gpt-5-6-luna-none", "gpt-5-6-luna-low", "gpt-5-6-luna-medium", "gpt-5-6-luna-high", "gpt-5-6-luna-xhigh", "gpt-5-6-luna-max"] },
  { slug: "gpt-6.1-sol", label: "GPT-6.1 Sol", variants: ["gpt-6-1-sol-low", "gpt-6-1-sol-medium", "gpt-6-1-sol-high", "gpt-6-1-sol-xhigh", "gpt-6-1-sol-max"] },
  { slug: "grok-4.5", label: "Grok 4.5", variants: ["grok-4-5-low", "grok-4-5-medium", "grok-4-5-high"] },
  { slug: "grok-4.6", label: "Grok 4.6", variants: ["grok-4-6-low", "grok-4-6-medium", "grok-4-6-high", "grok-4-6-xhigh"] },
  { slug: "grok-4.7", label: "Grok 4.7", variants: ["grok-4-7-low", "grok-4-7-medium", "grok-4-7-high", "grok-4-7-xhigh"] },
  { slug: "inkling", label: "Inkling", variants: ["inkling-none", "inkling-low", "inkling-medium", "inkling-high", "inkling-xhigh", "inkling-max"] },
  { slug: "glm-5.3-flash", label: "GLM-5.3 Flash", variants: ["glm-5-3-flash-low", "glm-5-3-flash-high", "glm-5-3-flash-max"] },
  { slug: "deepseek-v4-flash", label: "DeepSeek V4 Flash", variants: ["deepseek-v4-flash-high", "deepseek-v4-flash-max"] },
  { slug: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", variants: ["deepseek-v4-1-flash-high", "deepseek-v4-1-flash-max"] },
  { slug: "swe-1.7", label: "SWE-1.7", variants: ["swe-1-7", "swe-1-7-medium"] },
  { slug: "fusion", label: "Fusion", variants: ["fusion-claude-opus-5-5-high-sidekick-swe-2-medium", "fusion-claude-opus-5-5-medium-sidekick-swe-2-medium", "fusion-claude-opus-5-5-xhigh-sidekick-swe-2-medium", "fusion-claude-opus-5-5-low-sidekick-swe-2-medium", "fusion-claude-opus-5-5-max-sidekick-swe-2-medium"] },
  { slug: "claude-opus-4.6", label: "Claude Opus 4.6", variants: ["claude-opus-4-6", "claude-opus-4-6-thinking", "claude-opus-4-6-1m", "claude-opus-4-6-thinking-1m"] },
  { slug: "gpt-5.4", label: "GPT-5.4", variants: ["gpt-5-4-none", "gpt-5-4-low", "gpt-5-4-medium", "gpt-5-4-high", "gpt-5-4-xhigh"] },
  { slug: "gpt-5.5", label: "GPT-5.5", variants: ["gpt-5-5-none", "gpt-5-5-low", "gpt-5-5-medium", "gpt-5-5-high", "gpt-5-5-xhigh"] },
  { slug: "gpt-5.4-mini", label: "GPT-5.4 Mini", variants: ["gpt-5-4-mini-low", "gpt-5-4-mini-medium", "gpt-5-4-mini-high", "gpt-5-4-mini-xhigh"] },
  { slug: "claude-sonnet-4.6", label: "Claude Sonnet 4.6", variants: ["claude-sonnet-4-6", "claude-sonnet-4-6-thinking", "claude-sonnet-4-6-1m", "claude-sonnet-4-6-thinking-1m"] },
  { slug: "gpt-5.2", label: "GPT-5.2", variants: ["MODEL_GPT_5_2_LOW", "MODEL_GPT_5_2_MEDIUM", "MODEL_GPT_5_2_NONE", "MODEL_GPT_5_2_HIGH", "MODEL_GPT_5_2_XHIGH"] },
  { slug: "claude-opus-4.5", label: "Claude Opus 4.5", variants: ["MODEL_CLAUDE_4_5_OPUS", "MODEL_CLAUDE_4_5_OPUS_THINKING"] },
  { slug: "claude-haiku-4.5", label: "Claude Haiku 4.5", variants: ["MODEL_PRIVATE_11"] },
  { slug: "gpt-4.1", label: "GPT-4.1", variants: ["MODEL_CHAT_GPT_4_1_2025_04_14"] },
  { slug: "gpt-5.1", label: "GPT-5.1", variants: ["MODEL_PRIVATE_12", "MODEL_PRIVATE_13", "MODEL_PRIVATE_14", "MODEL_PRIVATE_15"] },
  { slug: "gpt-5.3-codex", label: "GPT-5.3-Codex", variants: ["gpt-5-3-codex-low", "gpt-5-3-codex-medium", "gpt-5-3-codex-high", "gpt-5-3-codex-xhigh"] },
  { slug: "kimi-k2.6", label: "Kimi K2.6", variants: ["kimi-k2-6"] },
  { slug: "kimi-k2.7", label: "Kimi K2.7", variants: ["kimi-k2-7"] },
  { slug: "nemotron-3-ultra", label: "Nemotron 3 Ultra", variants: ["nemotron-3-ultra-none", "nemotron-3-ultra-medium", "nemotron-3-ultra-high"] },
  { slug: "swe-1.6", label: "SWE-1.6", variants: ["swe-1-6"] },
  { slug: "swe-1.6-fast", label: "SWE-1.6 Fast", variants: ["swe-1-6-fast"] },
  { slug: "gemini-3.1-pro", label: "Gemini 3.1 Pro", variants: ["gemini-3-1-pro-low", "gemini-3-1-pro-high"] },
  { slug: "gemini-3-flash", label: "Gemini 3 Flash", variants: ["MODEL_GOOGLE_GEMINI_3_0_FLASH_MINIMAL", "MODEL_GOOGLE_GEMINI_3_0_FLASH_LOW", "MODEL_GOOGLE_GEMINI_3_0_FLASH_MEDIUM", "MODEL_GOOGLE_GEMINI_3_0_FLASH_HIGH"] },
  { slug: "deepseek-v4-pro", label: "DeepSeek V4 Pro", variants: ["deepseek-v4-pro-high", "deepseek-v4-pro-max"] },
] as const satisfies ReadonlyArray<{ slug: string; label: string; variants: readonly string[] }>;

export type DevinFamily = (typeof DEVIN_FAMILIES)[number];

/** Which variant suffixes stand for each thinking level, nearest first. */
const PREFER: Record<ThinkingLevel, string[]> = {
  low: ["low", "none", "minimal", "medium"],
  medium: ["medium", "high", "low"],
  high: ["high", "thinking", "max", "xhigh", "medium"],
  xhigh: ["xhigh", "max", "thinking", "high"],
};

/** A variant's thinking suffix: `claude-opus-5-5-high` → `high`, `MODEL_GPT_5_2_LOW` → `low`. */
function levelOf(variant: string): string {
  const id = variant.toLowerCase().replace(/_/g, "-").replace(/-sidekick-.*$/, "").replace(/-1m$/, "");
  return id.slice(id.lastIndexOf("-") + 1);
}

/** The model UID to run a family at a thinking level: its nearest variant, else its default. */
export function devinVariant(family: DevinFamily, thinking: ThinkingLevel): string {
  // The 1M-context variants are the same model with a bigger window; a tutor turn never needs it.
  const variants = family.variants.filter((v) => !/[-_]1m$/i.test(v));
  for (const level of PREFER[thinking]) {
    const hit = variants.find((v) => levelOf(v) === level);
    if (hit) return hit;
  }
  return family.variants[0];
}
