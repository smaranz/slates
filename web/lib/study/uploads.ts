import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { extractText, READABLE, type TextLimits } from "../attachment-text";
import type { StudyUpload } from "./types";

/**
 * Files a student uploads for a study set, kept on the host beside the sets
 * (~/.slates/study/uploads) so the phone and the laptop see the same ones.
 *
 * The text is read once, when the file arrives: the student sees straight
 * away whether Slates can use it, and a build never waits on a PDF parse.
 */

export const UPLOAD_EXTS = READABLE;
/** Enough for a scanned chapter. next.config.ts lets the proxy buffer a little more than this. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** More than a Schoology handout gets, because the student chose this one. */
const LIMITS: TextLimits = { chars: 30_000, pages: 80 };
const ID = /^u[a-f0-9]{20}$/;

type Stored = StudyUpload & { text: string };

export function isUploadId(id: string): boolean {
  return ID.test(id);
}

function dir(): string {
  return path.join(os.homedir(), ".slates", "study", "uploads");
}

function metaFile(id: string): string {
  if (!isUploadId(id)) throw new Error("Invalid upload id.");
  return path.join(dir(), `${id}.json`);
}

export function extOf(name: string): string {
  return (/\.([a-z0-9]{1,8})$/i.exec(name)?.[1] ?? "").toLowerCase();
}

export async function saveUpload(name: string, bytes: ArrayBuffer): Promise<StudyUpload> {
  const ext = extOf(name);
  if (!UPLOAD_EXTS.includes(ext)) {
    throw new Error(`Slates can read ${UPLOAD_EXTS.slice(0, -1).map((e) => e.toUpperCase()).join(", ")} and ${UPLOAD_EXTS.at(-1)!.toUpperCase()} files.`);
  }
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error(`That file is over ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);

  const id = `u${randomBytes(10).toString("hex")}`;
  await fs.mkdir(dir(), { recursive: true });
  // Written before reading: pdf.js can take the buffer over.
  await fs.writeFile(path.join(dir(), `${id}.${ext}`), Buffer.from(bytes), { mode: 0o600 });

  let text = "";
  let error: string | undefined;
  try {
    text = (await extractText(bytes.slice(0), ext, LIMITS)).trim();
    if (!text) error = "There's no text in this file Slates can read. Scanned pages without a text layer can't be read yet.";
  } catch (err) {
    error = `Couldn’t read it: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`;
  }

  const stored: Stored = { id, name: name.slice(0, 200), ext, bytes: bytes.byteLength, chars: text.length, at: Date.now(), ...(error ? { error } : {}), text };
  await fs.writeFile(metaFile(id), JSON.stringify(stored), { mode: 0o600 });
  return withoutText(stored);
}

function withoutText(stored: Stored): StudyUpload {
  return { id: stored.id, name: stored.name, ext: stored.ext, bytes: stored.bytes, chars: stored.chars, at: stored.at, ...(stored.error ? { error: stored.error } : {}) };
}

export async function readUpload(id: string): Promise<Stored | null> {
  try {
    return JSON.parse(await fs.readFile(metaFile(id), "utf8")) as Stored;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function deleteUpload(id: string): Promise<void> {
  const stored = await readUpload(id);
  await fs.rm(metaFile(id), { force: true });
  if (stored && /^[a-z0-9]{1,8}$/.test(stored.ext)) await fs.rm(path.join(dir(), `${id}.${stored.ext}`), { force: true });
}
