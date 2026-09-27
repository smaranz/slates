import fs from "node:fs";
import path from "node:path";

import { FILES_DIR } from "@/lib/agent/store";

/** Voice memos and attached images from agent chats. */

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { mp3: "audio/mpeg", png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name") ?? "";
  const match = /^(voice|img)_[a-z0-9]{6,40}\.(mp3|png|jpg|webp|gif)$/.exec(name);
  if (!match) return new Response("Not found", { status: 404 });
  try {
    const bytes = fs.readFileSync(path.join(FILES_DIR, name));
    return new Response(bytes, { headers: { "content-type": TYPES[match[2]!]!, "cache-control": "private, max-age=86400", "content-length": String(bytes.length) } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
