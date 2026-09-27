import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { noteUsage } from "../ai-usage/note-core";
import { activeApiSecret } from "../ai-usage/store-core";
import { DEFAULT_SPEECH_VOICE } from "./catalog";
import {
  createFlow,
  downloadContent,
  getFlow,
  listVoices,
  MissingElevenLabsKeyError,
  music,
  soundEffect,
  tts,
  type FlowKind,
  type FlowStatus,
} from "./elevenlabs";
import {
  getMedia,
  listMedia,
  mediaFilePath,
  newMediaId,
  saveItem,
  writeMediaFile,
} from "./library";
import { MediaInputError, resolveInput } from "./validate";
import type { GenerateInput, MediaItem, MediaOption, MediaSource, ResolvedMediaInput } from "./types";

/** Background media jobs persist every state change and can resume after reload. */

const execFileP = promisify(execFile);
const inFlight = new Map<string, Promise<unknown>>();
const IMAGE_POLL_MS = 2_000;
const VIDEO_POLL_MS = 5_000;
const IMAGE_TIMEOUT_MS = 3 * 60_000;
const VIDEO_TIMEOUT_MS = 15 * 60_000;
const INTERRUPTED_MS = 10 * 60_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function flowFailureText(status: FlowStatus, kind: FlowKind): string {
  if (status.error_message) {
    return status.failure_reason ? `${status.error_message} (${status.failure_reason})` : status.error_message;
  }
  return status.failure_reason || `${kind} generation failed.`;
}

async function setFailed(id: string, error: unknown): Promise<MediaItem | null> {
  const item = await getMedia(id);
  if (!item || item.status !== "generating") return item;
  const failed: MediaItem = { ...item, status: "failed", error: errorText(error), completedAt: Date.now() };
  await saveItem(failed);
  return failed;
}

async function probeDuration(file: string): Promise<number | null> {
  try {
    const result = await execFileP("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      file,
    ], { timeout: 8_000 });
    const value = Number.parseFloat(result.stdout.trim());
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function requestedDuration(item: MediaItem): number | undefined {
  if (item.kind === "video") return typeof item.options.duration_secs === "number" ? item.options.duration_secs : undefined;
  if (item.kind === "sfx") return typeof item.options.duration_seconds === "number" ? item.options.duration_seconds : undefined;
  if (item.kind === "music") return typeof item.options.music_length_ms === "number" ? item.options.music_length_ms / 1000 : undefined;
  return undefined;
}

async function recordSuccess(item: MediaItem): Promise<void> {
  if (item.kind === "image") {
    noteUsage({ agent: "media", model: item.model, backend: "elevenlabs", inputTokens: 1, unit: "images" });
    return;
  }
  if (item.kind === "speech") {
    noteUsage({ agent: "media", model: item.model, backend: "elevenlabs", inputTokens: item.prompt.length, unit: "characters" });
    return;
  }
  if (item.kind === "video") {
    noteUsage({
      agent: "media",
      model: item.model,
      backend: "elevenlabs",
      inputTokens: requestedDuration(item) ?? item.durationSec ?? 0,
      unit: "seconds",
      covered: true,
    });
    return;
  }
  noteUsage({
    agent: "media",
    model: item.model,
    backend: "elevenlabs",
    inputTokens: item.durationSec ?? requestedDuration(item) ?? 0,
    unit: "seconds",
  });
}

async function completeWithBytes(id: string, bytes: Buffer, mime: string): Promise<MediaItem> {
  const item = await getMedia(id);
  if (!item) throw new Error("Media item disappeared while it was generating.");
  const written = await writeMediaFile(id, bytes, mime);
  const durationSec = await probeDuration(mediaFilePath(written)) ?? requestedDuration(written);
  const completed: MediaItem = {
    ...written,
    status: "completed",
    completedAt: Date.now(),
    durationSec,
    error: undefined,
  };
  await saveItem(completed);
  await recordSuccess(completed);
  return completed;
}

async function resolveVoice(raw: string): Promise<{ id: string; name: string }> {
  const voices = await listVoices();
  const match = voices.find((voice) => voice.voice_id.toLowerCase() === raw.toLowerCase()) ??
    voices.find((voice) => voice.name.toLowerCase() === raw.toLowerCase());
  if (!match) throw new MediaInputError(`Voice "${raw}" wasn't found — choose a voice from the ElevenLabs voice list.`);
  return { id: match.voice_id, name: match.name };
}

function bodyOptions(options: Record<string, MediaOption>): Record<string, MediaOption> {
  return Object.fromEntries(Object.entries(options).filter(([key]) => key !== "output_format"));
}

async function runAudio(item: MediaItem, input: ResolvedMediaInput): Promise<void> {
  let bytes: Buffer;
  let mime: string;
  let voiceName: string | undefined;
  if (item.kind === "speech") {
    const voice = await resolveVoice(input.voiceId ?? DEFAULT_SPEECH_VOICE);
    voiceName = voice.name;
    const current = await getMedia(item.id);
    if (current) await saveItem({ ...current, voiceName, options: { ...current.options, voice_id: voice.id } });
    ({ bytes, mime } = await tts(voice.id, input.prompt, input.model));
  } else if (item.kind === "sfx") {
    const options = bodyOptions(input.options);
    ({ bytes, mime } = await soundEffect({
      text: input.prompt,
      ...(typeof options.duration_seconds === "number" ? { duration_seconds: options.duration_seconds } : {}),
      loop: options.loop === true,
      prompt_influence: typeof options.prompt_influence === "number" ? options.prompt_influence : 0.3,
      model_id: input.model,
    }));
  } else {
    ({ bytes, mime } = await music({
      prompt: input.prompt,
      ...(typeof input.options.music_length_ms === "number" ? { music_length_ms: input.options.music_length_ms } : {}),
      force_instrumental: input.options.force_instrumental === true,
      model_id: input.model,
    }));
  }
  const completed = await completeWithBytes(item.id, bytes, mime);
  if (voiceName && completed.voiceName !== voiceName) await saveItem({ ...completed, voiceName });
}

function startFlowPoll(id: string, kind: FlowKind): void {
  const job = Promise.resolve()
    .then(() => pollFlowUntilDone(id, kind))
    .catch((error: unknown) => setFailed(id, error).then(() => undefined))
    .finally(() => {
      if (inFlight.get(id) === job) inFlight.delete(id);
    });
  inFlight.set(id, job);
}

function startAudioJob(item: MediaItem, input: ResolvedMediaInput): void {
  const job = Promise.resolve()
    .then(() => runAudio(item, input))
    .catch((error: unknown) => setFailed(item.id, error).then(() => undefined))
    .finally(() => {
      if (inFlight.get(item.id) === job) inFlight.delete(item.id);
    });
  inFlight.set(item.id, job);
}

async function pollFlowUntilDone(id: string, kind: FlowKind): Promise<void> {
  const started = Date.now();
  const interval = kind === "video" ? VIDEO_POLL_MS : IMAGE_POLL_MS;
  const timeout = kind === "video" ? VIDEO_TIMEOUT_MS : IMAGE_TIMEOUT_MS;
  while (Date.now() - started < timeout) {
    await delay(interval);
    const item = await getMedia(id);
    if (!item || item.status !== "generating" || !item.remoteId) return;
    const status = await getFlow(kind, item.remoteId);
    if (status.status === "failed") {
      throw new Error(flowFailureText(status, kind));
    }
    if (status.status !== "completed") continue;
    if (!status.content_url) throw new Error("ElevenLabs reported the generation complete without a content URL.");
    const downloaded = await downloadContent(status.content_url);
    await completeWithBytes(id, downloaded.bytes, status.content_mime_type || downloaded.mime);
    return;
  }
  throw new Error(`Timed out waiting for the ${kind}.`);
}

async function pollFlowOnce(item: MediaItem): Promise<MediaItem> {
  if (!item.remoteId || (item.kind !== "image" && item.kind !== "video")) return item;
  const kind = item.kind;
  const status = await getFlow(kind, item.remoteId);
  if (status.status === "failed") return (await setFailed(item.id, flowFailureText(status, kind))) ?? item;
  if (status.status !== "completed") return item;
  if (!status.content_url) return (await setFailed(item.id, "ElevenLabs reported the generation complete without a content URL.")) ?? item;
  const downloaded = await downloadContent(status.content_url);
  return completeWithBytes(item.id, downloaded.bytes, status.content_mime_type || downloaded.mime);
}

export async function startGeneration(input: GenerateInput, source: MediaSource): Promise<MediaItem> {
  const key = activeApiSecret("elevenlabs");
  if (!key) throw new MissingElevenLabsKeyError();
  const normalized = resolveInput(input, {
    speechModel: process.env.ELEVENLABS_MODEL_ID,
    speechVoice: process.env.ELEVENLABS_VOICE_ID,
  });

  let parent: MediaItem | undefined;
  if (normalized.kind === "video" && normalized.startFrameId) {
    parent = await getMedia(normalized.startFrameId) ?? undefined;
    if (!parent || parent.kind !== "image" || parent.status !== "completed" || !parent.remoteId) {
      throw new MediaInputError("The start frame must be a completed image generation with an ElevenLabs generation id.");
    }
  }

  const item: MediaItem = {
    id: newMediaId(),
    kind: normalized.kind,
    status: "generating",
    prompt: normalized.prompt,
    model: normalized.model,
    options: normalized.options,
    source,
    createdAt: Date.now(),
    ...(parent ? { parentId: parent.id } : {}),
  };
  await saveItem(item);

  if (normalized.kind === "image" || normalized.kind === "video") {
    try {
      const body: Record<string, unknown> = { ...normalized.options, prompt: normalized.prompt };
      if (parent?.remoteId) body.start_frame = { type: "generation", generation_id: parent.remoteId };
      const remote = await createFlow(normalized.kind, body);
      const withRemote = await saveItem({ ...item, remoteId: remote.id });
      startFlowPoll(withRemote.id, normalized.kind);
      return withRemote;
    } catch (error) {
      await setFailed(item.id, error);
      throw error;
    }
  }

  startAudioJob(item, normalized);
  return item;
}

export async function refreshPending(item: MediaItem): Promise<MediaItem> {
  if (item.status !== "generating") return item;
  if (inFlight.has(item.id)) return item;
  if (!item.remoteId) {
    if (Date.now() - item.createdAt > INTERRUPTED_MS) {
      return (await setFailed(item.id, "Interrupted before it finished.")) ?? item;
    }
    return item;
  }

  const job = Promise.resolve()
    .then(() => pollFlowOnce(item))
    .catch(() => item)
    .finally(() => {
      if (inFlight.get(item.id) === job) inFlight.delete(item.id);
    });
  inFlight.set(item.id, job);
  return (await job) ?? item;
}

export async function refreshLibrary(items: MediaItem[]): Promise<MediaItem[]> {
  return Promise.all(items.map(refreshPending));
}

export async function waitForItem(id: string, ms: number): Promise<MediaItem | null> {
  const deadline = Date.now() + Math.max(0, ms);
  for (;;) {
    const item = await getMedia(id);
    if (!item || item.status !== "generating" || Date.now() >= deadline) return item;
    await refreshPending(item);
    await delay(Math.min(100, Math.max(1, deadline - Date.now())));
  }
}

export async function listMediaWithRefresh(options: Parameters<typeof listMedia>[0] = {}): Promise<MediaItem[]> {
  const items = await listMedia(options);
  return refreshLibrary(items);
}
