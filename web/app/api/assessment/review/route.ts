import type { NextRequest } from "next/server";
import { SCRAPER_URL } from "@/lib/ports";

/**
 * Per-question marks for an attempt already handed in, through the local
 * scraper — the browser never holds the Schoology session itself.
 *
 * Fetched on demand rather than in the five-minute crawl: it costs a page visit
 * plus a request per attempt, and almost none of it is ever looked at.
 */
const SCRAPER = SCRAPER_URL;

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url") ?? "";
  try {
    const upstream = await fetch(`${SCRAPER}/assessment/review?url=${encodeURIComponent(url)}`, {
      cache: "no-store",
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    const offline = e instanceof Error && /ECONNREFUSED|fetch failed/.test(e.message);
    return Response.json(
      { error: offline ? "Sync service isn't running." : "Couldn't reach Schoology." },
      { status: 503 }
    );
  }
}
