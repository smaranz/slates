import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { listSent, sentFilePath, workspaceFilePath, workspaceFiles } from "@/lib/agent/outbox";

/**
 * Files from the agents' PC, for the student's own devices: what agents sent
 * (`?id=`), and anything in their workspace (`?path=`), plus the lists of
 * both. The Mac app saves these into Downloads; a browser opens or downloads
 * them.
 */

export const dynamic = "force-dynamic";

/** Opened in place by a browser rather than downloaded blind. */
const INLINE: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
};

/** HTML, SVG and anything unknown go out as bytes to save: never a page running on Slates' own origin. */
const TYPES: Record<string, string> = {
  ...INLINE,
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip": "application/zip",
};

async function serve(file: string, name: string, download: boolean): Promise<Response> {
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) return new Response("Not found", { status: 404 });
  const ext = path.extname(name).toLowerCase();
  const inline = !download && ext in INLINE;
  const stream = createReadStream(file);
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        stream.on("data", (chunk) => controller.enqueue(new Uint8Array(chunk as Buffer)));
        stream.on("end", () => controller.close());
        stream.on("error", (error) => controller.error(error));
      },
      cancel() {
        stream.destroy();
      },
    }),
    {
      headers: {
        "content-type": TYPES[ext] ?? "application/octet-stream",
        "content-length": String(stat.size),
        "content-disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "x-content-type-options": "nosniff",
        "cache-control": "private, max-age=300",
      },
    },
  );
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const download = q.get("download") === "1";

  const id = q.get("id");
  if (id) {
    const found = sentFilePath(id);
    return found ? serve(found.path, found.file.name, download) : new Response("Not found", { status: 404 });
  }

  const relative = q.get("path");
  if (relative) {
    const file = workspaceFilePath(relative);
    return file ? serve(file, path.basename(file), download) : new Response("Not found", { status: 404 });
  }

  if (q.has("workspace")) return Response.json({ files: workspaceFiles() }, { headers: { "cache-control": "no-store" } });

  return Response.json({ files: listSent(Number(q.get("since")) || 0) }, { headers: { "cache-control": "no-store" } });
}
