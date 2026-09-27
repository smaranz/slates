import { activeApiSecret } from "../ai-usage/store-core";

/** Raw ElevenLabs requests shared by the media worker and the MCP tools. */

export type FlowKind = "image" | "video";

export class MissingElevenLabsKeyError extends Error {
  constructor() {
    super("ElevenLabs isn't connected. Link a key in AI Usage, or add ELEVENLABS_API_KEY to .env and restart.");
    this.name = "MissingElevenLabsKeyError";
  }
}

export class ElevenLabsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ElevenLabsError";
  }
}

export interface FlowStatus {
  status: "pending" | "generating" | "completed" | "failed";
  content_url?: string;
  content_mime_type?: string;
  failure_reason?: string;
  error_message?: string;
}

export interface Voice {
  voice_id: string;
  name: string;
  category?: string;
  preview_url?: string;
}

function baseUrl(): string {
  return (process.env.ELEVENLABS_API_BASE ?? "https://api.elevenlabs.io").replace(/\/$/, "");
}

function apiKey(): string {
  const key = activeApiSecret("elevenlabs");
  if (!key) throw new MissingElevenLabsKeyError();
  return key;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: { message?: string } | string; message?: string };
    const detail = typeof body.detail === "string" ? body.detail : body.detail?.message;
    return detail || body.message || response.statusText || "Unknown error";
  } catch {
    return response.statusText || "Unknown error";
  }
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const key = apiKey();
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      "xi-api-key": key,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const message = await readError(response);
    const detail = response.status === 401
      ? `ElevenLabs rejected the key (${message}). Update it in AI Usage or ELEVENLABS_API_KEY.`
      : `ElevenLabs returned ${response.status}: ${message}`;
    throw new ElevenLabsError(detail, response.status);
  }
  return response;
}

export async function createFlow(kind: FlowKind, body: Record<string, unknown>): Promise<{ id: string }> {
  const response = await request(`/v1/flows/${kind}`, { method: "POST", body: JSON.stringify(body) });
  const result = (await response.json()) as { id?: unknown };
  if (typeof result.id !== "string" || !result.id) throw new ElevenLabsError("ElevenLabs created no generation id.", 502);
  return { id: result.id };
}

export async function getFlow(kind: FlowKind, id: string): Promise<FlowStatus> {
  const response = await request(`/v1/flows/${kind}/${encodeURIComponent(id)}`);
  const result = (await response.json()) as FlowStatus;
  if (!result || !["pending", "generating", "completed", "failed"].includes(result.status)) {
    throw new ElevenLabsError("ElevenLabs returned an unknown generation status.", 502);
  }
  return result;
}

export async function downloadContent(url: string): Promise<{ bytes: Buffer; mime: string }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Couldn't download the generated file (${response.status}).`);
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    mime: response.headers.get("content-type")?.split(";")[0] || "application/octet-stream",
  };
}

async function audioResponse(path: string, body: Record<string, unknown>): Promise<{ bytes: Buffer; mime: string }> {
  const response = await request(path, { method: "POST", body: JSON.stringify(body) });
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    mime: response.headers.get("content-type")?.split(";")[0] || "audio/mpeg",
  };
}

export function tts(voiceId: string, text: string, modelId: string): Promise<{ bytes: Buffer; mime: string }> {
  return audioResponse(`/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    text,
    model_id: modelId,
  });
}

export function soundEffect(input: {
  text: string;
  duration_seconds?: number;
  loop: boolean;
  prompt_influence: number;
  model_id: string;
}): Promise<{ bytes: Buffer; mime: string }> {
  return audioResponse("/v1/sound-generation?output_format=mp3_44100_128", input);
}

export function music(input: {
  prompt: string;
  music_length_ms?: number;
  force_instrumental: boolean;
  model_id: string;
}): Promise<{ bytes: Buffer; mime: string }> {
  return audioResponse("/v1/music", input);
}

export async function listVoices(): Promise<Voice[]> {
  const response = await request("/v1/voices");
  const result = (await response.json()) as { voices?: Voice[] };
  return Array.isArray(result.voices) ? result.voices : [];
}
