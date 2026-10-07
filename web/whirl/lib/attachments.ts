import type { FunctionReturnType } from "convex/server";

import type { api } from "@whirl/backend/convex/_generated/api";
import {
  DOCUMENT_MIME_TYPES_BY_EXTENSION,
  isExtractableDocument,
} from "@whirl/lib/document-formats";
import type { ComposerModel } from "@whirl/lib/models";

/** What the backend makes of a document: its Markdown, a shrug for a scanned
 *  PDF that should ride on as a file, or a sentence about why not. Taken from
 *  the action itself so the two can't drift. */
type DocumentMarkdown = FunctionReturnType<
  typeof api.attachmentMarkdown.convert
>;

/* v2's port of v1's attachment pipeline (apps/legacy/app/lib/
   attachment-upload.ts): type detection, the free-plan cap, image
   compression, document→Markdown conversion, and the XHR upload to Convex
   storage that reports real progress. Files upload the moment they're
   picked — send just waits for whatever's still in flight. */

export const MB = 1024 * 1024;

/* Mirrors FREE_MAX_FILE_BYTES in convex/inference/billing.ts — the server
   enforces it too; this is the friendly front door. */
export const FREE_MAX_FILE_BYTES = 1 * MB;

/* Per-file ceiling on any plan, matching v1's per-model caps (all 20 MB). */
const MAX_FILE_BYTES = 20 * MB;

const TARGET_COMPRESSED_BYTES = 4 * MB;

/* One conservative constraint set for every model — v1 varies these per
   tier, but 1568px / 4 MP is the strictest working bound and looks
   identical in practice. */
const IMAGE_MAX_LONG_EDGE = 1568;
const IMAGE_MAX_MEGAPIXELS = 4;

const COMPRESSIBLE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/bmp",
  "image/tiff",
]);

const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  "c",
  "conf",
  "cpp",
  "cs",
  "css",
  "csv",
  "dart",
  "diff",
  "env",
  "go",
  "h",
  "html",
  "htm",
  "ini",
  "java",
  "js",
  "json",
  "jsonc",
  "jsx",
  "kt",
  "kts",
  "log",
  "lua",
  "md",
  "mdx",
  "patch",
  "php",
  "py",
  "r",
  "rb",
  "rs",
  "scala",
  "sh",
  "sql",
  "srt",
  "svelte",
  "svg",
  "swift",
  "toml",
  "ts",
  "tsx",
  "tsv",
  "txt",
  "vue",
  "vtt",
  "xml",
  "yaml",
  "yml",
]);

const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  ...DOCUMENT_MIME_TYPES_BY_EXTENSION,
  conf: "text/plain",
  csv: "text/csv",
  diff: "text/plain",
  htm: "text/html",
  html: "text/html",
  // Browsers report an empty type for .jsonc — without this it lands on
  // application/octet-stream and the model never gets the text.
  jsonc: "text/plain",
  log: "text/plain",
  md: "text/markdown",
  mdx: "text/markdown",
  patch: "text/plain",
  sql: "application/sql",
  svg: "text/xml",
  toml: "application/toml",
  tsv: "text/tab-separated-values",
  txt: "text/plain",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
};

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}

/** The fields the metadata/validation helpers need — a `File` and a draft
 * both satisfy this, so the same checks run before and after upload. */
export type FileLike = { name: string; type: string; size: number };

export function getFileExtension(name: string) {
  return name.includes(".") ? (name.split(".").pop()?.toLowerCase() ?? "") : "";
}

/* An SVG arrives from the OS as image/svg+xml, but it's markup, not
   pixels — no provider decodes it as an image, and handing over the source
   is what's actually useful ("tweak this icon"). Every image path in the
   app, client and server, keys off the type, so correcting it here is the
   whole story: no thumbnail, no @image tag, no vision-only gating, and it
   rides inline as text like any other code file. */
const TYPE_OVERRIDES: Record<string, string> = {
  "image/svg+xml": "text/xml",
};

export function getAttachmentType(file: Pick<FileLike, "name" | "type">) {
  const type =
    file.type ||
    MIME_TYPES_BY_EXTENSION[getFileExtension(file.name)] ||
    "application/octet-stream";
  return TYPE_OVERRIDES[type] ?? type;
}

export function isTextAttachment(file: Pick<FileLike, "name" | "type">) {
  return (
    getAttachmentType(file).startsWith("text/") ||
    TEXT_ATTACHMENT_EXTENSIONS.has(getFileExtension(file.name))
  );
}

export function makeAttachmentId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Why a file can't ride along with the chosen model, or `null` if it's
 * fine. Reactive to the selected model — the same file may be welcome on
 * one and rejected on another, so chips re-check on every model switch.
 */
export function attachmentRejectionReason(
  file: FileLike,
  model: ComposerModel,
  isFree: boolean,
): string | null {
  const type = getAttachmentType(file);
  const isImage = type.startsWith("image/");
  /* Images are exempt from both byte caps: compressImage bounds them to a
     few MB before upload, so the raw size here would flag photos that end
     up tiny on the wire. The caps keep documents/audio/video in check. */
  if (isFree && !isImage && file.size > FREE_MAX_FILE_BYTES) {
    return `Free plan attachments are limited to ${formatSize(FREE_MAX_FILE_BYTES)}. Upgrade for larger files.`;
  }
  if (!isImage && file.size > MAX_FILE_BYTES) {
    return `Attachments top out at ${formatSize(MAX_FILE_BYTES)}.`;
  }
  if (isTextAttachment(file)) return null;
  if (isImage) {
    return model.vision ? null : `${model.name} doesn't read images.`;
  }
  if (type.startsWith("audio/") || type.startsWith("video/")) {
    return `${model.name} can't ${type.startsWith("audio/") ? "listen to audio" : "watch video"} yet.`;
  }
  /* Documents (PDF, Office incl. the legacy binaries, OpenDocument, RTF,
     EPUB) are welcome everywhere: they convert to Markdown at upload, so the
     model reads them even without native file input. The one gap — a scanned
     PDF with no text layer — rides as a native block only where `files` is
     true. */
  if (isExtractableDocument(type, file.name)) return null;
  return model.files
    ? null
    : `${model.name} reads images, text files, and documents only.`;
}

async function compressImage(file: File): Promise<File> {
  if (!COMPRESSIBLE_IMAGE_TYPES.has(file.type)) return file;
  if (typeof OffscreenCanvas === "undefined") return file;

  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;

  const longEdge = Math.max(width, height);
  if (longEdge > IMAGE_MAX_LONG_EDGE) {
    const scale = IMAGE_MAX_LONG_EDGE / longEdge;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const mp = (width * height) / 1_000_000;
  if (mp > IMAGE_MAX_MEGAPIXELS) {
    const scale = Math.sqrt(IMAGE_MAX_MEGAPIXELS / mp);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const needsResize = width !== bitmap.width || height !== bitmap.height;
  if (!needsResize && file.size <= TARGET_COMPRESSED_BYTES) {
    bitmap.close();
    return file;
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
  let quality = 0.85;
  let blob = await canvas.convertToBlob({ type: outputType, quality });

  while (blob.size > TARGET_COMPRESSED_BYTES && quality > 0.3) {
    quality -= 0.1;
    blob = await canvas.convertToBlob({ type: outputType, quality });
  }

  /* A PNG that stays huge (screenshots of photos, mostly) re-encodes as
     JPEG — the transparency it might lose is worth the 10x size cut. */
  if (blob.size > TARGET_COMPRESSED_BYTES && outputType === "image/png") {
    quality = 0.8;
    blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    while (blob.size > TARGET_COMPRESSED_BYTES && quality > 0.3) {
      quality -= 0.1;
      blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    }
  }

  const ext = blob.type === "image/png" ? ".png" : ".jpg";
  const newName = file.name.replace(/\.[^.]+$/, ext);
  return new File([blob], newName, { type: blob.type });
}

/* fetch() can't report upload progress, so the POST to Convex storage goes
   through XHR — that's the only reason this isn't a one-liner. */
function uploadToStorage(
  url: string,
  type: string,
  body: Blob,
  onProgress?: (fraction: number) => void,
): Promise<{ storageId: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Content-Type", type);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as { storageId: string });
        } catch {
          reject(new Error("Malformed upload response"));
        }
      } else {
        reject(new Error(`Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(body);
  });
}

/** The ready-to-send shape, matching the backend's attachment validator
 * fields the client fills (convex/validators.ts attachmentValidator). */
export type AttachmentUpload = {
  id: string;
  name: string;
  size: number;
  type: string;
  /** Where the blob landed in Convex storage. Empty for a direct
   *  attachment, which never went anywhere (see `dataUrl`). */
  storageId: string;
  /** A locked chat's images: base64 in the tab, handed straight to the
   *  model with the turn and stored by nobody. Set instead of `storageId`,
   *  never alongside it. */
  dataUrl?: string;
  /** Text files and converted documents ride their contents so models
   *  without file input can still read them. */
  text?: string;
  /** Why a document couldn't be read (password-protected, damaged) — the
   *  server relays it to the model as a note. */
  skippedReason?: string;
};

/** Turns an uploaded document into Markdown. This is
 *  `api.attachmentMarkdown.convert`, injected rather than imported so this
 *  module stays free of React and Convex bindings. */
export type DocumentConverter = (args: {
  storageId: string;
  name: string;
}) => Promise<DocumentMarkdown>;

/** Why a file can't ride a locked chat, or null when it can. Locked chats
 *  have no server-side stage: an image can be inlined and a text file can be
 *  read here, but a PDF or a deck is turned into Markdown by the backend,
 *  which is exactly the trip a locked chat doesn't make. */
export function directAttachmentRejection(
  type: string,
  name: string,
): string | null {
  if (type.startsWith("image/")) return null;
  if (isTextAttachment({ name, type })) return null;
  return "A locked chat accepts images and text files only.";
}

/**
 * The same preparation, minus the upload: images come back as data URLs and
 * text files as their contents, and nothing touches Convex storage. This is
 * how a locked chat attaches a file — the bytes go from the tab to the model
 * and are kept by neither of us.
 */
export async function prepareDirectAttachment(
  raw: File,
): Promise<AttachmentUpload> {
  const rawType = getAttachmentType(raw);
  const file = rawType.startsWith("image/") ? await compressImage(raw) : raw;
  const type = getAttachmentType(file);

  const rejection = directAttachmentRejection(type, file.name);
  if (rejection) throw new Error(rejection);

  return {
    id: makeAttachmentId(),
    name: file.name,
    size: file.size,
    type,
    storageId: "",
    ...(type.startsWith("image/")
      ? { dataUrl: await readAsDataUrl(file) }
      : { text: await file.text() }),
  };
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(new Error(`Whirl cannot read ${file.name}. Attach it again.`));
    reader.readAsDataURL(file);
  });
}

/**
 * Compresses images, reads text files, converts documents to Markdown, and
 * uploads one file to Convex storage, reporting upload progress along the
 * way.
 */
export async function prepareAttachment({
  file: raw,
  getUploadUrl,
  convertDocument,
  onProgress,
}: {
  file: File;
  getUploadUrl: () => Promise<string>;
  convertDocument: DocumentConverter;
  onProgress?: (fraction: number) => void;
}): Promise<AttachmentUpload> {
  const rawType = getAttachmentType(raw);
  const file = rawType.startsWith("image/") ? await compressImage(raw) : raw;
  const type = getAttachmentType(file);

  /* Reading a text file and uploading its bytes are independent — run them
     together so neither waits on the other. */
  const textPromise = isTextAttachment(file) ? file.text() : undefined;
  const uploadUrl = await getUploadUrl();
  const [{ storageId }, text] = await Promise.all([
    uploadToStorage(uploadUrl, type, file, onProgress),
    textPromise,
  ]);

  /* Documents convert where their bytes already are — the backend reads them
     straight back out of storage, so a 20 MB deck is never uploaded twice.
     That does mean waiting for the upload to land, which is why this isn't in
     the race above. */
  const document =
    text === undefined && isExtractableDocument(type, file.name)
      ? await convertDocument({ storageId, name: file.name }).catch(
          (error: unknown): DocumentMarkdown => {
            console.error("Document conversion failed.", error);
            return {
              kind: "skipped",
              reason: "whirl couldn't read this document just now.",
            };
          },
        )
      : undefined;

  return {
    id: makeAttachmentId(),
    name: file.name,
    size: file.size,
    type,
    storageId,
    ...(text !== undefined
      ? { text }
      : document?.kind === "text"
        ? { text: document.text }
        : {}),
    ...(document?.kind === "skipped"
      ? { skippedReason: document.reason }
      : {}),
  };
}
