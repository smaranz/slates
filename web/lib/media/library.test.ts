import assert from "node:assert/strict";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { deleteMedia, getMedia, isMediaId, listMedia, mediaFilePath, newMediaId, saveItem, writeMediaFile } from "./library";
import type { MediaItem } from "./types";

const HOME = fsSync.mkdtempSync(path.join(os.tmpdir(), "slates-media-library-"));
const previousHome = process.env.HOME;
process.env.HOME = HOME;

function item(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: newMediaId(),
    kind: "image",
    status: "generating",
    prompt: "A paper lantern over the sea",
    model: "gpt-image-2",
    options: { model_id: "gpt-image-2", aspect_ratio: "1:1" },
    source: "studio",
    createdAt: Date.now(),
    ...overrides,
  };
}

test("saves, lists newest first, filters, reads, writes bytes, and deletes", async () => {
  const older = item({ createdAt: 10 });
  const newer = item({ kind: "music", model: "music_v2_5", prompt: "Rainy piano", createdAt: 20 });
  await saveItem(older);
  await saveItem(newer);

  assert.deepEqual((await listMedia()).map((entry) => entry.id), [newer.id, older.id]);
  assert.deepEqual((await listMedia({ kind: "music" })).map((entry) => entry.id), [newer.id]);
  assert.deepEqual((await listMedia({ query: "lantern" })).map((entry) => entry.id), [older.id]);
  assert.equal((await getMedia(older.id))?.prompt, older.prompt);

  const completed = await saveItem({ ...older, status: "completed" });
  const withFile = await writeMediaFile(completed.id, Buffer.from("image-bytes"), "image/png");
  assert.equal(withFile.file, `${older.id}.png`);
  assert.equal(withFile.bytes, 11);
  assert.equal(await fs.readFile(mediaFilePath(withFile), "utf8"), "image-bytes");
  assert.equal(await deleteMedia(older.id), true);
  assert.equal(await getMedia(older.id), null);
  assert.equal(await fs.access(mediaFilePath(withFile)).then(() => true, () => false), false);
  assert.equal(await deleteMedia(older.id), false);
});

test("rejects invalid ids and path-shaped item file names", async () => {
  assert.equal(isMediaId("../media"), false);
  await assert.rejects(getMedia("../media"), /Invalid media id/);
  await assert.rejects(deleteMedia("med_../../etc"), /Invalid media id/);
  await assert.rejects(saveItem(item({ file: "../../outside.png" })), /Invalid media file name/);
  const bad = item();
  await saveItem(bad);
  assert.throws(() => mediaFilePath({ ...bad, file: `${bad.id}/../outside.png` }), /Invalid media file name/);
});

test("list skips corrupt and invalid item files with one warning each", async () => {
  const directory = path.join(HOME, ".slates", "media", "items");
  await fs.mkdir(directory, { recursive: true });
  const corruptId = newMediaId();
  const invalidId = newMediaId();
  await fs.writeFile(path.join(directory, `${corruptId}.json`), "{not json");
  await fs.writeFile(path.join(directory, `${invalidId}.json`), JSON.stringify(item({ id: invalidId, file: "../../outside.png" })));

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = ((...values: unknown[]) => warnings.push(values.map(String).join(" "))) as typeof console.warn;
  let listed: MediaItem[] = [];
  try {
    listed = await listMedia();
  } finally {
    console.warn = originalWarn;
  }

  assert.ok(!listed.some((entry) => entry.id === corruptId || entry.id === invalidId));
  assert.equal(warnings.length, 2);
  assert.ok(warnings.some((warning) => warning.includes(`${corruptId}.json`)));
  assert.ok(warnings.some((warning) => warning.includes(`${invalidId}.json`)));
});

test("atomic writes leave no temporary files", async () => {
  const row = item();
  await saveItem(row);
  await writeMediaFile(row.id, Buffer.from("bytes"), "audio/mpeg");
  const root = path.join(HOME, ".slates", "media");
  const walk = async (dir: string): Promise<string[]> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(entries.map((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    }));
    return nested.flat();
  };
  assert.deepEqual((await walk(root)).filter((file) => file.endsWith(".tmp")), []);
});

test.after(async () => {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  await fs.rm(HOME, { recursive: true, force: true });
});
