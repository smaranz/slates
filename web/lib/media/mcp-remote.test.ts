import assert from "node:assert/strict";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import type { MediaItem } from "./types";

// With SLATES_HOST set, the tools must use that host's /api/media and never
// this machine's library or ElevenLabs key.

const HOME = fsSync.mkdtempSync(path.join(os.tmpdir(), "slates-media-remote-home-"));
const CWD = fsSync.mkdtempSync(path.join(os.tmpdir(), "slates-media-remote-cwd-"));

type ToolResult = { content: { type: string; text?: string; data?: string }[]; isError?: boolean };

const PNG = Buffer.from("remote-png-bytes");
const items = new Map<string, MediaItem & { filePath?: string }>();
const requests: string[] = [];
let polls = 0;

function stored(id: string, prompt: string, status: MediaItem["status"]): MediaItem & { filePath?: string } {
  return {
    id, kind: "image", status, prompt, model: "gpt-image-2",
    options: { model_id: "gpt-image-2", aspect_ratio: "1:1" }, source: "studio", createdAt: Date.now(),
    ...(status === "completed" ? { file: `${id}.png`, mime: "image/png", bytes: PNG.byteLength, filePath: `C:\\Users\\pc\\.slates\\media\\files\\${id}.png` } : {}),
  };
}

const setup = (async () => {
  items.set("med_remote00001", stored("med_remote00001", "A lighthouse drawn in ink", "completed"));
  const host = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://host");
    requests.push(`${req.method} ${url.pathname}${url.search}`);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/api/media" && req.method === "GET") {
      const id = url.searchParams.get("id");
      if (id) {
        const item = items.get(id);
        if (!item) return json(404, { error: "Media item not found." });
        if (item.status === "generating" && ++polls >= 2) items.set(id, stored(id, item.prompt, "completed"));
        return json(200, { item: items.get(id) });
      }
      return json(200, { items: [...items.values()], connected: true });
    }
    if (url.pathname === "/api/media" && req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { prompt: string };
      const item = stored("med_remote00002", input.prompt, "generating");
      items.set(item.id, item);
      return json(201, { item });
    }
    if (url.pathname === "/api/media/file") {
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(PNG);
    }
    if (url.pathname === "/api/media/voices") return json(200, { voices: [{ id: "voice-1", name: "Host voice" }] });
    json(404, { error: "not found" });
  });
  const base = await new Promise<string>((resolve) => host.listen(0, "127.0.0.1", () => {
    const address = host.address();
    resolve(address && typeof address !== "string" ? `http://127.0.0.1:${address.port}` : "");
  }));

  const webRoot = process.cwd();
  const transport = new StdioClientTransport({
    command: path.resolve(webRoot, "node_modules/.bin/tsx"),
    args: [path.resolve(webRoot, "scripts/ui-mcp.mts")],
    cwd: CWD,
    // No ElevenLabs key and a temp HOME: anything that ran locally would fail.
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME, SLATES_HOST: `${base}/` },
    stderr: "pipe",
  });
  const client = new Client({ name: "media-remote-test", version: "1.0.0" });
  await client.connect(transport);
  return { host, client };
})();

async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const { client } = await setup;
  return (await client.callTool({ name, arguments: args })) as unknown as ToolResult;
}

const textOf = (result: ToolResult) => result.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");

test("lists and reads the host's library, with the image inlined", async () => {
  const listed = await call("list_media", {});
  assert.match(textOf(listed), /med_remote00001 · image · completed/);
  assert.match(textOf(listed), /on http:\/\/127\.0\.0\.1:\d+$/m);

  const fetched = await call("get_media", { id: "med_remote00001" });
  assert.match(textOf(fetched), /stored on the Slates host/);
  const image = fetched.content.find((part) => part.type === "image");
  assert.equal(Buffer.from(image?.data ?? "", "base64").toString(), PNG.toString());
});

test("generates through the host and polls it until the item completes", async () => {
  const result = await call("generate_image", { prompt: "A kite over the sea", wait_seconds: 20 });
  assert.equal(result.isError, undefined, textOf(result));
  assert.match(textOf(result), /med_remote00002/);
  assert.ok(requests.some((line) => line.startsWith("POST /api/media")));
  assert.ok(requests.filter((line) => line === "GET /api/media?id=med_remote00002").length >= 2);
});

test("saves a host file into the working directory and refuses to overwrite it", async () => {
  const saved = await call("save_media", { id: "med_remote00001", dest: "assets/" });
  const written = textOf(saved).split(" · ")[0]!;
  assert.equal(path.dirname(written), path.join(fsSync.realpathSync(CWD), "assets"));
  assert.equal(await fs.readFile(written, "utf8"), PNG.toString());
  const again = await call("save_media", { id: "med_remote00001", dest: "assets/" });
  assert.equal(again.isError, true);
  assert.match(textOf(again), /already exists — pass overwrite: true/);
});

test("voices come from the host", async () => {
  assert.match(textOf(await call("list_media_models", { kind: "speech" })), /voice-1 — Host voice/);
});

test.after(async () => {
  const { host, client } = await setup;
  await client.close();
  await new Promise<void>((resolve) => host.close(() => resolve()));
  await fs.rm(HOME, { recursive: true, force: true });
  await fs.rm(CWD, { recursive: true, force: true });
});
