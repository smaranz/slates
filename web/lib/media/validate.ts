import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_MUSIC_MODEL,
  DEFAULT_SPEECH_MODEL,
  DEFAULT_SPEECH_VOICE,
  DEFAULT_VIDEO_MODEL,
  IMAGE_MODELS,
  MUSIC_MODELS,
  SFX_MODEL,
  SPEECH_MODELS,
  VIDEO_MODELS,
  type ImageModel,
  type VideoModel,
} from "./catalog";
import { z } from "zod";

import type { GenerateInput, MediaOption, ResolvedMediaInput } from "./types";

/** Client-safe validation and conversion to ElevenLabs' wire option names. */

export class MediaInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaInputError";
  }
}

export interface MediaDefaults {
  speechModel?: string;
  speechVoice?: string;
}

const inputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("image"), prompt: z.string(), model: z.string().optional(), aspectRatio: z.string().optional(), resolution: z.string().optional(), quality: z.string().optional() }).strict(),
  z.object({ kind: z.literal("video"), prompt: z.string(), model: z.string().optional(), durationSecs: z.number().optional(), aspectRatio: z.string().optional(), resolution: z.string().optional(), generateAudio: z.boolean().optional(), negativePrompt: z.string().optional(), startFrameId: z.string().optional() }).strict(),
  z.object({ kind: z.literal("speech"), prompt: z.string(), voiceId: z.string().optional(), model: z.string().optional() }).strict(),
  z.object({ kind: z.literal("sfx"), prompt: z.string(), durationSecs: z.number().optional(), loop: z.boolean().optional(), promptInfluence: z.number().optional() }).strict(),
  z.object({ kind: z.literal("music"), prompt: z.string(), lengthSecs: z.number().optional(), instrumental: z.boolean().optional(), model: z.string().optional() }).strict(),
]);

function promptOf(input: GenerateInput, maxLength?: number): string {
  if (typeof input.prompt !== "string" || !input.prompt.trim()) {
    throw new MediaInputError("prompt can't be empty.");
  }
  if (maxLength !== undefined && input.prompt.length > maxLength) {
    throw new MediaInputError(`prompt is ${input.prompt.length} characters; this model allows ${maxLength}.`);
  }
  return input.prompt;
}

function allowedValues(values: readonly (string | number)[]): string {
  return values.map(String).join(" or ");
}

function choose<T extends string | number>(
  name: string,
  value: unknown,
  values: readonly T[],
  fallback: T,
  model: string,
): T {
  const picked = value === undefined ? fallback : value;
  if (!values.includes(picked as T)) {
    throw new MediaInputError(`${name} ${String(picked)} isn't available for ${model} — use ${allowedValues(values)}.`);
  }
  return picked as T;
}

function modelById<T extends { id: string }>(models: readonly T[], id: string, kind: string): T {
  const model = models.find((candidate) => candidate.id === id);
  if (!model) throw new MediaInputError(`Unknown ${kind} model "${id}" — choose ${models.map((m) => m.id).join(", ")}.`);
  return model;
}

function rejectUnsupported(field: string, model: string): never {
  throw new MediaInputError(`${field} isn't available for ${model}.`);
}

function image(input: Extract<GenerateInput, { kind: "image" }>): ResolvedMediaInput {
  const model = input.model ?? DEFAULT_IMAGE_MODEL;
  const spec = modelById(IMAGE_MODELS, model, "image") as ImageModel;
  const prompt = promptOf(input, spec.maxPromptLength);
  const aspectRatio = choose(
    "aspect_ratio",
    input.aspectRatio,
    spec.aspectRatio.values,
    spec.aspectRatio.values.includes("1:1") ? "1:1" : spec.aspectRatio.default,
    model,
  );
  const options: Record<string, MediaOption> = { model_id: model, aspect_ratio: aspectRatio };

  if (spec.resolution) {
    options.resolution = choose("resolution", input.resolution, spec.resolution.values, spec.resolution.default, model);
  } else if (input.resolution !== undefined) {
    rejectUnsupported("resolution", model);
  }
  if (spec.quality) {
    options.quality = choose("quality", input.quality, spec.quality.values, spec.quality.default, model);
  } else if (input.quality !== undefined) {
    rejectUnsupported("quality", model);
  }

  return { kind: input.kind, prompt, model, options };
}

function video(input: Extract<GenerateInput, { kind: "video" }>, testSpec?: VideoModel): ResolvedMediaInput {
  const model = input.model ?? DEFAULT_VIDEO_MODEL;
  const spec = testSpec ?? modelById(VIDEO_MODELS, model, "video") as VideoModel;
  const prompt = promptOf(input, spec.maxPromptLength);
  const durationControl = spec.duration;
  const duration = "values" in durationControl
    ? choose("duration_secs", input.durationSecs, durationControl.values, durationControl.default, model)
    : (() => {
        const value = input.durationSecs ?? durationControl.default;
        if (!Number.isInteger(value) || value < durationControl.min || value > durationControl.max) {
          throw new MediaInputError(`duration_secs ${value} must be an integer from ${durationControl.min} to ${durationControl.max} for ${model}.`);
        }
        return value;
      })();
  const aspectRatio = choose("aspect_ratio", input.aspectRatio, spec.aspectRatio.values, spec.aspectRatio.default, model);
  const resolution = choose("resolution", input.resolution, spec.resolution.values, spec.resolution.default, model);
  if (input.generateAudio !== undefined && !spec.generateAudio) rejectUnsupported("generate_audio", model);
  if (input.negativePrompt?.trim() && !spec.negativePrompt) rejectUnsupported("negative_prompt", model);
  if (input.startFrameId && !spec.startFrame) rejectUnsupported("start_frame", model);
  if (input.startFrameId && !/^med_[a-z0-9]{8,40}$/.test(input.startFrameId)) {
    throw new MediaInputError("start_frame_id must be a media library item id.");
  }

  const options: Record<string, MediaOption> = {
    model_id: model,
    duration_secs: duration,
    aspect_ratio: aspectRatio,
    resolution,
  };
  if (spec.generateAudio) options.generate_audio = input.generateAudio ?? false;
  if (input.negativePrompt?.trim()) options.negative_prompt = input.negativePrompt.trim();

  return {
    kind: input.kind,
    prompt,
    model,
    options,
    ...(input.startFrameId ? { startFrameId: input.startFrameId } : {}),
  };
}

function speech(input: Extract<GenerateInput, { kind: "speech" }>, defaults: MediaDefaults): ResolvedMediaInput {
  const model = input.model ?? defaults.speechModel ?? DEFAULT_SPEECH_MODEL;
  const spec = modelById(SPEECH_MODELS, model, "speech");
  const prompt = promptOf(input, spec.maxPromptLength);
  const voiceId = input.voiceId?.trim() || defaults.speechVoice || DEFAULT_SPEECH_VOICE;
  const options: Record<string, MediaOption> = {
    model_id: model,
    voice_id: voiceId,
    output_format: "mp3_44100_128",
  };
  return { kind: input.kind, prompt, model, voiceId, options };
}

function soundEffect(input: Extract<GenerateInput, { kind: "sfx" }>): ResolvedMediaInput {
  const model = SFX_MODEL;
  const prompt = promptOf(input);
  const options: Record<string, MediaOption> = {
    model_id: model,
    loop: input.loop ?? false,
    prompt_influence: input.promptInfluence ?? 0.3,
    output_format: "mp3_44100_128",
  };
  if (input.durationSecs !== undefined) {
    if (!Number.isFinite(input.durationSecs) || input.durationSecs < 0.5 || input.durationSecs > 30) {
      throw new MediaInputError(`duration_seconds ${input.durationSecs} must be between 0.5 and 30.`);
    }
    options.duration_seconds = input.durationSecs;
  }
  if (!Number.isFinite(input.promptInfluence ?? 0.3) || (input.promptInfluence ?? 0.3) < 0 || (input.promptInfluence ?? 0.3) > 1) {
    throw new MediaInputError("prompt_influence must be between 0 and 1.");
  }
  if (input.loop !== undefined && typeof input.loop !== "boolean") {
    throw new MediaInputError("loop must be true or false.");
  }
  return { kind: input.kind, prompt, model, options };
}

function music(input: Extract<GenerateInput, { kind: "music" }>): ResolvedMediaInput {
  const model = input.model ?? DEFAULT_MUSIC_MODEL;
  const spec = modelById(MUSIC_MODELS, model, "music");
  const prompt = promptOf(input, spec.maxPromptLength);
  const options: Record<string, MediaOption> = {
    model_id: model,
    force_instrumental: input.instrumental ?? false,
  };
  if (input.lengthSecs !== undefined) {
    if (!Number.isInteger(input.lengthSecs) || input.lengthSecs < 3 || input.lengthSecs > 300) {
      throw new MediaInputError(`music_length_ms ${input.lengthSecs} seconds must be an integer from 3 to 300.`);
    }
    options.music_length_ms = input.lengthSecs * 1000;
  }
  return { kind: input.kind, prompt, model, options };
}

export function validateVideoInput(
  input: Extract<GenerateInput, { kind: "video" }>,
  spec: VideoModel,
): ResolvedMediaInput {
  return video(input, spec);
}

export function resolveInput(input: unknown, defaults: MediaDefaults = {}): ResolvedMediaInput {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join(".");
    throw new MediaInputError(field ? `${field}: ${issue.message}` : issue?.message || "Invalid media request.");
  }
  const valid: GenerateInput = parsed.data;
  switch (valid.kind) {
    case "image":
      return image(valid);
    case "video":
      return video(valid);
    case "speech":
      return speech(valid, defaults);
    case "sfx":
      return soundEffect(valid);
    case "music":
      return music(valid);
    default:
      throw new MediaInputError("kind must be image, video, speech, sfx, or music.");
  }
}
