import type { RawSnapshot } from "@/lib/normalize";
import { SCRAPER_URL } from "@/lib/ports";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Proxy to the local scraper service (scraper/serve.mjs), which drives a
 * dedicated Chrome profile that stays logged in to Schoology. Going through the
 * server keeps the browser from having to reach a non-portal origin, and the
 * scraper itself binds to loopback only.
 */
const BASE = SCRAPER_URL;

const OFFLINE =
  "The Slates scraper isn't running. In a terminal:  cd scraper && npm run serve";

export async function GET() {
  try {
    const res = await fetch(`${BASE}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return Response.json({ running: false, error: OFFLINE }, { status: 200 });
    return Response.json({ running: true, ...(await res.json()) });
  } catch {
    return Response.json({ running: false, error: OFFLINE }, { status: 200 });
  }
}

export async function POST(req: Request) {
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";

  let res: Response;
  try {
    res = await fetch(`${BASE}/snapshot${fresh ? "?fresh=1" : ""}`, {
      cache: "no-store",
      // A cold scrape launches Chrome and waits on AJAX; give it room.
      signal: AbortSignal.timeout(110_000),
    });
  } catch {
    return Response.json({ error: OFFLINE }, { status: 503 });
  }

  const data = (await res.json()) as {
    snapshot?: RawSnapshot;
    stats?: Record<string, number>;
    error?: string;
  };

  if (!res.ok || data.error) {
    return Response.json({ error: data.error ?? `Scraper returned ${res.status}` }, { status: 502 });
  }
  return Response.json(data);
}
