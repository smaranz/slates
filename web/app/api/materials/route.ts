import type { NextRequest } from "next/server";
import { SCRAPER_URL } from "@/lib/ports";

/**
 * A course's folders, files, pages and links — read through the local scraper,
 * which holds the Schoology session. `path` asks for the file behind a
 * document instead of a folder listing.
 */
const SCRAPER = SCRAPER_URL;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const path = q.get("path");
  const target = path
    ? `${SCRAPER}/course/document?path=${encodeURIComponent(path)}`
    : `${SCRAPER}/course/materials?course=${encodeURIComponent(q.get("course") ?? "")}` +
      (q.get("folder") ? `&folder=${encodeURIComponent(q.get("folder")!)}` : "");

  try {
    const upstream = await fetch(target, { cache: "no-store" });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    const offline = e instanceof Error && /ECONNREFUSED|fetch failed/.test(e.message);
    return Response.json(
      { error: offline ? "Sync service isn't running." : "Couldn't read that class's materials." },
      { status: 503 }
    );
  }
}
