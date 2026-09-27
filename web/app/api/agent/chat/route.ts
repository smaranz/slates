import fs from "node:fs";
import path from "node:path";

import type { SDKImage } from "@cursor/sdk";

import { stopChat, userMessage, workspaceUpload } from "@/lib/agent/engine";
import { chatEvents, FILES_DIR, newId } from "@/lib/agent/store";
import { isChatId } from "@/lib/agent/types";

/** One chat: read its transcript, send a message (with attachments), or stop the work in it. */

export const dynamic = "force-dynamic";

const MAX_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!isChatId(id)) return Response.json({ error: "Unknown chat." }, { status: 404 });
  return Response.json({ events: chatEvents(id) });
}

interface Attachment {
  name: string;
  type: string;
  data: string;
}

export async function POST(request: Request) {
  let body: { chatId?: string; text?: string; op?: string; attachments?: Attachment[]; speak?: boolean };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const chatId = body.chatId ?? "";
  if (!isChatId(chatId)) return Response.json({ error: "Unknown chat." }, { status: 404 });

  if (body.op === "stop") {
    await stopChat(chatId);
    return Response.json({ ok: true });
  }

  let text = typeof body.text === "string" ? body.text.trim().slice(0, 20_000) : "";
  const attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 8) : [];
  const images: SDKImage[] = [];
  const imageFiles: string[] = [];
  const saved: string[] = [];
  let total = 0;
  try {
    for (const file of attachments) {
      const bytes = Buffer.from(String(file.data ?? ""), "base64");
      total += bytes.length;
      if (total > MAX_BYTES) return Response.json({ error: "Attachments are limited to 20 MB per message." }, { status: 413 });
      const ext = IMAGE_TYPES[file.type];
      if (ext) {
        const name = `${newId("img")}.${ext}`;
        fs.mkdirSync(FILES_DIR, { recursive: true });
        fs.writeFileSync(path.join(FILES_DIR, name), bytes);
        imageFiles.push(name);
        images.push({ data: bytes.toString("base64"), mimeType: file.type });
      } else {
        saved.push(workspaceUpload(String(file.name ?? "file"), bytes));
      }
    }
    if (saved.length) text += `${text ? "\n\n" : ""}Attached files (saved on this PC):\n${saved.map((p) => `- ${p}`).join("\n")}`;
    if (!text && !images.length) return Response.json({ error: "Write something first." }, { status: 400 });
    userMessage(chatId, text || "(image)", images, imageFiles, body.speak === true);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
