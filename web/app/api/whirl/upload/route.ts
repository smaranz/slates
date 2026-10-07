import fs from "node:fs";
import path from "node:path";

import { newKey, pruneUploads, UPLOADS_DIR, writeState } from "@/lib/whirl-server/state";

/**
 * Where the composer uploads an attachment before sending — Whirl's
 * "storage upload URL". The raw file is the body; the answer is the id the
 * send refers to it by.
 */

export const dynamic = "force-dynamic";

const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(request: Request) {
  const type = (request.headers.get("content-type") ?? "application/octet-stream").split(";")[0]!.trim();
  const bytes = Buffer.from(await request.arrayBuffer());
  if (!bytes.length) return Response.json({ error: "Empty file." }, { status: 400 });
  if (bytes.length > MAX_BYTES) return Response.json({ error: "Files are limited to 20 MB." }, { status: 413 });
  pruneUploads();
  const storageId = newKey("upl");
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOADS_DIR, storageId), bytes);
  writeState((s) => ({ ...s, uploads: { ...s.uploads, [storageId]: { file: storageId, type, size: bytes.length, at: Date.now() } } }));
  return Response.json({ storageId });
}
