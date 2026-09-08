/**
 * Reading a .docx in the browser, without a zip library.
 *
 * Essays arrive as Word documents more often than anything else, so "upload
 * your draft" that rejects .docx rejects most drafts. The existing attachment
 * reader handles PDF and plain text; this fills the gap.
 *
 * A .docx is a zip containing `word/document.xml`. Modern browsers ship a raw
 * DEFLATE decoder in `DecompressionStream`, so the only thing missing is
 * enough of the zip format to find that one entry — which is a central
 * directory walk and a local header read, about sixty lines. Pulling in a zip
 * dependency to do that would cost more than it saves.
 */

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;

/** Extracts the text of a .docx, paragraph breaks intact. */
export async function readDocx(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const xml = await extractEntry(view, bytes, "word/document.xml");
  if (!xml) throw new Error(`${file.name} doesn't look like a Word document.`);

  return xmlToText(xml);
}

/** Finds one file inside the zip and inflates it. */
async function extractEntry(view: DataView, bytes: Uint8Array, want: string): Promise<string | null> {
  // The end-of-central-directory record is at the tail, after a comment of
  // unknown length — so it is found by scanning backwards for its signature.
  let end = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66_000; i--) {
    if (view.getUint32(i, true) === END_OF_CENTRAL) {
      end = i;
      break;
    }
  }
  if (end === -1) return null;

  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);

  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== CENTRAL_HEADER) return null;

    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));

    if (name === want) {
      if (view.getUint32(localAt, true) !== LOCAL_HEADER) return null;
      // The local header's own name and extra lengths differ from the central
      // directory's, so the data offset has to be computed from the local one.
      const localNameLength = view.getUint16(localAt + 26, true);
      const localExtraLength = view.getUint16(localAt + 28, true);
      const start = localAt + 30 + localNameLength + localExtraLength;
      const data = bytes.subarray(start, start + compressedSize);

      // 0 = stored, 8 = deflate. Word always deflates, but a stored entry is
      // legal and costs one branch to support.
      if (method === 0) return new TextDecoder().decode(data);
      if (method !== 8) return null;

      const stream = new Blob([data as unknown as BlobPart])
        .stream()
        .pipeThrough(new DecompressionStream("deflate-raw"));
      return new Response(stream).text();
    }

    at += 46 + nameLength + extraLength + commentLength;
  }

  return null;
}

/** WordprocessingML to plain text, keeping paragraphs and tabs. */
function xmlToText(xml: string): string {
  return xml
    .replace(/<w:tab\b[^>]*\/>/g, "\t")
    .replace(/<w:br\b[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isDocx(file: File): boolean {
  return (
    file.name.toLowerCase().endsWith(".docx") ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}
