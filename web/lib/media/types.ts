/** Shared media shapes; safe to import in the browser and in plain Node. */

export type MediaKind = "image" | "video" | "speech" | "sfx" | "music";
export const MEDIA_KIND_LABEL: Record<MediaKind, string> = {
  image: "Image",
  video: "Video",
  speech: "Voice",
  sfx: "Sound",
  music: "Music",
};
export type MediaStatus = "generating" | "completed" | "failed";
export type MediaSource = "studio" | "mcp";
export type MediaOption = string | number | boolean;

export interface MediaItem {
  id: string;
  kind: MediaKind;
  status: MediaStatus;
  prompt: string;
  model: string;
  options: Record<string, MediaOption>;
  voiceName?: string;
  source: MediaSource;
  createdAt: number;
  completedAt?: number;
  remoteId?: string;
  file?: string;
  mime?: string;
  bytes?: number;
  durationSec?: number;
  error?: string;
  parentId?: string;
}

export type GenerateInput =
  | {
      kind: "image";
      prompt: string;
      model?: string;
      aspectRatio?: string;
      resolution?: string;
      quality?: string;
    }
  | {
      kind: "video";
      prompt: string;
      model?: string;
      durationSecs?: number;
      aspectRatio?: string;
      resolution?: string;
      generateAudio?: boolean;
      negativePrompt?: string;
      startFrameId?: string;
    }
  | { kind: "speech"; prompt: string; voiceId?: string; model?: string }
  | { kind: "sfx"; prompt: string; durationSecs?: number; loop?: boolean; promptInfluence?: number }
  | { kind: "music"; prompt: string; lengthSecs?: number; instrumental?: boolean; model?: string };

export interface ResolvedMediaInput {
  kind: MediaKind;
  prompt: string;
  model: string;
  options: Record<string, MediaOption>;
  voiceId?: string;
  startFrameId?: string;
}
