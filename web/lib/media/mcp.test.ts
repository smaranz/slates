import assert from "node:assert/strict";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const HOME = fsSync.mkdtempSync(path.join(os.tmpdir(), "slates-media-mcp-home-"));
const CWD = fsSync.mkdtempSync(path.join(os.tmpdir(), "slates-media-mcp-cwd-"));
const oldHome = process.env.HOME;
process.env.HOME = HOME;

type ToolContent = { type: string; text?: string; data?: string; mimeType?: string };
type ToolResult = { content: ToolContent[]; isError?: boolean };

const setup = (async () => {
  let apiBase = "";
  const api = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", apiBase || "http://localhost");
    if (req.method === "POST" && url.pathname === "/v1/flows/image") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "mcp-image-generation" }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/flows/image/mcp-image-generation") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "completed", content_url: `${apiBase}/image.png`, content_mime_type: "image/png" }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/image.png") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(Buffer.from("fake-png"));
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/voices") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ voices: [{ voice_id: "JBFqnCBsd6RMkjVDRZzb", name: "George" }] }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ detail: "not found" }));
  });

  await new Promise<void>((resolve, reject) => {
    api.once("error", reject);
    api.listen(0, "127.0.0.1", () => {
      const address = api.address();
      if (address && typeof address !== "string") apiBase = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });

  const webRoot = process.cwd();
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME,
    ELEVENLABS_API_KEY: "test",
    ELEVENLABS_API_BASE: apiBase,
  };
  const transport = new StdioClientTransport({
    command: path.resolve(webRoot, "node_modules/.bin/tsx"),
    args: [path.resolve(webRoot, "scripts/ui-mcp.mts")],
    cwd: CWD,
    env,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  const client = new Client({ name: "media-mcp-test", version: "1.0.0" });
  await client.connect(transport);
  return { api, client, getStderr: () => stderr };
})();

const transcript: string[] = [];

async function callTool(name: string, arguments_: Record<string, unknown>): Promise<ToolResult> {
  const { client } = await setup;
  return await client.callTool({ name, arguments: arguments_ }) as unknown as ToolResult;
}

test("slates-ui exposes the four shelf tools and nine media tools", async () => {
  const { client, getStderr } = await setup;
  const result = await client.listTools();
  const names = result.tools.map((tool) => tool.name);
  assert.equal(names.length, 13, getStderr());
  for (const name of [
    "list_registries", "search_components", "get_component", "install_command",
    "list_media", "get_media", "save_media", "list_media_models", "generate_image",
    "generate_video", "generate_speech", "generate_sound_effect", "generate_music",
  ]) assert.ok(names.includes(name), `${name} is registered`);
  transcript.push(`tools: ${names.join(", ")}`);
});

test("MCP generation, library reads, image content, and safe save work from another cwd", async () => {
  const generated = await callTool("generate_image", {
    prompt: "A tiny paper kite over the sea", model: "gpt-image-2", aspect_ratio: "1:1", wait_seconds: 12,
  });
  const image = generated.content.find((part) => part.type === "image");
  assert.ok(image && image.type === "image");
  const resultText = generated.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
  const id = resultText.match(/med_[a-z0-9]{8,40}/)?.[0];
  assert.ok(id, resultText);
  transcript.push(`generate_image: ${resultText}\nimage block: ${image.type} ${image.mimeType} ${image.data?.length ?? 0} base64 chars`);

  const listed = await callTool("list_media", { kind: "image", query: "paper kite" });
  const listText = listed.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
  assert.match(listText, new RegExp(id));
  transcript.push(`list_media: ${listText}`);

  const fetched = await callTool("get_media", { id });
  assert.ok(fetched.content.some((part) => part.type === "image"));
  transcript.push(`get_media: ${fetched.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n")}`);

  const saved = await callTool("save_media", { id, dest: "out/" });
  const savedText = saved.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
  assert.match(savedText, new RegExp(path.join(CWD, "out")));
  assert.equal(await fs.readdir(path.join(CWD, "out")).then((files) => files.length), 1);
  transcript.push(`save_media: ${savedText}`);

  const refused = await callTool("save_media", { id, dest: "out/" });
  assert.equal(refused.isError, true);
  const refusedText = refused.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
  const savedPath = savedText.split(" · ")[0]!;
  assert.equal(refusedText, `${savedPath} already exists — pass overwrite: true to replace it.`);
  transcript.push(`save_media second write: ${refusedText}`);
  await fs.writeFile("/tmp/media-studio-mcp.txt", `${transcript.join("\n\n")}\n`);
});

test.after(async () => {
  const { api, client } = await setup;
  await client.close();
  await new Promise<void>((resolve) => api.close(() => resolve()));
  if (oldHome === undefined) delete process.env.HOME;
  else process.env.HOME = oldHome;
  await fs.rm(HOME, { recursive: true, force: true });
  await fs.rm(CWD, { recursive: true, force: true });
});
