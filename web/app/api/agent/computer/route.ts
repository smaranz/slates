import { browserRunning, captureFrame, ensureBrowser, sendInput, type ComputerInput } from "@/lib/agent/browser";

/** The agents' browser as a live view you can take over: frames out, clicks and keys in. */

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await browserRunning())) return Response.json({ running: false });
  try {
    return Response.json({ running: true, ...(await captureFrame()) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ running: true, error: error instanceof Error ? error.message : String(error) });
  }
}

const INPUTS = new Set(["click", "scroll", "text", "key", "navigate", "back"]);

export async function POST(request: Request) {
  let body: { op?: string; input?: ComputerInput };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  try {
    if (body.op === "start") {
      await ensureBrowser();
      return Response.json({ ok: true });
    }
    const input = body.input;
    if (!input || !INPUTS.has(input.type)) return Response.json({ error: "Unknown input." }, { status: 400 });
    if ((input.type === "click" || input.type === "scroll") && !(Number.isFinite(input.x) && Number.isFinite(input.y))) {
      return Response.json({ error: "Bad coordinates." }, { status: 400 });
    }
    await sendInput(input);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
