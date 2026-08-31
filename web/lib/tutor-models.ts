/** Who actually built a model — drives the logo and the picker's grouping. */
export type TutorModelCreator =
  | "openai"
  | "anthropic"
  | "xai"
  | "cursor"
  | "deepseek"
  | "zai"
  | "qwen"
  | "google";

/** How we actually reach a model — drives which SDK/credentials the route uses. */
export type TutorModelBackend = "openai" | "claude-code" | "cursor-agent" | "openrouter";

export const CREATOR_LABEL: Record<TutorModelCreator, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  xai: "xAI",
  cursor: "Cursor",
  deepseek: "DeepSeek",
  zai: "Z.ai",
  qwen: "Qwen",
  google: "Google",
};

interface TutorModelDef {
  id: string;
  label: string;
  creator: TutorModelCreator;
  backend: TutorModelBackend;
  /** Only set on the 8 Grok variants — drives the composite speed/thinking control. */
  grok?: { thinking: ThinkingLevel; fast: boolean };
  /** Only set on the 2 Composer variants — drives its speed toggle. */
  composer?: { fast: boolean };
}

/**
 * The four thinking levels every backend has some real lever for: Grok's
 * model id encodes it directly; OpenAI (`reasoningEffort`), Claude Code
 * (`effort`), and OpenRouter (`reasoning.effort`) all take it as a provider
 * option instead, shared across every model on that backend.
 */
export const THINKING_LEVELS = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra High" },
] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number]["id"];
export type GrokThinking = ThinkingLevel;
export const GROK_THINKING_LEVELS = THINKING_LEVELS;

export const DEFAULT_THINKING: ThinkingLevel = "medium";

/** Backends whose thinking level is a shared provider option, not baked into the model id. */
export function backendSupportsThinking(backend: TutorModelBackend): boolean {
  return backend === "openai" || backend === "claude-code" || backend === "openrouter";
}

export function grokModelId(thinking: ThinkingLevel, fast: boolean): string {
  return `cursor-grok-4.6-${thinking}${fast ? "-fast" : ""}`;
}

const GROK_MODELS: TutorModelDef[] = THINKING_LEVELS.flatMap(({ id: thinking }) =>
  [false, true].map((fast) => ({
    id: grokModelId(thinking, fast),
    label: "Grok 4.6",
    creator: "xai" as const,
    backend: "cursor-agent" as const,
    grok: { thinking, fast },
  }))
);

export function composerModelId(fast: boolean): string {
  return fast ? "composer-2.5-fast" : "composer-2.5";
}

const COMPOSER_MODELS: TutorModelDef[] = [false, true].map((fast) => ({
  id: composerModelId(fast),
  label: "Composer 2.5",
  creator: "cursor" as const,
  backend: "cursor-agent" as const,
  composer: { fast },
}));

/** Models the student can pick between in the tutor, grouped by creator. */
export const TUTOR_MODELS = [
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", creator: "openai", backend: "openai" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", creator: "openai", backend: "openai" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", creator: "openai", backend: "openai" },

  // Served through the local Claude Code CLI login — no ANTHROPIC_API_KEY needed.
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", creator: "anthropic", backend: "claude-code" },
  {
    id: "claude-haiku-4-5-20251001",
    label: "Claude Haiku 4.5",
    creator: "anthropic",
    backend: "claude-code",
  },
  { id: "claude-opus-5", label: "Claude Opus 5", creator: "anthropic", backend: "claude-code" },

  // Grok and Composer both run through the local Cursor CLI login (`cursor-agent login`).
  ...GROK_MODELS,
  ...COMPOSER_MODELS,

  // Everything below routes through OpenRouter — reads OPENROUTER_API_KEY.
  { id: "deepseek/deepseek-v4-pro", label: "Deepseek V4 Pro", creator: "deepseek", backend: "openrouter" },
  { id: "deepseek/deepseek-v4-flash", label: "Deepseek V4 Flash", creator: "deepseek", backend: "openrouter" },
  { id: "z-ai/glm-5.3", label: "GLM 5.3", creator: "zai", backend: "openrouter" },
  { id: "z-ai/glm-5.3-flash", label: "GLM 5.3 Flash", creator: "zai", backend: "openrouter" },
  { id: "qwen/qwen3.8-max", label: "Qwen 3.8 Max", creator: "qwen", backend: "openrouter" },
  { id: "qwen/qwen3.8-flash", label: "Qwen 3.8 Flash", creator: "qwen", backend: "openrouter" },
  { id: "google/gemini-3.7-flash", label: "Gemini 3.7 Flash", creator: "google", backend: "openrouter" },
  {
    id: "google/gemini-3.7-flash-lite",
    label: "Gemini 3.7 Flash Lite",
    creator: "google",
    backend: "openrouter",
  },
] as const satisfies ReadonlyArray<TutorModelDef>;

export type TutorModelId = (typeof TUTOR_MODELS)[number]["id"];

export const DEFAULT_TUTOR_MODEL: TutorModelId = "gpt-5.6-sol";

export function isTutorModel(value: unknown): value is TutorModelId {
  return TUTOR_MODELS.some((m) => m.id === value);
}

function findModel(id: TutorModelId): TutorModelDef {
  return TUTOR_MODELS.find((m) => m.id === id) ?? TUTOR_MODELS[0];
}

export function tutorModelLabel(id: TutorModelId): string {
  return findModel(id).label;
}

export function tutorModelCreator(id: TutorModelId): TutorModelCreator {
  return findModel(id).creator;
}

export function tutorModelBackend(id: TutorModelId): TutorModelBackend {
  return findModel(id).backend;
}

export function tutorModelGrok(id: TutorModelId): { thinking: GrokThinking; fast: boolean } | undefined {
  return findModel(id).grok;
}

export function tutorModelComposer(id: TutorModelId): { fast: boolean } | undefined {
  return findModel(id).composer;
}
