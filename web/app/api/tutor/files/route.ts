import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";

import { OUTPUT_DIR, ensureWorkspace } from "@/lib/tutor-skills";

/**
 * Files a skill wrote, and the way to open them.
 *
 * A `.docx` sitting in a folder the student never looks in is the same as no
 * document at all, so every reply checks what appeared while it was running
 * and the chat offers it directly.
 *
 * Listing is by modification time rather than by asking the tutor what it
 * made: the tutor's account of its own actions is a claim, and the directory
 * is the fact.
 */
export const dynamic = "force-dynamic";

/** Extensions worth opening in a browser tab rather than downloading blind. */
const INLINE: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};

const TYPES: Record<string, string> = {
  ...INLINE,
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/**
 * A name is only ever a single filename inside the output directory. Checked
 * rather than trusted: this value arrives from the page, and the directory
 * sits next to the Schoology session and the app's own config.
 */
function safeName(name: string): string | null {
  if (!name || name !== path.basename(name) || name.startsWith(".")) return null;
  return name;
}

export async function GET(req: NextRequest) {
  ensureWorkspace();
  const q = req.nextUrl.searchParams;
  const name = q.get("name");

  if (name) {
    const safe = safeName(name);
    if (!safe) return new Response("Not found", { status: 404 });

    const file = path.join(OUTPUT_DIR, safe);
    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile()) return new Response("Not found", { status: 404 });

    const ext = path.extname(safe).toLowerCase();
    const stream = createReadStream(file);
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          stream.on("data", (chunk) => controller.enqueue(new Uint8Array(chunk as Buffer)));
          stream.on("end", () => controller.close());
          stream.on("error", (err) => controller.error(err));
        },
        cancel() {
          stream.destroy();
        },
      }),
      {
        headers: {
          "content-type": TYPES[ext] ?? "application/octet-stream",
          "content-length": String(stat.size),
          // A Word file has nothing to render, so it downloads; a PDF opens.
          "content-disposition": `${ext in INLINE ? "inline" : "attachment"}; filename="${safe}"`,
          "cache-control": "private, max-age=300",
        },
      }
    );
  }

  // Everything written after `since`, which the composer sets to the moment
  // the turn began — so a reply only ever claims the files it actually made.
  const since = Number(q.get("since") ?? 0);
  try {
    const entries = await fs.readdir(OUTPUT_DIR, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((e) => e.isFile() && !e.name.startsWith("."))
        .map(async (e) => {
          const stat = await fs.stat(path.join(OUTPUT_DIR, e.name));
          return { name: e.name, size: stat.size, at: stat.mtimeMs };
        })
    );
    return Response.json({
      files: files.filter((f) => f.at >= since).sort((a, b) => a.at - b.at),
    });
  } catch {
    return Response.json({ files: [] });
  }
}
