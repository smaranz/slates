import { listen } from "@/lib/whirl-server/bus";

/**
 * Live updates for the Agent app: which topics changed, as server-sent
 * events. Each open query on the page refetches when one of its own topics
 * is named. A comment every 20 s keeps proxies from closing an idle stream.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const encoder = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          stop();
        }
      };
      send(": hello\n\n");
      const unlisten = listen((topics) => send(`data: ${JSON.stringify({ topics })}\n\n`));
      const beat = setInterval(() => send(": beat\n\n"), 20_000);
      stop = () => {
        unlisten();
        clearInterval(beat);
      };
      request.signal.addEventListener("abort", () => {
        stop();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" },
  });
}
