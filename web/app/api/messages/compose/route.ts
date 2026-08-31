import type { NextRequest } from "next/server";

/**
 * Proxies a new message to the local scraper, which fills in Schoology's own
 * message form in the signed-in browser. Same shape as /api/submit: the
 * scraper reports each stage as it happens, so the stream is passed straight
 * through instead of buffered.
 */
const SCRAPER = process.env.SLATES_SCRAPER_URL ?? "http://127.0.0.1:4000";

export async function POST(req: NextRequest) {
  try {
    const upstream = await fetch(`${SCRAPER}/message/compose?stream=1`, {
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
        "x-accel-buffering": "no",
      },
    });
  } catch (e) {
    const offline = e instanceof Error && /ECONNREFUSED|fetch failed/.test(e.message);
    return Response.json(
      {
        error: offline
          ? "Sync service isn't running, so nothing was sent."
          : e instanceof Error
            ? e.message
            : "Couldn't send that message",
      },
      { status: 503 }
    );
  }
}
