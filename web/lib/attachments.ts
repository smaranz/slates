/** Something the student attached to a tutor message. */
export type Attachment =
  | {
      id: string;
      kind: "image";
      name: string;
      mediaType: string;
      /** data: URL, used for both the preview thumbnail and the request body. */
      dataUrl: string;
      /**
       * Set once the conversation has been through storage, which keeps the
       * name and drops the bytes — see `forStorage` in lib/tutor-chats.ts.
       * `dataUrl` is empty when this is true.
       */
      dropped?: boolean;
    }
  | {
      id: string;
      kind: "document";
      name: string;
      /** Extracted plain text — every model reads this the same way. */
      text: string;
      truncated: boolean;
    };

/** A message part in the shape /api/tutor expects — text, or an inline image. */
export interface TutorMessagePart {
  type: "text" | "image";
  text?: string;
  /** Base64, no "data:" prefix. */
  data?: string;
  mediaType?: string;
  filename?: string;
}

/** Turns the composer's text + attachments into the parts /api/tutor expects. */
export function toTutorMessageParts(
  text: string,
  attachments: Attachment[] = []
): TutorMessagePart[] {
  const parts: TutorMessagePart[] = [];
  if (text.trim()) parts.push({ type: "text", text });

  for (const a of attachments) {
    if (a.kind === "image") {
      /*
       * An image from a reloaded conversation has a name and no bytes. Say so:
       * the model can still follow a thread that refers back to "the graph I
       * sent", which it can't do if the picture silently disappears.
       */
      if (!a.dataUrl) {
        parts.push({
          type: "text",
          text: `[Image "${a.name}" was attached earlier in this conversation and is no longer available.]`,
        });
        continue;
      }
      const comma = a.dataUrl.indexOf(",");
      parts.push({
        type: "image",
        data: comma >= 0 ? a.dataUrl.slice(comma + 1) : a.dataUrl,
        mediaType: a.mediaType,
        filename: a.name,
      });
    } else {
      const note = a.truncated ? ` (truncated to ${a.text.length.toLocaleString()} characters)` : "";
      parts.push({
        type: "text",
        text: `Document "${a.name}"${note}:\n${a.text}`,
      });
    }
  }

  return parts;
}

const MAX_DOCUMENT_CHARS = 20_000;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

const TEXT_EXTENSIONS = [
  ".txt", ".md", ".markdown", ".csv", ".json", ".log",
  ".js", ".jsx", ".ts", ".tsx", ".py", ".java", ".c", ".cpp", ".cs",
  ".html", ".css", ".xml", ".yml", ".yaml",
];

const IMAGE_EXTENSIONS: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

function hasTextExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

/**
 * What a screenshot actually is, when the OS didn't bother to say.
 *
 * A Cmd-Ctrl-Shift-4 grab on a Mac often arrives as a File with an empty
 * `type` and a name like "image.png" — or no name at all. Trusting only
 * `file.type.startsWith("image/")` then throws the picture away.
 */
export function sniffImageMediaType(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

async function imageMediaTypeOf(file: File): Promise<string | null> {
  if (file.type.startsWith("image/")) return file.type;
  const fromName = IMAGE_EXTENSIONS[extensionOf(file.name)];
  if (fromName) return fromName;
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  return sniffImageMediaType(head);
}

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.type}:${file.lastModified}`;
}

/**
 * Every file on a drag or a paste, including the ones Chromium hides.
 *
 * `data.files` is empty for a lot of macOS clipboard screenshots. The same
 * picture is sitting on `data.items` as a `kind: "file"` entry, so we read
 * both and de-dupe.
 */
export function filesFromDataTransfer(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  const seen = new Set<string>();
  const out: File[] = [];
  const add = (file: File | null) => {
    if (!file) return;
    const key = fileKey(file);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(file);
  };
  for (const file of Array.from(data.files ?? [])) add(file);
  const items = data.items;
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file") add(item.getAsFile());
    }
  }
  return out;
}

function extForMediaType(mediaType: string): string {
  if (mediaType === "image/jpeg") return "jpg";
  const slash = mediaType.indexOf("/");
  return slash >= 0 ? mediaType.slice(slash + 1) : "png";
}

/**
 * The async fallback for a paste that named an image and then handed over
 * nothing — Electron does this with a Mac screenshot.
 *
 * `clipboard.read()` needs a user gesture; the paste event is that gesture.
 */
export async function filesFromClipboardRead(): Promise<File[]> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.read) return [];
  try {
    const items = await navigator.clipboard.read();
    const files: File[] = [];
    for (const item of items) {
      const type = item.types.find((value) => value.startsWith("image/"));
      if (!type) continue;
      const blob = await item.getType(type);
      files.push(new File([blob], `Screenshot.${extForMediaType(type)}`, { type }));
    }
    return files;
  } catch {
    return [];
  }
}

/**
 * Pull pictures off a paste. Returns true when the event was claimed so the
 * caller can skip inserting the filename as text.
 */
export function takePasteFiles(
  event: { clipboardData: DataTransfer | null; preventDefault: () => void },
  onFiles: (files: File[]) => void
): boolean {
  const sync = filesFromDataTransfer(event.clipboardData);
  if (sync.length) {
    event.preventDefault();
    onFiles(sync);
    return true;
  }
  if (pasteLooksLikeFiles(event.clipboardData)) {
    event.preventDefault();
    void filesFromClipboardRead().then((files) => {
      if (files.length) onFiles(files);
    });
    return true;
  }
  return false;
}

/** True when the paste is a picture, even if the FileList is still empty. */
export function pasteLooksLikeFiles(data: DataTransfer | null | undefined): boolean {
  if (!data) return false;
  if (data.files?.length) return true;
  const types = Array.from(data.types ?? []);
  if (types.some((type) => type === "Files" || type.startsWith("image/"))) return true;
  const items = data.items;
  if (!items) return false;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === "file" || item.type.startsWith("image/")) return true;
  }
  return false;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file."));
    reader.readAsText(file);
  });
}

async function extractPdfText(file: File): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const buffer = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    pages.push(text);
  }
  return pages.join("\n\n");
}

function clamp(text: string): { text: string; truncated: boolean } {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_DOCUMENT_CHARS) return { text: trimmed, truncated: false };
  return { text: trimmed.slice(0, MAX_DOCUMENT_CHARS), truncated: true };
}

/** Reads a file the student attached, either as an image or extracted document text. */
export async function readAttachment(file: File): Promise<Attachment> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const label = file.name.trim() || "Screenshot";

  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`${label} is too large (max 15 MB).`);
  }

  const imageType = await imageMediaTypeOf(file);
  if (imageType) {
    const dataUrl = await readAsDataUrl(file);
    const name = file.name.trim() || `Screenshot.${extForMediaType(imageType)}`;
    return { id, kind: "image", name, mediaType: imageType, dataUrl };
  }

  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const raw = await extractPdfText(file);
    if (!raw.trim()) {
      throw new Error(`Couldn't find any text in ${label} — is it a scanned image?`);
    }
    const { text, truncated } = clamp(raw);
    return { id, kind: "document", name: label, text, truncated };
  }

  if (file.type.startsWith("text/") || file.type === "application/json" || hasTextExtension(file.name)) {
    const raw = await readAsText(file);
    const { text, truncated } = clamp(raw);
    return { id, kind: "document", name: label, text, truncated };
  }

  throw new Error(`Can't read ${label} yet — try an image, PDF, or text file.`);
}
