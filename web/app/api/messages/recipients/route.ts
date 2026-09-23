import type { NextRequest } from "next/server";
import { SCRAPER_URL } from "@/lib/ports";

/**
 * Looks a name up in Schoology's own directory, through the local scraper —
 * the browser never holds the Schoology session itself.
 *
 * A plain read, so this answers as JSON rather than a stream.
 */
const SCRAPER = SCRAPER_URL;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  try {
    const upstream = await fetch(`${SCRAPER}/message/recipients?q=${encodeURIComponent(q)}`, {
      cache: "no-store",
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    const offline = e instanceof Error && /ECONNREFUSED|fetch failed/.test(e.message);
    return Response.json(
      { error: offline ? "Sync service isn't running." : "Couldn't reach Schoology's directory." },
      { status: 503 }
    );
  }
}
