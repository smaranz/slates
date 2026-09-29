import { reviewResult } from "@/lib/learning/review";

/**
 * What the background review of a tutor turn saved. The reply has already
 * gone out, so the page asks once and waits here until the review finishes
 * (or a minute passes), then shows it under the reply.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^rev_[\w-]{4,80}$/.test(id)) return Response.json({ items: null }, { status: 404 });
  return Response.json({ items: await reviewResult(id, 60_000) }, { headers: { "cache-control": "no-store" } });
}
