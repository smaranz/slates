import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import type { ReadableOptions } from "node:stream";
import type { NextRequest } from "next/server";

import { isLessonId, lessonVideoPath } from "@/lib/lesson/job";

/**
 * The finished MP4.
 *
 * Served with byte-range support, which is not optional here: without it
 * Chromium will play a video from the start and refuse to scrub it, so a
 * student couldn't skip back over the bit they missed — the single most
 * likely thing to want from a lesson.
 */
export const dynamic = "force-dynamic";

function toWebStream(path: string, options?: ReadableOptions & { start?: number; end?: number }) {
  const node = createReadStream(path, options);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      node.on("data", (chunk) => controller.enqueue(new Uint8Array(chunk as Buffer)));
      node.on("end", () => controller.close());
      node.on("error", (err) => controller.error(err));
    },
    cancel() {
      node.destroy();
    },
  });
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  // Checked before it ever reaches `path.join` — an id names a directory.
  if (!isLessonId(id)) return new Response("Not found", { status: 404 });

  const file = lessonVideoPath(id);
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) return new Response("Not found", { status: 404 });

  const range = req.headers.get("range");
  const match = range?.match(/^bytes=(\d*)-(\d*)$/);

  if (match) {
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    if (!(start >= 0 && start <= end && end < stat.size)) {
      return new Response("Range not satisfiable", {
        status: 416,
        headers: { "content-range": `bytes */${stat.size}` },
      });
    }
    return new Response(toWebStream(file, { start, end }), {
      status: 206,
      headers: {
        "content-type": "video/mp4",
        "content-length": String(end - start + 1),
        "content-range": `bytes ${start}-${end}/${stat.size}`,
        "accept-ranges": "bytes",
        "cache-control": "private, max-age=3600",
      },
    });
  }

  return new Response(toWebStream(file), {
    headers: {
      "content-type": "video/mp4",
      "content-length": String(stat.size),
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=3600",
    },
  });
}
