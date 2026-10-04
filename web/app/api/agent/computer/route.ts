import { browserRunning, captureFrame, ensureBrowser, sendInput, type ComputerInput } from "@/lib/agent/browser";
import { getAgent } from "@/lib/agent/store";

/**
 * A browser on the host as a live view you can take over: frames out, clicks
 * and keys in. `agent` picks that agent's own browser; without it, the one
 * the tutor and Study builds share.
 */

export const dynamic = "force-dynamic";

const noAgent = () => Response.json({ error: "That agent doesn't exist." }, { status: 404 });

export async function GET(request: Request) {
  const agent = new URL(request.url).searchParams.get("agent") || undefined;
  if (agent && !getAgent(agent)) return noAgent();
  if (!(await browserRunning(agent))) return Response.json({ running: false });
  try {
    return Response.json({ running: true, ...(await captureFrame(agent)) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ running: true, error: error instanceof Error ? error.message : String(error) });
  }
}

const INPUTS = new Set(["click", "scroll", "text", "key", "navigate", "back"]);

export async function POST(request: Request) {
  let body: { agent?: unknown; op?: string; input?: ComputerInput };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const agent = typeof body.agent === "string" && body.agent ? body.agent : undefined;
  if (agent && !getAgent(agent)) return noAgent();
  try {
    if (body.op === "start") {
      await ensureBrowser(agent);
      return Response.json({ ok: true });
    }
    const input = body.input;
    if (!input || !INPUTS.has(input.type)) return Response.json({ error: "Unknown input." }, { status: 400 });
    if ((input.type === "click" || input.type === "scroll") && !(Number.isFinite(input.x) && Number.isFinite(input.y))) {
      return Response.json({ error: "Bad coordinates." }, { status: 400 });
    }
    await sendInput(input, agent);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
