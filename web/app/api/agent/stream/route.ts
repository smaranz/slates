import { subscribe } from "@/lib/agent/hub";

/** Live Agent updates for an open window, as server-sent events. */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      write(`data: ${JSON.stringify({ kind: "hello" })}\n\n`);
      const unsubscribe = subscribe((message) => write(`data: ${JSON.stringify(message)}\n\n`));
      const ping = setInterval(() => write(": ping\n\n"), 15_000);
      cleanup = () => {
        unsubscribe();
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };
      request.signal.addEventListener("abort", () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
