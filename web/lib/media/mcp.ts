import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_MUSIC_MODEL,
  DEFAULT_SPEECH_MODEL,
  DEFAULT_SPEECH_VOICE,
  DEFAULT_VIDEO_MODEL,
  IMAGE_MODELS,
  MUSIC_MODELS,
  SFX_MODELS,
  SPEECH_MODELS,
  VIDEO_MODELS,
} from "./catalog";
import { listVoices } from "./elevenlabs";
import { getMedia, isMediaId, mediaFilePath } from "./library";
import { listMediaWithRefresh, refreshPending, startGeneration, waitForItem } from "./generate";
import type { GenerateInput, MediaItem, MediaKind } from "./types";

/**
 * Read-only media discovery plus credit-spending generation tools for slates-ui.
 *
 * With SLATES_HOST set — the same switch that turns the desktop app into a
 * window onto another machine — the library lives on that host, so every tool
 * goes through its /api/media endpoints instead of this machine's disk and
 * ElevenLabs key.
 */

type Entry = MediaItem & { filePath?: string };

interface Backend {
  /** The host URL, or null when the library is on this machine. */
  host: string | null;
  list(options: { kind?: MediaKind; query?: string; limit: number }): Promise<Entry[]>;
  get(id: string): Promise<Entry | null>;
  bytes(item: Entry): Promise<Buffer>;
  generate(input: GenerateInput, waitMs: number): Promise<Entry>;
  voices(): Promise<{ id: string; name: string }[]>;
}

const KINDS = ["image", "video", "speech", "sfx", "music"] as const satisfies readonly MediaKind[];
const INLINE_IMAGE_BYTES = 5 * 1024 * 1024;
const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
const failed = (error: unknown) => ({ ...text(error instanceof Error ? error.message : String(error)), isError: true });

function withPath(item: MediaItem): Entry {
  return item.file ? { ...item, filePath: mediaFilePath(item) } : item;
}

const local: Backend = {
  host: null,
  async list(options) {
    return (await listMediaWithRefresh(options)).map(withPath);
  },
  async get(id) {
    const found = await getMedia(id);
    return found ? withPath(await refreshPending(found)) : null;
  },
  bytes(item) {
    return readFile(mediaFilePath(item));
  },
  async generate(input, waitMs) {
    const started = await startGeneration(input, "mcp");
    const item = waitMs > 0 ? await waitForItem(started.id, waitMs) : started;
    if (!item) throw new Error("The media item disappeared.");
    return withPath(item);
  },
  async voices() {
    return (await listVoices()).map((voice) => ({ id: voice.voice_id, name: voice.name }));
  },
};

function remote(host: string): Backend {
  async function call<T>(pathAndQuery: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${host}${pathAndQuery}`, {
        ...init,
        headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new Error(`Couldn't reach the Slates host at ${host} (${error instanceof Error ? error.message : String(error)}). Is it running?`);
    }
    const body = (await response.json().catch(() => null)) as ({ error?: string } & T) | null;
    if (!response.ok) throw new Error(body?.error ?? `The Slates host at ${host} answered ${response.status}. Is it running?`);
    if (!body) throw new Error(`The Slates host at ${host} sent an empty reply.`);
    return body;
  }

  async function get(id: string): Promise<Entry | null> {
    try {
      return (await call<{ item: Entry }>(`/api/media?id=${encodeURIComponent(id)}`)).item;
    } catch (error) {
      if (error instanceof Error && error.message === "Media item not found.") return null;
      throw error;
    }
  }

  return {
    host,
    async list({ kind, query, limit }) {
      const params = new URLSearchParams({ limit: String(limit) });
      if (kind) params.set("kind", kind);
      if (query) params.set("q", query);
      return (await call<{ items: Entry[] }>(`/api/media?${params}`)).items;
    },
    get,
    async bytes(item) {
      const response = await fetch(`${host}/api/media/file?id=${encodeURIComponent(item.id)}`, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`The Slates host at ${host} couldn't send that file (${response.status}).`);
      return Buffer.from(await response.arrayBuffer());
    },
    async generate(input, waitMs) {
      let item = (await call<{ item: Entry }>("/api/media", { method: "POST", body: JSON.stringify(input) })).item;
      const deadline = Date.now() + waitMs;
      while (item.status === "generating" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(item.kind === "video" ? 5_000 : 2_000, Math.max(0, deadline - Date.now()))));
        item = (await get(item.id)) ?? item;
      }
      return item;
    },
    async voices() {
      return (await call<{ voices: { id: string; name: string }[] }>("/api/media/voices")).voices;
    },
  };
}

function backend(): Backend {
  const host = (process.env.SLATES_HOST ?? "").trim().replace(/\/+$/, "");
  return host ? remote(host) : local;
}

function localMinute(time: number): string {
  return new Date(time).toLocaleString(undefined, {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function shortPrompt(prompt: string): string {
  const oneLine = prompt.replace(/\s+/g, " ").trim();
  return oneLine.length > 80 ? `${oneLine.slice(0, 79)}…` : oneLine;
}

function where(item: Entry, from: Backend): string {
  if (item.status !== "completed" || !item.file) return "";
  return from.host ? ` · on ${from.host}` : ` · ${item.filePath ?? mediaFilePath(item)}`;
}

function row(item: Entry, from: Backend): string {
  return `- ${item.id} · ${item.kind} · ${item.status} · ${item.model} · ${localMinute(item.createdAt)} · "${shortPrompt(item.prompt)}"${where(item, from)}`;
}

function stillGenerating(item: Entry): string {
  const elapsed = Math.max(0, Math.floor((Date.now() - item.createdAt) / 1000));
  return `Still generating (started ${elapsed}s ago) — call get_media again shortly. id: ${item.id}`;
}

async function describe(item: Entry, from: Backend) {
  const file = item.status !== "completed" || !item.file
    ? "not ready"
    : from.host
      ? `stored on the Slates host (${from.host}); save_media copies it into this project`
      : item.filePath ?? mediaFilePath(item);
  const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [
    { type: "text", text: [`# ${item.id}`, `File: ${file}`, JSON.stringify(item, null, 2)].join("\n\n") },
  ];
  if (item.kind === "image" && item.status === "completed" && item.file && (item.bytes ?? 0) <= INLINE_IMAGE_BYTES) {
    content.push({ type: "image", data: (await from.bytes(item)).toString("base64"), mimeType: item.mime || "image/png" });
  }
  return { content };
}

function control<T extends string | number>(value: { values: readonly T[]; default: T }): string {
  return `${value.values.join(", ")} (default ${value.default})`;
}

function modelLines(kind: MediaKind): string[] {
  if (kind === "image") {
    return IMAGE_MODELS.map((model) =>
      `- ${model.id}${model.id === DEFAULT_IMAGE_MODEL ? " (default)" : ""}${model.needsApproval ? " · needs ElevenLabs approval" : ""}` +
      ` · aspect_ratio ${control(model.aspectRatio)}` +
      (model.resolution ? ` · resolution ${control(model.resolution)}` : "") +
      (model.quality ? ` · quality ${control(model.quality)}` : ""),
    );
  }
  if (kind === "video") {
    return VIDEO_MODELS.map((model) => {
      const duration = "values" in model.duration
        ? control(model.duration)
        : `${model.duration.min}–${model.duration.max} (default ${model.duration.default})`;
      return `- ${model.id}${model.id === DEFAULT_VIDEO_MODEL ? " (default)" : ""}${model.needsApproval ? " · needs ElevenLabs approval" : ""}` +
        ` · duration_secs ${duration} · aspect_ratio ${control(model.aspectRatio)} · resolution ${control(model.resolution)}` +
        ` · generate_audio ${model.generateAudio ? "false by default (supported)" : "unavailable"}` +
        ` · start_frame ${model.startFrame ? "supported" : "unavailable"}` +
        ` · negative_prompt ${model.negativePrompt ? "supported" : "unavailable"}`;
    });
  }
  if (kind === "speech") return SPEECH_MODELS.map((model) =>
    `- ${model.id}${model.id === (process.env.ELEVENLABS_MODEL_ID || DEFAULT_SPEECH_MODEL) ? " (default)" : ""} · max ${model.maxPromptLength.toLocaleString()} characters`,
  );
  if (kind === "sfx") return SFX_MODELS.map((model) => `- ${model.id} (default) · duration_seconds 0.5–30 or automatic · loop · prompt_influence 0–1 (default 0.3)`);
  return MUSIC_MODELS.map((model) =>
    `- ${model.id}${model.id === DEFAULT_MUSIC_MODEL ? " (default)" : ""} · music_length_ms 3–300 seconds or automatic · force_instrumental · max ${model.maxPromptLength.toLocaleString()} characters`,
  );
}

function promptSlug(prompt: string): string {
  return prompt.normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "media";
}

async function saveCopy(id: string, destination: string, overwrite: boolean): Promise<string> {
  if (!isMediaId(id)) throw new Error("Invalid media id.");
  const from = backend();
  const item = await from.get(id);
  if (!item || item.status !== "completed" || !item.file) throw new Error("This media file isn't ready to save.");
  const target = path.resolve(process.cwd(), destination);
  const isDirectory = destination.endsWith("/") || destination.endsWith("\\") ||
    await stat(target).then((info) => info.isDirectory(), () => false);
  const extension = item.file.split(".").at(-1) ?? "bin";
  const absolute = path.resolve(isDirectory
    ? path.join(target, `${promptSlug(item.prompt)}-${item.id.slice(-8)}.${extension}`)
    : target);
  await mkdir(path.dirname(absolute), { recursive: true });
  const bytes = await from.bytes(item);
  try {
    await writeFile(absolute, bytes, { flag: overwrite ? "w" : "wx" });
  } catch (error) {
    if (!overwrite && (error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`${absolute} already exists — pass overwrite: true to replace it.`);
    }
    throw error;
  }
  return `${absolute} · ${bytes.byteLength} bytes · ${item.mime || "application/octet-stream"}`;
}

async function generate(input: GenerateInput, waitSeconds: number) {
  try {
    const from = backend();
    const item = await from.generate(input, waitSeconds * 1000);
    if (item.status === "generating") return text(stillGenerating(item));
    if (item.status === "failed") return { ...text(`${item.id} failed: ${item.error ?? "Generation failed."}`), isError: true };
    return describe(item, from);
  } catch (error) {
    return failed(error);
  }
}

export function registerMediaTools(server: McpServer): void {
  server.registerTool(
    "list_media",
    {
      description: "List generated items in the Media Gen Studio library.",
      inputSchema: {
        kind: z.enum(KINDS).optional().describe("Filter by media kind."),
        query: z.string().optional().describe("Search prompt text or model name."),
        limit: z.number().int().min(1).max(200).default(30).describe("Maximum rows, default 30."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ kind, query, limit }) => {
      try {
        const from = backend();
        const items = await from.list({ kind, query, limit });
        return text(items.length ? items.map((item) => row(item, from)).join("\n") : "The media library is empty.");
      } catch (error) {
        return failed(error);
      }
    },
  );

  server.registerTool(
    "get_media",
    {
      description: "Read a media item's full metadata and where its file is; completed images up to 5 MB are returned as image content too.",
      inputSchema: { id: z.string().describe("Media item id from list_media.") },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      try {
        if (!isMediaId(id)) throw new Error("Invalid media id.");
        const from = backend();
        const item = await from.get(id);
        if (!item) throw new Error("Media item not found.");
        if (item.status === "generating") return text(`${stillGenerating(item)}\n\n${JSON.stringify(item, null, 2)}`);
        return describe(item, from);
      } catch (error) {
        return failed(error);
      }
    },
  );

  server.registerTool(
    "save_media",
    {
      description: "Copy a completed library file into a destination path or directory.",
      inputSchema: {
        id: z.string().describe("Completed media item id."),
        dest: z.string().min(1).describe("Destination path; relative paths resolve from the MCP working directory."),
        overwrite: z.boolean().default(false).describe("Replace an existing destination file (default false)."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ id, dest, overwrite }) => {
      try {
        return text(await saveCopy(id, dest, overwrite));
      } catch (error) {
        return failed(error);
      }
    },
  );

  server.registerTool(
    "list_media_models",
    {
      description: "List Media Gen Studio models, defaults and allowed options; also lists account voices for speech.",
      inputSchema: { kind: z.enum(KINDS).optional().describe("Show one media kind; omit for all models.") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ kind }) => {
      const kinds = kind ? [kind] : KINDS;
      const sections = kinds.map((entry) => `## ${entry}\n${modelLines(entry).join("\n")}`);
      if (!kind || kind === "speech") {
        try {
          const voices = await backend().voices();
          const defaultVoice = process.env.ELEVENLABS_VOICE_ID || DEFAULT_SPEECH_VOICE;
          sections.push(`## voices\nDefault voice: ${defaultVoice}\n${voices.map((voice) => `- ${voice.id} — ${voice.name}${voice.id === defaultVoice ? " (default)" : ""}`).join("\n")}`);
        } catch (error) {
          sections.push(`## voices\n${error instanceof Error && error.name === "MissingElevenLabsKeyError" ? "ElevenLabs isn't connected." : error instanceof Error ? error.message : String(error)}`);
        }
      }
      return text(sections.join("\n\n"));
    },
  );

  server.registerTool(
    "generate_image",
    {
      description: "Generate an image with ElevenLabs; this spends ElevenLabs credits.",
      inputSchema: {
        prompt: z.string().describe("Image description."),
        model: z.string().optional(),
        aspect_ratio: z.string().optional(),
        resolution: z.string().optional(),
        quality: z.string().optional(),
        wait_seconds: z.number().int().min(0).max(600).optional().describe("Wait for completion, default 55 seconds."),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async ({ prompt, model, aspect_ratio, resolution, quality, wait_seconds = 55 }) =>
      generate({ kind: "image", prompt, model, aspectRatio: aspect_ratio, resolution, quality }, wait_seconds),
  );

  server.registerTool(
    "generate_video",
    {
      description: "Generate a video with ElevenLabs; this spends ElevenLabs credits. It usually takes 1+ minutes, so pass wait_seconds to wait or call get_media later. Pass a studio image id as start_frame_id to animate it.",
      inputSchema: {
        prompt: z.string(),
        model: z.string().optional(),
        duration_seconds: z.number().optional(),
        aspect_ratio: z.string().optional(),
        resolution: z.string().optional(),
        generate_audio: z.boolean().optional(),
        negative_prompt: z.string().optional(),
        start_frame_id: z.string().optional(),
        wait_seconds: z.number().int().min(0).max(600).optional().describe("Wait for completion, default 55 seconds."),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async ({ prompt, model, duration_seconds, aspect_ratio, resolution, generate_audio, negative_prompt, start_frame_id, wait_seconds = 55 }) =>
      generate({
        kind: "video", prompt, model, durationSecs: duration_seconds, aspectRatio: aspect_ratio,
        resolution, generateAudio: generate_audio, negativePrompt: negative_prompt, startFrameId: start_frame_id,
      }, wait_seconds),
  );

  server.registerTool(
    "generate_speech",
    {
      description: "Generate speech with ElevenLabs; this spends ElevenLabs credits.",
      inputSchema: {
        text: z.string(),
        voice: z.string().optional().describe("ElevenLabs voice id or name."),
        model: z.string().optional(),
        wait_seconds: z.number().int().min(0).max(600).optional().describe("Wait for completion, default 55 seconds."),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async ({ text: prompt, voice, model, wait_seconds = 55 }) =>
      generate({ kind: "speech", prompt, voiceId: voice, model }, wait_seconds),
  );

  server.registerTool(
    "generate_sound_effect",
    {
      description: "Generate a sound effect with ElevenLabs; this spends ElevenLabs credits.",
      inputSchema: {
        prompt: z.string(),
        duration_seconds: z.number().optional(),
        loop: z.boolean().optional(),
        prompt_influence: z.number().optional(),
        wait_seconds: z.number().int().min(0).max(600).optional().describe("Wait for completion, default 55 seconds."),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async ({ prompt, duration_seconds, loop, prompt_influence, wait_seconds = 55 }) =>
      generate({ kind: "sfx", prompt, durationSecs: duration_seconds, loop, promptInfluence: prompt_influence }, wait_seconds),
  );

  server.registerTool(
    "generate_music",
    {
      description: "Generate music with ElevenLabs; this spends ElevenLabs credits.",
      inputSchema: {
        prompt: z.string(),
        length_seconds: z.number().optional(),
        instrumental: z.boolean().optional(),
        model: z.string().optional(),
        wait_seconds: z.number().int().min(0).max(600).optional().describe("Wait for completion, default 55 seconds."),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async ({ prompt, length_seconds, instrumental, model, wait_seconds = 55 }) =>
      generate({ kind: "music", prompt, lengthSecs: length_seconds, instrumental, model }, wait_seconds),
  );
}
