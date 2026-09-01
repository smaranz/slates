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

function hasTextExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
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

  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`${file.name} is too large (max 15 MB).`);
  }

  if (file.type.startsWith("image/")) {
    const dataUrl = await readAsDataUrl(file);
    return { id, kind: "image", name: file.name, mediaType: file.type, dataUrl };
  }

  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const raw = await extractPdfText(file);
    if (!raw.trim()) {
      throw new Error(`Couldn't find any text in ${file.name} — is it a scanned image?`);
    }
    const { text, truncated } = clamp(raw);
    return { id, kind: "document", name: file.name, text, truncated };
  }

  if (file.type.startsWith("text/") || file.type === "application/json" || hasTextExtension(file.name)) {
    const raw = await readAsText(file);
    const { text, truncated } = clamp(raw);
    return { id, kind: "document", name: file.name, text, truncated };
  }

  throw new Error(`Can't read ${file.name} yet — try an image, PDF, or text file.`);
}
