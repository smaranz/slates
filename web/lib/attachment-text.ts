import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * What a handout actually says, for the estimator to read.
 *
 * A time estimate made from a title and a due date is a guess about a name.
 * "Unit 3 Packet" is twenty minutes or three hours depending on what is inside
 * it, and the thing that knows is the PDF the teacher attached — so the
 * estimator reads it.
 *
 * Extraction happens here on the server because the bytes need the scraper's
 * Schoology session, and because the result is worth keeping: a handout does
 * not change, so it is read once and cached to disk. Without that, every sync
 * would re-download every attachment on the board.
 */

const HOME = path.join(os.homedir(), ".slates");
const CACHE = path.join(HOME, "attachment-text.json");

/** Enough for the model to see what the work is; not the whole packet. */
const PER_DOC = 3_000;

/**
 * A ceiling on one estimate run.
 *
 * Sync should not turn into a download session. Twelve documents is more than
 * a normal board has outstanding, and the cache means the cost is paid once
 * per handout rather than once per sync.
 */
const MAX_DOCS = 12;

interface Cache {
  [path: string]: { text: string; at: number };
}

function readCache(): Cache {
  try {
    return JSON.parse(fs.readFileSync(CACHE, "utf8")) as Cache;
  } catch {
    return {};
  }
}

function writeCache(cache: Cache): void {
  try {
    fs.mkdirSync(HOME, { recursive: true });
    fs.writeFileSync(CACHE, JSON.stringify(cache));
  } catch {
    // A cache that cannot be written is a slow estimate, not a broken one.
  }
}

/** Collapse the whitespace a PDF extractor leaves behind. */
function tidy(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

async function pdfText(bytes: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  /*
   * Point at the worker explicitly rather than letting pdf.js guess. Its guess
   * is a path relative to its own module, which is right in a dev tree and
   * wrong inside a packaged app — see outputFileTracingIncludes in
   * next.config.ts for the other half of this.
   */
  try {
    const require = createRequire(import.meta.url);
    pdfjs.GlobalWorkerOptions.workerSrc = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
  } catch {
    // Left to pdf.js's own default, which works wherever the file sits beside it.
  }

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    // No system fonts to hunt for on a server.
    useSystemFonts: false,
  }).promise;

  const pages: string[] = [];
  // The first few pages carry the instructions; a twenty-page reading does not
  // need to be transcribed to know it is a twenty-page reading.
  const limit = Math.min(doc.numPages, 5);
  for (let i = 1; i <= limit; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(
      content.items.map((item) => ("str" in item ? (item as { str: string }).str : "")).join(" ")
    );
    if (pages.join(" ").length > PER_DOC) break;
  }
  const more = doc.numPages > limit ? ` [${doc.numPages} pages total]` : "";
  void doc.cleanup();
  return tidy(pages.join(" ")).slice(0, PER_DOC) + more;
}

/**
 * A Word handout's words.
 *
 * `extractRawText` rather than the HTML conversion the viewer uses: the
 * estimator is counting questions and reading instructions, and the heading
 * levels would be tokens spent on formatting it has no use for.
 */
async function docxText(bytes: ArrayBuffer): Promise<string> {
  const mammoth = (await import("mammoth")).default;
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return tidy(value).slice(0, PER_DOC);
}

export interface DocumentRef {
  /** Schoology attachment path, as the scraper serves it. */
  url: string;
  title: string;
}

/**
 * Read the handouts attached to the work, newest cache first.
 *
 * Anything that fails — a missing scraper, an image, a format with no text —
 * is skipped rather than thrown. An estimate without one document is still an
 * estimate; an estimate that 500s because a teacher attached a .pages file is
 * a broken sync.
 */
export async function readAttachments(
  refs: DocumentRef[],
  scraperBase: string
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (refs.length === 0) return out;

  const cache = readCache();
  let fetched = 0;
  let dirty = false;

  for (const ref of refs) {
    const hit = cache[ref.url];
    if (hit) {
      if (hit.text) out.set(ref.url, hit.text);
      continue;
    }
    if (fetched >= MAX_DOCS) break;

    // Only files Schoology hosts, and only ones likely to carry text.
    if (!/^\/attachment\/\d+\//.test(ref.url)) continue;
    const ext = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(ref.url)?.[1]?.toLowerCase();
    if (!ext || !["pdf", "txt", "md", "csv", "docx"].includes(ext)) {
      // Remembered as empty so it is not retried on every sync.
      cache[ref.url] = { text: "", at: Date.now() };
      dirty = true;
      continue;
    }

    fetched += 1;
    try {
      const res = await fetch(`${scraperBase}/course/file?path=${encodeURIComponent(ref.url)}`, {
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(String(res.status));
      const bytes = await res.arrayBuffer();
      const text =
        ext === "pdf"
          ? await pdfText(bytes)
          : ext === "docx"
            ? await docxText(bytes)
            : tidy(new TextDecoder().decode(bytes)).slice(0, PER_DOC);
      cache[ref.url] = { text, at: Date.now() };
      dirty = true;
      if (text) out.set(ref.url, text);
    } catch (err) {
      /*
       * Logged, not swallowed. A handout that silently fails to be read turns
       * into an estimate made from a title, and nothing anywhere says why —
       * which is exactly how this shipped broken the first time.
       */
      console.error(
        `[estimate] couldn't read ${ref.title || ref.url}:`,
        err instanceof Error ? err.message.split("\n")[0] : err
      );
      // Not cached as empty: a scraper that was down should be retried.
    }
  }

  if (dirty) writeCache(cache);
  return out;
}
