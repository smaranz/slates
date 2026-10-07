import { run } from "@/lib/whirl-server/functions";
import { WhirlError } from "@/lib/whirl-server/functions/types";

/**
 * The Agent app's backend calls (Whirl's `api.<module>.<function>`), served
 * by Slates instead of Convex. One endpoint: the body names the function.
 * Errors meant for the page carry their sentence as `data`, which the client
 * rethrows as a ConvexError — the shape Whirl's toasts already read.
 */

export const dynamic = "force-dynamic";

const NAME = /^[a-zA-Z]+\.[a-zA-Z]+$/;

export async function POST(request: Request) {
  let body: { kind?: string; name?: string; args?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: { message: "Invalid JSON." } }, { status: 400 });
  }
  const name = String(body.name ?? "");
  if (!NAME.test(name)) return Response.json({ error: { message: "Unknown function." } }, { status: 400 });
  try {
    const value = await run(name, body.args && typeof body.args === "object" ? body.args : {});
    return Response.json({ value: value ?? null });
  } catch (error) {
    if (error instanceof WhirlError) return Response.json({ error: { message: error.message, data: error.message } });
    console.error(`[whirl] ${name} failed:`, error);
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: { message, data: message } }, { status: 500 });
  }
}
