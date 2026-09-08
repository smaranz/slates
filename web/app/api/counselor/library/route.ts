import { formatHits, libraryStatus, searchLibrary } from "@/lib/counselor/knowledge/store";

/**
 * The counseling library, reachable from the browser.
 *
 * The typed counselor searches it in-process; the voice counselor can't,
 * because its tool calls are handled in the page — the model talks straight to
 * the browser over WebRTC and never passes through this server. So voice gets
 * one endpoint instead, and both halves end up answering out of the same
 * documents rather than voice quietly falling back on training data.
 *
 * GET with no query answers "is there a library at all", which is what the
 * profile screen shows.
 */

export const maxDuration = 30;

export async function GET(req: Request) {
  const query = new URL(req.url).searchParams.get("q")?.trim();
  if (!query) return Response.json(libraryStatus());

  const status = libraryStatus();
  if (!status.ready) {
    return Response.json({
      error: "No counseling library is indexed on this machine. Say plainly that you're answering from your own knowledge.",
    });
  }

  try {
    // Fewer passages than the typed side takes: this is going into a spoken
    // answer, and a voice model handed six long excerpts starts reading them.
    const hits = await searchLibrary(query, { limit: 3 });
    if (!hits.length) {
      return Response.json({ note: "Nothing in the library covers that. Say so rather than implying it does." });
    }
    return Response.json({ passages: formatHits(hits), titles: hits.map((h) => h.title) });
  } catch {
    return Response.json({ error: "The library couldn't be searched right now." });
  }
}
