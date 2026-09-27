import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import type { ReadableOptions } from "node:stream";

import { getMedia, isMediaId, mediaFilePath } from "@/lib/media/library";

/** Stream one finished library file with browser-friendly seek support. */

export const dynamic = "force-dynamic";

function toWebStream(file: string, options?: ReadableOptions & { start?: number; end?: number }) {
  const node = createReadStream(file, options);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      node.on("data", (chunk) => controller.enqueue(new Uint8Array(chunk as Buffer)));
      node.on("end", () => controller.close());
      node.on("error", (error) => controller.error(error));
    },
    cancel() {
      node.destroy();
    },
  });
}

function slug(prompt: string): string {
  return prompt.normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "media";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  if (!isMediaId(id)) return new Response("Not found", { status: 404 });

  const item = await getMedia(id).catch(() => null);
  if (!item || item.status !== "completed" || !item.file) return new Response("Not found", { status: 404 });
  let file: string;
  try {
    file = mediaFilePath(item);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) return new Response("Not found", { status: 404 });

  const headers = new Headers({
    "content-type": item.mime || "application/octet-stream",
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
  });
  if (url.searchParams.get("download") === "1") {
    const extension = item.file.split(".").at(-1) ?? "bin";
    const filename = `${slug(item.prompt)}-${item.id.slice(-8)}.${extension}`;
    headers.set("content-disposition", `attachment; filename="${filename}"`);
  }

  const range = request.headers.get("range");
  const match = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (match) {
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    if (!(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && end < stat.size)) {
      return new Response("Range not satisfiable", {
        status: 416,
        headers: { "content-range": `bytes */${stat.size}` },
      });
    }
    headers.set("content-length", String(end - start + 1));
    headers.set("content-range", `bytes ${start}-${end}/${stat.size}`);
    return new Response(toWebStream(file, { start, end }), { status: 206, headers });
  }

  headers.set("content-length", String(stat.size));
  return new Response(toWebStream(file), { headers });
}
