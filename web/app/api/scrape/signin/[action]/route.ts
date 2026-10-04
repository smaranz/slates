import type { NextRequest } from "next/server";
import { SCRAPER_URL } from "@/lib/ports";

/**
 * Passthrough to the sync service's sign-in (scraper/signin.mjs): Schoology,
 * open in the browser the sync reads with and streamed into Slates, so a
 * signed-out sync is fixed from Settings on any device.
 *
 * Same shape as /api/attempt. The service binds to 127.0.0.1 and holds the
 * Schoology session, so the browser only ever reaches it through here, and
 * what's typed into the sign-in passes through without being read or logged.
 */
const READS = new Set(["status", "stream"]);
const WRITES = new Set(["start", "input", "stop"]);

function unreachable(e: unknown) {
  return Response.json(
    {
      error:
        e instanceof Error && /ECONNREFUSED|fetch failed/.test(e.message)
          ? "The sync service isn't running on the host, so there's no browser to sign in with."
          : e instanceof Error
            ? e.message
            : "Unknown error",
    },
    { status: 503 }
  );
}

/** A service from before sign-in existed answers 404 to all of it. */
const OUTDATED = "The sync service on the host is older than this page. Restart Slates there, then sign in.";

async function relay(upstream: Response) {
  if (upstream.status === 404) return Response.json({ error: OUTDATED }, { status: 503 });
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  if (!READS.has(action)) return Response.json({ error: "Not found" }, { status: 404 });

  try {
    const upstream = await fetch(`${SCRAPER_URL}/signin/${action}`, { cache: "no-store", signal: req.signal });
    // Frames keep coming until the sign-in closes; hand them through as they arrive.
    if (action === "stream" && upstream.ok && upstream.body) {
      return new Response(upstream.body, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        },
      });
    }
    return relay(upstream);
  } catch (e) {
    return unreachable(e);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  if (!WRITES.has(action)) return Response.json({ error: "Not found" }, { status: 404 });

  try {
    const upstream = await fetch(`${SCRAPER_URL}/signin/${action}`, {
      method: "POST",
      body: await req.text(),
      headers: { "content-type": "application/json" },
      cache: "no-store",
      // Opening launches the sync browser if it isn't up yet.
      signal: AbortSignal.timeout(action === "start" ? 90_000 : 20_000),
    });
    return relay(upstream);
  } catch (e) {
    return unreachable(e);
  }
}
