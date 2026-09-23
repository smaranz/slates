import {
  DEFAULT_THINKING,
  isThinkingLevel,
  TUTOR_MODELS,
  type ThinkingLevel,
  type TutorModelId,
} from "../tutor-models";

/**
 * Which of the tutor's models the counselor can be driven by.
 *
 * Everything the tutor offers, minus the backends that cannot call a tool.
 * That line matters more here than in the tutor: the tutor is useful writing
 * prose, while most of what the counselor does *is* a tool call — recording a
 * GPA, adding a school, creating a task. A model that cannot call one still
 * answers fluently and changes nothing, which reads as the app being broken
 * rather than the model being unable.
 *
 * Two backends are excluded, both measured rather than assumed:
 *
 *   - `claude-code`. The Claude Code provider does not forward AI SDK tools,
 *     so Sonnet and Haiku each answer "I don't have access to a set_gpa tool"
 *     when told to use one. Nothing wrong with the models; the CLI exposes its
 *     own tools rather than accepting ours.
 *   - `cursor-agent` (Grok, Composer). Driven through a separate CLI path that
 *     takes a prompt and returns text, with no tool channel at all — and its
 *     native binding segfaults the packaged app (see lib/tutor-models.ts).
 *
 * Derived from TUTOR_MODELS rather than listed by hand, so a model added to
 * the tutor appears here too as soon as its backend can carry tools.
 */
const TOOL_CAPABLE_BACKENDS: readonly string[] = ["openai", "openrouter"];

export const COUNSELOR_MODELS: readonly TutorModelId[] = TUTOR_MODELS.filter((model) =>
  TOOL_CAPABLE_BACKENDS.includes(model.backend)
).map((model) => model.id);

export type CounselorModelId = TutorModelId;

export const DEFAULT_COUNSELOR_MODEL: CounselorModelId = "gpt-5.6-sol";

export function isCounselorModel(value: unknown): value is CounselorModelId {
  return COUNSELOR_MODELS.some((model) => model === value);
}

export function normalizeCounselorThinking(value: unknown): ThinkingLevel {
  return isThinkingLevel(value) ? value : DEFAULT_THINKING;
}
