/** Who actually built a model — drives the logo and the picker's grouping. */
export type TutorModelCreator =
  | "openai"
  | "anthropic"
  | "xai"
  | "cursor"
  | "deepseek"
  | "zai"
  | "qwen"
  | "google"
  | "minimax";

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
  minimax: "MiniMax",
};

interface TutorModelDef {
  id: string;
  label: string;
  creator: TutorModelCreator;
  backend: TutorModelBackend;
  /**
   * Whether the model itself reads images. Only meaningful for OpenRouter,
   * where the id names one specific model with one specific set of input
   * modalities; the CLI/API backends are driven directly and all take images.
   * Taken from OpenRouter's own catalog (`architecture.input_modalities`) —
   * guessing here means a student attaches a photo of their homework and gets
   * an opaque provider error back.
   */
  vision?: boolean;
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

export const DEFAULT_THINKING: ThinkingLevel = "medium";

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return THINKING_LEVELS.some((t) => t.id === value);
}

/** Backends whose thinking level is a shared provider option, not baked into the model id. */
export function backendSupportsThinking(backend: TutorModelBackend): boolean {
  return backend === "openai" || backend === "claude-code" || backend === "openrouter";
}

/**
 * Whether this model takes attachments at all — photos and documents alike.
 *
 * OpenAI, Claude Code, and the Cursor SDK are driven directly and forward
 * images verbatim. OpenRouter used to be treated as one blanket "no", which
 * cost real capability: Gemini 3.7 Flash takes images, video, audio and
 * files, and Qwen, GLM 5.3 Flash and MiniMax all read images too. Each model
 * now answers for itself, from its published input modalities.
 *
 * The text-only ones — both DeepSeek V4s and plain GLM 5.3 — offer no
 * attachments in the composer. A document would technically survive the trip
 * (they're extracted to plain text in the browser), but a paperclip that
 * silently drops half of what you hand it is worse than no paperclip.
 */
export function tutorModelSupportsAttachments(id: TutorModelId): boolean {
  const model = findModel(id);
  return model.backend === "openrouter" ? model.vision === true : true;
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

  /*
   * Grok and Composer run through `@cursor/sdk`'s local Cursor CLI login.
   * The SDK loads a native tree-sitter binding for workspace scanning on
   * every `Agent.create` call, which is built against regular Node's ABI —
   * the *packaged* app spawns its portal server under Electron's bundled
   * Node (`ELECTRON_RUN_AS_NODE`), a different ABI, and a mismatch there
   * doesn't throw a catchable error, it segfaults the whole portal process.
   * Unpackaged dev runs (`npm run dev` / `npm run start`) use a plain Node
   * process instead, so they're unaffected. Confirm the packaged .app
   * (`npm run dist`) still works with these before shipping a release.
   */
  ...GROK_MODELS,
  ...COMPOSER_MODELS,

  // Everything below routes through OpenRouter — reads OPENROUTER_API_KEY.
  // `vision` mirrors each model's published input modalities, so the composer
  // offers a photo attachment exactly where one will actually be read.
  { id: "deepseek/deepseek-v4-pro", label: "Deepseek V4 Pro", creator: "deepseek", backend: "openrouter" },
  { id: "deepseek/deepseek-v4-flash", label: "Deepseek V4 Flash", creator: "deepseek", backend: "openrouter" },
  { id: "z-ai/glm-5.3", label: "GLM 5.3", creator: "zai", backend: "openrouter" },
  { id: "z-ai/glm-5.3-flash", label: "GLM 5.3 Flash", creator: "zai", backend: "openrouter", vision: true },
  { id: "qwen/qwen3.8-max", label: "Qwen 3.8 Max", creator: "qwen", backend: "openrouter", vision: true },
  { id: "qwen/qwen3.8-flash", label: "Qwen 3.8 Flash", creator: "qwen", backend: "openrouter", vision: true },
  { id: "minimax/minimax-m3", label: "MiniMax M3", creator: "minimax", backend: "openrouter", vision: true },
  {
    id: "google/gemini-3.7-flash",
    label: "Gemini 3.7 Flash",
    creator: "google",
    backend: "openrouter",
    vision: true,
  },
  // Google publishes no 3.7 Lite; 3.5 Flash Lite is the current small Gemini.
  {
    id: "google/gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash Lite",
    creator: "google",
    backend: "openrouter",
    vision: true,
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

export function tutorModelGrok(id: TutorModelId): { thinking: ThinkingLevel; fast: boolean } | undefined {
  return findModel(id).grok;
}

export function tutorModelComposer(id: TutorModelId): { fast: boolean } | undefined {
  return findModel(id).composer;
}
