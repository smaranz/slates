import type { NextRequest } from "next/server";
import { SCRAPER_URL } from "@/lib/ports";

/**
 * The bytes of one Schoology attachment, proxied straight through.
 *
 * Streamed rather than buffered and re-encoded: these are lecture PDFs, and
 * the point is that the viewer can start drawing the first page while the
 * rest is still arriving. The scraper is what actually authenticates.
 */
const SCRAPER = SCRAPER_URL;

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path") ?? "";
  try {
    const upstream = await fetch(`${SCRAPER}/course/file?path=${encodeURIComponent(path)}`, {
      cache: "no-store",
    });
    if (!upstream.ok || !upstream.body) {
      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
        // Inline: this is rendered in the app, not offered as a download.
        "content-disposition": "inline",
        "cache-control": "private, max-age=300",
      },
    });
  } catch {
    return Response.json({ error: "Sync service isn't running." }, { status: 503 });
  }
}
