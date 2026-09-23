import type { NextRequest } from "next/server";
import { SCRAPER_URL } from "@/lib/ports";

/**
 * Proxies a real submission to the local scraper, which drives Schoology's own
 * dropbox in the signed-in browser. The browser never talks to the scraper
 * directly — it binds to loopback and holds the Schoology session.
 *
 * The scraper reports each stage as it happens, so the response is passed
 * straight through rather than buffered: waiting for the whole submission
 * before answering would throw away exactly the progress the portal wants to
 * show.
 */
const SCRAPER = SCRAPER_URL;

export async function POST(req: NextRequest) {
  try {
    const upstream = await fetch(`${SCRAPER}/submit?stream=1`, {
      method: "POST",
      body: await req.text(),
      headers: { "content-type": "application/json" },
      cache: "no-store",
    });

    const type = upstream.headers.get("content-type") ?? "application/json";
    if (!upstream.body || !type.includes("text/event-stream")) {
      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        // Buffering here would hold every step back until the end.
        "x-accel-buffering": "no",
      },
    });
  } catch (e) {
    const offline = e instanceof Error && /ECONNREFUSED|fetch failed/.test(e.message);
    return Response.json(
      {
        error: offline
          ? "Sync service isn't running, so nothing was submitted."
          : e instanceof Error
            ? e.message
            : "Submission failed",
      },
      { status: 503 }
    );
  }
}
