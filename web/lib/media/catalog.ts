/** Static model limits transcribed from ElevenLabs OpenAPI, 2026-09-26. */

export interface ChoiceControl<T extends string | number = string> {
  values: readonly T[];
  default: T;
}

export interface RangeControl {
  min: number;
  max: number;
  default: number;
}

export interface ImageModel {
  id: string;
  label: string;
  aspectRatio: ChoiceControl<string>;
  resolution?: ChoiceControl<string>;
  quality?: ChoiceControl<string>;
  needsApproval?: boolean;
  maxPromptLength?: number;
}

export interface VideoModel {
  id: string;
  label: string;
  duration: ChoiceControl<number> | RangeControl;
  aspectRatio: ChoiceControl<string>;
  resolution: ChoiceControl<string>;
  generateAudio: boolean;
  startFrame: boolean;
  negativePrompt: boolean;
  needsApproval?: boolean;
  maxPromptLength?: number;
}

export const DEFAULT_IMAGE_MODEL = "gpt-image-2";
export const DEFAULT_VIDEO_MODEL = "veo-3.1-fast-generate-001";
export const DEFAULT_SPEECH_MODEL = "eleven_multilingual_v2";
export const DEFAULT_SPEECH_VOICE = "JBFqnCBsd6RMkjVDRZzb";
export const SFX_MODEL = "eleven_text_to_sound_v2";
export const DEFAULT_MUSIC_MODEL = "music_v2_5";

const IMAGE_RATIO_GPT25 = [
  "auto", "1:1", "4:5", "5:4", "3:4", "4:3", "2:3", "3:2", "1:2", "2:1", "9:16", "16:9", "21:9", "1:3", "3:1",
] as const;
const IMAGE_RATIO_GEMINI = [
  "auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9",
] as const;
const VIDEO_RATIO = ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;

export const IMAGE_MODELS: readonly ImageModel[] = [
  {
    id: "gpt-image-2",
    label: "GPT Image 2",
    aspectRatio: { values: IMAGE_RATIO_GPT25, default: "16:9" },
    resolution: { values: ["1K", "2K", "4K"], default: "1K" },
    quality: { values: ["low", "medium", "high"], default: "medium" },
  },
  {
    id: "gpt-image-2.5-flare",
    label: "GPT Image 2.5 Flare",
    aspectRatio: { values: IMAGE_RATIO_GPT25, default: "16:9" },
    resolution: { values: ["1K", "2K", "4K"], default: "1K" },
    quality: { values: ["low", "medium", "high", "xhigh", "max"], default: "high" },
  },
  {
    id: "gpt-image-2.5-sunburst",
    label: "GPT Image 2.5 Sunburst",
    aspectRatio: { values: IMAGE_RATIO_GPT25, default: "16:9" },
    resolution: { values: ["1K", "2K", "4K"], default: "1K" },
    quality: { values: ["low", "medium", "high", "xhigh", "max"], default: "high" },
  },
  {
    id: "gpt-image-1.5",
    label: "GPT Image 1.5",
    aspectRatio: { values: ["1:1", "3:2", "2:3"], default: "1:1" },
    quality: { values: ["low", "medium", "high"], default: "medium" },
  },
  {
    id: "gpt-image-1",
    label: "GPT Image 1",
    aspectRatio: { values: ["1:1", "3:2", "2:3"], default: "1:1" },
    quality: { values: ["low", "medium", "high"], default: "medium" },
  },
  {
    id: "gemini-3-pro-image",
    label: "Gemini 3 Pro Image",
    aspectRatio: { values: IMAGE_RATIO_GEMINI, default: "16:9" },
    resolution: { values: ["1K", "2K", "4K"], default: "1K" },
  },
  {
    id: "gemini-3.1-flash-image",
    label: "Gemini 3.1 Flash Image",
    aspectRatio: {
      values: [...IMAGE_RATIO_GEMINI, "1:4", "4:1", "1:8", "8:1"],
      default: "16:9",
    },
    resolution: { values: ["512", "1K", "2K", "4K"], default: "1K" },
  },
  {
    id: "gemini-3.1-flash-lite-image",
    label: "Gemini 3.1 Flash Lite Image",
    aspectRatio: { values: IMAGE_RATIO_GEMINI, default: "16:9" },
    resolution: { values: ["1K"], default: "1K" },
  },
  {
    id: "gemini-2.5-flash-image",
    label: "Gemini 2.5 Flash Image",
    aspectRatio: { values: IMAGE_RATIO_GEMINI, default: "16:9" },
  },
  {
    id: "bytedance-seedream-5-pro",
    label: "Seedream 5 Pro",
    aspectRatio: { values: ["auto", "1:1", "3:4", "16:9", "4:3", "9:16"], default: "16:9" },
    resolution: { values: ["1K", "2K"], default: "2K" },
    needsApproval: true,
  },
  {
    id: "bytedance-seedream-5-lite",
    label: "Seedream 5 Lite",
    aspectRatio: { values: ["auto", "1:1", "3:4", "16:9", "4:3", "9:16"], default: "16:9" },
    resolution: { values: ["2K", "3K"], default: "2K" },
    needsApproval: true,
  },
];

export const VIDEO_MODELS: readonly VideoModel[] = [
  {
    id: "veo-3.1-fast-generate-001",
    label: "Veo 3.1 Fast",
    duration: { values: [4, 6, 8], default: 4 },
    aspectRatio: { values: ["16:9", "9:16"], default: "16:9" },
    resolution: { values: ["720p", "1080p", "4K"], default: "720p" },
    generateAudio: true,
    startFrame: true,
    negativePrompt: true,
  },
  {
    id: "veo-3.1-generate-001",
    label: "Veo 3.1",
    duration: { values: [4, 6, 8], default: 4 },
    aspectRatio: { values: ["16:9", "9:16"], default: "16:9" },
    resolution: { values: ["720p", "1080p", "4K"], default: "720p" },
    generateAudio: true,
    startFrame: true,
    negativePrompt: true,
  },
  {
    id: "bytedance-seedance-v2",
    label: "Seedance 2",
    duration: { min: 4, max: 15, default: 4 },
    aspectRatio: { values: VIDEO_RATIO, default: "16:9" },
    resolution: { values: ["480p", "720p", "1080p", "4k"], default: "720p" },
    generateAudio: true,
    startFrame: true,
    negativePrompt: false,
    needsApproval: true,
  },
  {
    id: "bytedance-seedance-v2-fast",
    label: "Seedance 2 Fast",
    duration: { min: 4, max: 15, default: 4 },
    aspectRatio: { values: VIDEO_RATIO, default: "16:9" },
    resolution: { values: ["480p", "720p"], default: "720p" },
    generateAudio: true,
    startFrame: true,
    negativePrompt: false,
    needsApproval: true,
  },
  {
    id: "bytedance-seedance-v2-mini",
    label: "Seedance 2 Mini",
    duration: { min: 4, max: 15, default: 4 },
    aspectRatio: { values: VIDEO_RATIO, default: "16:9" },
    resolution: { values: ["480p", "720p"], default: "720p" },
    generateAudio: true,
    startFrame: true,
    negativePrompt: false,
    needsApproval: true,
  },
  {
    id: "bytedance-seedance-v2.5",
    label: "Seedance 2.5",
    duration: { min: 4, max: 30, default: 4 },
    aspectRatio: { values: VIDEO_RATIO, default: "16:9" },
    resolution: { values: ["480p", "720p", "1080p"], default: "720p" },
    generateAudio: true,
    startFrame: true,
    negativePrompt: false,
    needsApproval: true,
  },
];

export const SPEECH_MODELS = [
  { id: "eleven_multilingual_v2", label: "Eleven Multilingual v2", maxPromptLength: 10_000 },
  { id: "eleven_v3", label: "Eleven v3", maxPromptLength: 5_000 },
  { id: "eleven_flash_v2_5", label: "Eleven Flash v2.5", maxPromptLength: 40_000 },
  { id: "eleven_turbo_v2_5", label: "Eleven Turbo v2.5", maxPromptLength: 40_000 },
] as const;

export const SFX_MODELS = [
  { id: "eleven_text_to_sound_v2", label: "Eleven Text to Sound v2", maxPromptLength: undefined },
] as const;

export const MUSIC_MODELS = [
  { id: "music_v2_5", label: "Music v2.5", maxPromptLength: 4100 },
  { id: "music_v2", label: "Music v2", maxPromptLength: 4100 },
] as const;
