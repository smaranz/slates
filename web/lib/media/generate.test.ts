import assert from "node:assert/strict";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { MediaItem } from "./types";

const HOME = fsSync.mkdtempSync(path.join(os.tmpdir(), "slates-media-generate-"));
const oldHome = process.env.HOME;
const oldKey = process.env.ELEVENLABS_API_KEY;
const oldBase = process.env.ELEVENLABS_API_BASE;
process.env.HOME = HOME;
process.env.ELEVENLABS_API_KEY = "test";

const flows = new Map<string, { kind: string; polls: number; fail: boolean; after: number }>();
const flowBodies: Array<{ kind: string; body: Record<string, unknown> }> = [];
const audioBodies: Array<{ path: string; body: Record<string, unknown> }> = [];
let flowNo = 0;
let base = "";

function sendJson(res: import("node:http").ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

async function bodyOf(req: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

const setup = (async () => {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", base || "http://localhost");
    if (url.pathname === "/v1/voices") {
      return sendJson(res, 200, { voices: [{ voice_id: "JBFqnCBsd6RMkjVDRZzb", name: "George", category: "premade", preview_url: null }] });
    }
    const create = url.pathname.match(/^\/v1\/flows\/(image|video)$/);
    if (req.method === "POST" && create) {
      const body = await bodyOf(req);
      if (body.prompt === "unauthorized") return sendJson(res, 401, { detail: { message: "invalid key" } });
      const kind = create[1]!;
      const id = `remote-${kind}-${++flowNo}`;
      flowBodies.push({ kind, body });
      flows.set(id, { kind, polls: 0, fail: body.prompt === "video fails", after: body.prompt === "image needs two polls" ? 2 : 1 });
      return sendJson(res, 200, { id });
    }
    const status = url.pathname.match(/^\/v1\/flows\/(image|video)\/(.+)$/);
    if (req.method === "GET" && status) {
      const id = decodeURIComponent(status[2]!);
      const flow = flows.get(id);
      if (!flow) return sendJson(res, 404, { detail: "missing flow" });
      flow.polls += 1;
      if (flow.fail) return sendJson(res, 200, {
        status: "failed",
        error_message: "The render could not finish.",
        failure_reason: "insufficient_resources",
      });
      if (flow.polls < flow.after) return sendJson(res, 200, { status: "pending" });
      return sendJson(res, 200, {
        status: "completed",
        content_url: `${base}/asset/${flow.kind}`,
        content_mime_type: flow.kind === "image" ? "image/png" : "video/mp4",
      });
    }
    if (url.pathname.startsWith("/asset/")) {
      res.writeHead(200, { "content-type": url.pathname.endsWith("image") ? "image/png" : "video/mp4" });
      return res.end(Buffer.from("generated-media-bytes"));
    }
    if (req.method === "POST" && ["/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb", "/v1/sound-generation", "/v1/music"].includes(url.pathname)) {
      const body = await bodyOf(req);
      if (body.text === "audio unauthorized") return sendJson(res, 401, { detail: { message: "invalid key" } });
      audioBodies.push({ path: `${url.pathname}${url.search}`, body });
      res.writeHead(200, { "content-type": "audio/mpeg" });
      return res.end(Buffer.from("audio-bytes"));
    }
    sendJson(res, 404, { detail: "not found" });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address !== "string") base = `http://127.0.0.1:${address.port}`;
      process.env.ELEVENLABS_API_BASE = base;
      resolve();
    });
  });

  const [generate, library, store, elevenlabs] = await Promise.all([
    import("./generate"),
    import("./library"),
    import("../ai-usage/store-core"),
    import("./elevenlabs"),
  ]);
  return { server, generate, library, store, elevenlabs };
})();

function mediaEvents(store: typeof import("../ai-usage/store-core")) {
  return store.readEvents().filter((event) => event.agent === "media");
}

async function wait(generate: typeof import("./generate"), id: string): Promise<MediaItem> {
  const item = await generate.waitForItem(id, 12_000);
  assert.ok(item);
  return item;
}

test("image flow saves the remote id, waits through pending, downloads bytes, and records an image", async () => {
  const { generate, library, store } = await setup;
  const before = mediaEvents(store).length;
  const started = await generate.startGeneration({ kind: "image", prompt: "image needs two polls" }, "studio");
  assert.equal(started.status, "generating");
  assert.ok(started.remoteId);
  const completed = await wait(generate, started.id);
  assert.equal(completed.status, "completed");
  assert.equal(completed.bytes, Buffer.byteLength("generated-media-bytes"));
  assert.equal(await fs.readFile(library.mediaFilePath(completed), "utf8"), "generated-media-bytes");
  const event = mediaEvents(store).slice(before).at(-1);
  assert.equal(event?.agent, "media");
  assert.equal(event?.unit, "images");
  assert.equal(event?.inputTokens, 1);
});

test("a failed video is retained with its API error and does not record usage", async () => {
  const { generate, store } = await setup;
  const before = mediaEvents(store).length;
  const started = await generate.startGeneration({ kind: "video", prompt: "video fails" }, "studio");
  const failed = await wait(generate, started.id);
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "The render could not finish. (insufficient_resources)");
  assert.equal(mediaEvents(store).length, before);
});

test("create errors preserve the rejected-key message and missing keys fail before fetch", async () => {
  const { generate, elevenlabs } = await setup;
  await assert.rejects(
    generate.startGeneration({ kind: "image", prompt: "unauthorized" }, "mcp"),
    /ElevenLabs rejected the key \(invalid key\)\. Update it in AI Usage or ELEVENLABS_API_KEY\./,
  );
  const key = process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  await assert.rejects(
    generate.startGeneration({ kind: "speech", prompt: "No key" }, "studio"),
    (error: unknown) => error instanceof elevenlabs.MissingElevenLabsKeyError,
  );
  process.env.ELEVENLABS_API_KEY = key;
});

test("speech starts in the background, completes, and records characters", async () => {
  const { generate, store } = await setup;
  const before = mediaEvents(store).length;
  const started = await generate.startGeneration({ kind: "speech", prompt: "Hello there." }, "studio");
  assert.equal(started.status, "generating");
  const completed = await wait(generate, started.id);
  assert.equal(completed.status, "completed");
  const event = mediaEvents(store).slice(before).at(-1);
  assert.equal(event?.unit, "characters");
  assert.equal(event?.inputTokens, "Hello there.".length);
});

test("an audio job rejected with 401 becomes a failed item", async () => {
  const { generate, store } = await setup;
  const before = mediaEvents(store).length;
  const started = await generate.startGeneration({ kind: "speech", prompt: "audio unauthorized" }, "mcp");
  assert.equal(started.status, "generating");
  const failed = await wait(generate, started.id);
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "ElevenLabs rejected the key (invalid key). Update it in AI Usage or ELEVENLABS_API_KEY.");
  assert.equal(mediaEvents(store).length, before);
});

test("sound effects and music complete bytes and record seconds", async () => {
  const { generate, store } = await setup;
  const before = mediaEvents(store).length;
  const sfxStarted = await generate.startGeneration({ kind: "sfx", prompt: "A short bell", durationSecs: 3 }, "mcp");
  assert.equal(sfxStarted.status, "generating");
  const sfx = await wait(generate, sfxStarted.id);
  assert.equal(sfx.status, "completed");
  const musicStarted = await generate.startGeneration({ kind: "music", prompt: "A calm loop", lengthSecs: 10, instrumental: true }, "studio");
  assert.equal(musicStarted.status, "generating");
  const song = await wait(generate, musicStarted.id);
  assert.equal(song.status, "completed");

  const events = mediaEvents(store).slice(before);
  assert.deepEqual(events.map((event) => event.unit), ["seconds", "seconds"]);
  assert.equal(events[0]?.inputTokens, 3);
  assert.equal(events[1]?.inputTokens, 10);
  assert.equal(audioBodies.find((entry) => entry.path.startsWith("/v1/music"))?.body.music_length_ms, 10_000);
  assert.equal(audioBodies.find((entry) => entry.path.startsWith("/v1/music"))?.body.force_instrumental, true);
});

test("video animation sends a generation reference, remembers its parent, and is covered in plan credits", async () => {
  const { generate, library, store } = await setup;
  const before = mediaEvents(store).length;
  const source = await library.saveItem({
    id: library.newMediaId(),
    kind: "image",
    status: "completed",
    prompt: "Starting art",
    model: "gpt-image-2",
    options: { model_id: "gpt-image-2" },
    source: "studio",
    createdAt: Date.now(),
    remoteId: "source-generation",
  });
  const started = await generate.startGeneration({ kind: "video", prompt: "Animate this", startFrameId: source.id }, "mcp");
  assert.equal(started.parentId, source.id);
  const body = flowBodies.at(-1)?.body;
  assert.deepEqual(body?.start_frame, { type: "generation", generation_id: "source-generation" });
  assert.equal((await wait(generate, started.id)).status, "completed");
  const event = mediaEvents(store).slice(before).at(-1);
  assert.equal(event?.unit, "seconds");
  assert.equal(event?.inputTokens, 4);
  assert.equal(event?.covered, true);
  assert.equal(event?.listUsd, 0);
});

test("refreshing a persisted flow finalizes it after a process restart", async () => {
  const { generate, library } = await setup;
  const id = library.newMediaId();
  const item: MediaItem = {
    id,
    kind: "image",
    status: "generating",
    prompt: "Resume me",
    model: "gpt-image-2",
    options: { model_id: "gpt-image-2" },
    source: "mcp",
    createdAt: Date.now(),
    remoteId: "persisted-flow",
  };
  flows.set(item.remoteId!, { kind: "image", polls: 0, fail: false, after: 1 });
  await library.saveItem(item);
  const refreshed = await generate.refreshPending(item);
  assert.equal(refreshed.status, "completed");
});

test.after(async () => {
  const { server } = await setup;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (oldHome === undefined) delete process.env.HOME;
  else process.env.HOME = oldHome;
  if (oldKey === undefined) delete process.env.ELEVENLABS_API_KEY;
  else process.env.ELEVENLABS_API_KEY = oldKey;
  if (oldBase === undefined) delete process.env.ELEVENLABS_API_BASE;
  else process.env.ELEVENLABS_API_BASE = oldBase;
  await fs.rm(HOME, { recursive: true, force: true });
});
