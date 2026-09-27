import { extractText, READABLE, type TextLimits } from "../attachment-text";

/**
 * The words in a file someone scanned or photographed.
 *
 * A scanned PDF is pictures of pages with no text layer, and a photo of notes
 * is only a picture, so pdf.js finds nothing in either. Those are read off the
 * page by a vision model instead. Both callers keep what comes back (an
 * upload's record, gather's text cache), so each file is read once.
 */

/**
 * Who reads a scan, in order: Gemini through OpenRouter reads a PDF's pages as
 * images, and OpenAI is the fallback. The next one is tried when a key is
 * missing or refused.
 */
export const SCAN_READERS = [
  { backend: "openrouter", model: "google/gemini-3.7-flash" },
  { backend: "openai", model: "gpt-5.6-luna" },
] as const;
export const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif"];
/** Everything Study Studio can take words from, from a text layer or off the page. */
export const READS = [...READABLE, ...IMAGE_EXTS];

const MEDIA: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

const NOTHING = "[nothing readable]";

const PROMPT = [
  "Transcribe this file for a student's study notes.",
  "Write out every word exactly as it appears, page by page and top to bottom: headings, printed text, handwriting, equations, tables as plain rows, and labels on diagrams.",
  "Plain text only: no Markdown, no LaTeX, no escaped characters. Write symbols as they appear (μ, θ, ≤, ², √).",
  "Where a diagram or graph carries meaning the words don't, add one short line in square brackets saying what it shows.",
  "Don't summarize, explain, correct or add anything. Start each page after the first with a line reading --- page N ---.",
  `If nothing on it can be read, reply with exactly ${NOTHING}`,
].join("\n");

export type ScanReader = (file: { data: Uint8Array; mediaType: string; name: string }) => Promise<string>;

/** A provider's "wrong key" error, which for OpenAI also echoes part of the key: never shown as is. */
const REFUSED = /api key|unauthori[sz]ed|\b401\b|auth(?:entication)? credentials|no auth/i;

async function readWithModel(file: { data: Uint8Array; mediaType: string; name: string }): Promise<string> {
  // Loaded on first use: the provider clients are server-only, and files with a text layer never need them.
  const [{ generateText }, { openaiModel, openrouterModel }, { noteFromUsage }] = await Promise.all([
    import("ai"),
    import("../ai-usage/clients"),
    import("../ai-usage/note"),
  ]);
  const refused: string[] = [];
  let failure: string | null = null;
  for (const { backend, model } of SCAN_READERS) {
    try {
      const { text, usage } = await generateText({
        model: backend === "openrouter" ? openrouterModel(model) : openaiModel(model),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPT },
              { type: "file", data: file.data, mediaType: file.mediaType, filename: file.name },
            ],
          },
        ],
        ...(backend === "openai" ? { providerOptions: { openai: { reasoningEffort: "low" } } } : {}),
        abortSignal: AbortSignal.timeout(180_000),
      });
      noteFromUsage("study", model, backend, usage);
      return text;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (REFUSED.test(message)) refused.push(backend === "openai" ? "OpenAI" : "OpenRouter");
      else failure ??= message.split("\n")[0]!;
    }
  }
  throw new Error(
    failure ?? `the ${refused.join(" and ")} ${refused.length === 1 ? "key was" : "keys were"} refused. Add a working one in AI Usage, then upload it again`,
  );
}

let reader: ScanReader = readWithModel;

/** For tests: read scans with something other than the model. */
export function setScanReader(next: ScanReader | null): void {
  reader = next ?? readWithModel;
}

/** Scanner apps stamp their name on every page, and pdf.js notes long files; neither is the page's words. */
const STAMPS = /scanned (?:with|by) [\w ]{2,20}|camscanner|adobe scan|genius scan|microsoft lens|\[\d+ pages total\]/gi;

/** A PDF whose text layer is empty, or holds only a scanner app's stamp and page numbers. */
export function looksScanned(layer: string): boolean {
  return layer.replace(STAMPS, "").replace(/[^a-z]/gi, "").length < 60;
}

/**
 * A file's words: its text layer when it has one, read off the page when it's
 * a scan or a photo. `scanned` says which, so the student can be told.
 */
export async function fileText(bytes: ArrayBuffer, ext: string, name: string, limits: TextLimits): Promise<{ text: string; scanned: boolean }> {
  // Copies throughout: pdf.js can take a buffer over.
  const layer = IMAGE_EXTS.includes(ext) ? "" : (await extractText(bytes.slice(0), ext, limits)).trim();
  const mediaType = MEDIA[ext];
  if (!mediaType || (ext === "pdf" && !looksScanned(layer))) return { text: layer, scanned: false };

  let read: string;
  try {
    read = (await reader({ data: new Uint8Array(bytes.slice(0)), mediaType, name })).trim();
  } catch (error) {
    throw new Error(`Couldn’t read the scan: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
  return { text: read.toLowerCase() === NOTHING ? "" : read.slice(0, limits.chars), scanned: true };
}
