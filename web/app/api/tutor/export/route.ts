import fs from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";

import { documentFileName } from "@/lib/tutor-documents";
import { isExportFormat, markdownToDocx } from "@/lib/tutor-export";
import { OUTPUT_DIR, ensureWorkspace } from "@/lib/tutor-skills";

/**
 * Turn a document the tutor wrote into a real file.
 *
 * Deliberately independent of Agent Skills. A skill can only make a file on
 * the one backend that runs a local Claude Code session, and only with shell
 * access — whereas every model can write markdown, so converting markdown
 * here means every model can produce a Word document.
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { title?: string; body?: string; format?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const markdown = String(body.body ?? "").trim();
  if (!markdown) return Response.json({ error: "Nothing to export." }, { status: 400 });

  const format = body.format ?? "docx";
  if (!isExportFormat(format)) {
    return Response.json({ error: `Can't export as ${format}.` }, { status: 400 });
  }

  const title = String(body.title ?? "Document").trim() || "Document";

  try {
    ensureWorkspace();
    // Reuses the slug the in-chat download already produces, so the same
    // document doesn't arrive under two different names.
    const name = documentFileName(title).replace(/\.md$/i, `.${format}`);
    const file = path.join(OUTPUT_DIR, path.basename(name));

    const bytes =
      format === "docx" ? await markdownToDocx(title, markdown) : Buffer.from(markdown, "utf8");
    await fs.writeFile(file, bytes);

    return Response.json({ name: path.basename(name), size: bytes.length });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Couldn't build that file." },
      { status: 500 }
    );
  }
}
