import type { NextRequest } from "next/server";

/**
 * Passthrough to the local scraper's attempt endpoints.
 *
 * The scraper binds to 127.0.0.1 and holds a logged-in Schoology session, so
 * the browser never talks to it directly — the portal proxies server-side.
 */
const SCRAPER = process.env.SLATES_SCRAPER_URL ?? "http://127.0.0.1:4000";

const ACTIONS = new Set(["start", "stop", "status", "input", "stream"]);

function unreachable(e: unknown) {
  return Response.json(
    {
      error:
        e instanceof Error && /ECONNREFUSED|fetch failed/.test(e.message)
          ? "Sync service isn't running. Start it with: npm run serve (in scraper/)"
          : e instanceof Error
            ? e.message
            : "Unknown error",
    },
    { status: 503 }
  );
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  if (!ACTIONS.has(action)) return Response.json({ error: "Not found" }, { status: 404 });

  const target = new URL(`${SCRAPER}/attempt/${action}`);
  for (const [k, v] of req.nextUrl.searchParams) target.searchParams.set(k, v);

  try {
    const upstream = await fetch(target, { cache: "no-store", signal: req.signal });

    // The frame stream stays open; hand the body straight through rather than
    // buffering it, or nothing renders until the attempt ends.
    if (action === "stream" && upstream.body) {
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        },
      });
    }

    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return unreachable(e);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  if (!ACTIONS.has(action)) return Response.json({ error: "Not found" }, { status: 404 });

  try {
    const upstream = await fetch(`${SCRAPER}/attempt/${action}`, {
      method: "POST",
      body: await req.text(),
      headers: { "content-type": "application/json" },
      cache: "no-store",
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return unreachable(e);
  }
}
