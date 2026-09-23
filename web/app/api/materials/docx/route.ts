import mammoth from "mammoth";
import { SCRAPER_URL } from "@/lib/ports";

/**
 * A Word handout, turned into something Slates can draw.
 *
 * `.docx` was the one common attachment the viewer refused: Chromium has no
 * idea what to do with it, so a teacher's instructions sat behind a Download
 * button and left the app. It is a zip of XML, though, and mammoth turns that
 * into semantic HTML — headings stay headings, lists stay lists — which the
 * viewer already knows how to render.
 *
 * The markup comes back raw and is sanitized in the browser by the same
 * whitelist a submission goes through. That is deliberate: the sanitizer is
 * built on DOMParser and belongs on the client, and one whitelist for every
 * piece of foreign HTML is easier to reason about than two.
 */

/** The scraper holds the Schoology session these bytes need. */
const SCRAPER = SCRAPER_URL;

export const maxDuration = 60;

export async function GET(req: Request) {
  const path = new URL(req.url).searchParams.get("path");
  if (!path) return Response.json({ error: "No file asked for." }, { status: 400 });

  // The scraper enforces this too; refusing here keeps an obviously wrong
  // request from becoming a round trip.
  if (!/^\/attachment\/\d+\//.test(path)) {
    return Response.json({ error: "Only Schoology attachments can be opened." }, { status: 400 });
  }

  let bytes: ArrayBuffer;
  try {
    const res = await fetch(`${SCRAPER}/course/file?path=${encodeURIComponent(path)}`, {
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`Schoology returned ${res.status}`);
    bytes = await res.arrayBuffer();
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Couldn't fetch that file." },
      { status: 502 }
    );
  }

  try {
    const { value, messages } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });

    /*
     * Mammoth reports what it could not carry across — an unmapped style, an
     * embedded object. Logged rather than shown: a reader wants the handout,
     * not a conversion report, and the missing piece is nearly always a style
     * name rather than content.
     */
    const notes = messages.filter((m) => m.type === "warning");
    if (notes.length > 0) {
      console.log(`[docx] ${notes.length} conversion note(s) for ${path}: ${notes[0].message}`);
    }

    if (!value.trim()) {
      return Response.json({ error: "That document has no readable text in it." }, { status: 422 });
    }

    return Response.json({ html: value });
  } catch (err) {
    /*
     * A .doc renamed to .docx, or a password-protected file. Named plainly:
     * "couldn't open it" sends someone hunting for a bug in Slates.
     */
    const message = err instanceof Error ? err.message.split("\n")[0] : "Converting it failed.";
    return Response.json(
      { error: `Slates couldn't read that Word file — ${message}` },
      { status: 422 }
    );
  }
}
