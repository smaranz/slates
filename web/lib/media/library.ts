import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { MediaItem, MediaKind } from "./types";

/** Durable media library shared by the Next server and the local MCP process. */

const ID = /^med_[a-z0-9]{8,40}$/;
const FILE = /^med_[a-z0-9]+\.[a-z0-9]{2,5}$/;

export function isMediaId(value: string): boolean {
  return ID.test(value);
}

export function mediaRoot(): string {
  return path.join(os.homedir(), ".slates", "media");
}

function itemsDir(): string {
  return path.join(mediaRoot(), "items");
}

function filesDir(): string {
  return path.join(mediaRoot(), "files");
}

function assertId(id: string): void {
  if (!isMediaId(id)) throw new Error("Invalid media id.");
}

function assertItemFile(item: MediaItem): void {
  if (item.file !== undefined && (!FILE.test(item.file) || !item.file.startsWith(`${item.id}.`))) {
    throw new Error("Invalid media file name.");
  }
}

function assertMediaItem(value: unknown, expectedId?: string): asserts value is MediaItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid media item.");
  const item = value as Partial<MediaItem>;
  if (typeof item.id !== "string" || !isMediaId(item.id) || (expectedId && item.id !== expectedId)) {
    throw new Error("Invalid media item id.");
  }
  if (!( ["image", "video", "speech", "sfx", "music"] as string[]).includes(item.kind ?? "")) {
    throw new Error("Invalid media item kind.");
  }
  if (!( ["generating", "completed", "failed"] as string[]).includes(item.status ?? "")) {
    throw new Error("Invalid media item status.");
  }
  if (typeof item.prompt !== "string" || typeof item.model !== "string") throw new Error("Invalid media item prompt or model.");
  if (item.source !== "studio" && item.source !== "mcp") throw new Error("Invalid media item source.");
  if (typeof item.createdAt !== "number" || !Number.isFinite(item.createdAt)) throw new Error("Invalid media item timestamp.");
  if (!item.options || typeof item.options !== "object" || Array.isArray(item.options)) throw new Error("Invalid media item options.");
  if (Object.values(item.options).some((option) =>
    typeof option !== "string" && typeof option !== "boolean" && (typeof option !== "number" || !Number.isFinite(option)),
  )) throw new Error("Invalid media item option value.");
  if (item.file !== undefined && typeof item.file !== "string") throw new Error("Invalid media file name.");
  if (item.completedAt !== undefined && (typeof item.completedAt !== "number" || !Number.isFinite(item.completedAt))) throw new Error("Invalid media item completion time.");
  if (item.bytes !== undefined && (typeof item.bytes !== "number" || !Number.isFinite(item.bytes) || item.bytes < 0)) throw new Error("Invalid media item size.");
  if (item.durationSec !== undefined && (typeof item.durationSec !== "number" || !Number.isFinite(item.durationSec) || item.durationSec < 0)) throw new Error("Invalid media item duration.");
  if (item.remoteId !== undefined && typeof item.remoteId !== "string") throw new Error("Invalid remote generation id.");
  if (item.parentId !== undefined && (typeof item.parentId !== "string" || !isMediaId(item.parentId))) throw new Error("Invalid parent media id.");
  if (item.mime !== undefined && typeof item.mime !== "string") throw new Error("Invalid media MIME type.");
  if (item.error !== undefined && typeof item.error !== "string") throw new Error("Invalid media item error.");
  if (item.voiceName !== undefined && typeof item.voiceName !== "string") throw new Error("Invalid voice name.");
  assertItemFile(item as MediaItem);
}

function atomicTemp(file: string): string {
  return `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
}

async function atomicWrite(file: string, bytes: Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = atomicTemp(file);
  try {
    await fs.writeFile(temporary, bytes, { mode: 0o600 });
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

export function newMediaId(): string {
  return `med_${Date.now().toString(36)}${randomBytes(8).toString("hex")}`;
}

export async function saveItem(item: MediaItem): Promise<MediaItem> {
  assertMediaItem(item);
  const file = path.join(itemsDir(), `${item.id}.json`);
  await atomicWrite(file, Buffer.from(`${JSON.stringify(item, null, 2)}\n`));
  return item;
}

export async function getMedia(id: string): Promise<MediaItem | null> {
  assertId(id);
  try {
    const raw: unknown = JSON.parse(await fs.readFile(path.join(itemsDir(), `${id}.json`), "utf8"));
    assertMediaItem(raw, id);
    return raw;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function listMedia({
  kind,
  query,
  limit,
}: {
  kind?: MediaKind;
  query?: string;
  limit?: number;
} = {}): Promise<MediaItem[]> {
  const search = query?.trim().toLowerCase();
  const max = limit === undefined ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor(limit));
  try {
    const names = await fs.readdir(itemsDir());
    const itemFiles = names.filter((name) => name.endsWith(".json") && isMediaId(name.slice(0, -5)));
    const found = await Promise.all(itemFiles.map(async (name) => {
      try {
        return await getMedia(name.slice(0, -5));
      } catch (error) {
        console.warn(`[media] skipping invalid item file ${name}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    }));
    return found
      .filter((item): item is MediaItem => !!item)
      .filter((item) => !kind || item.kind === kind)
      .filter((item) => !search || `${item.prompt} ${item.model} ${item.kind}`.toLowerCase().includes(search))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, max);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function writeMediaFile(id: string, bytes: Uint8Array, mime: string): Promise<MediaItem> {
  assertId(id);
  const item = await getMedia(id);
  if (!item) throw new Error("Media item not found.");
  const ext = extensionForMime(mime);
  const file = `${id}.${ext}`;
  if (!FILE.test(file) || !file.startsWith(`${id}.`)) throw new Error("Invalid media file name.");
  await atomicWrite(path.join(filesDir(), file), bytes);
  const updated: MediaItem = { ...item, file, mime, bytes: bytes.byteLength };
  await saveItem(updated);
  return updated;
}

export async function deleteMedia(id: string): Promise<boolean> {
  assertId(id);
  const item = await getMedia(id);
  if (!item) return false;
  await fs.rm(path.join(itemsDir(), `${id}.json`), { force: true });
  if (item.file) await fs.rm(mediaFilePath(item), { force: true });
  return true;
}

export function mediaFilePath(item: MediaItem): string {
  assertId(item.id);
  assertItemFile(item);
  if (!item.file) throw new Error("Media file is not available.");
  return path.join(filesDir(), item.file);
}

export function extensionForMime(mime: string): string {
  const type = mime.split(";")[0]?.trim().toLowerCase();
  if (type === "image/jpeg") return "jpg";
  if (type === "image/webp") return "webp";
  if (type === "image/png") return "png";
  if (type === "video/mp4") return "mp4";
  if (type === "audio/mpeg" || type === "audio/mp3") return "mp3";
  if (type === "audio/wav" || type === "audio/x-wav") return "wav";
  if (type === "audio/ogg") return "ogg";
  if (type === "audio/mp4") return "m4a";
  if (type === "audio/webm") return "webm";
  return "bin";
}
