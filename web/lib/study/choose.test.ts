import assert from "node:assert/strict";
import fsSync from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { BuildRequest, StudySet } from "./types";

// The student's own material: notes on what the test covers, files they
// upload, and Materials items they pick. It all comes right after the test's
// own write-up, and with the automatic search off Slates reads only that.

process.env.HOME = fsSync.mkdtempSync(path.join(os.tmpdir(), "slates-study-choose-"));
process.env.SLATES_AGENT_CDP_PORT = "9";
const requests: string[] = [];

const MATERIALS: Record<string, { kind: string; title: string; url: string; folderId: string | null }[]> = {
  "": [{ kind: "folder", title: "Chapter 4: Friction", url: "/course/70/materials?f=40", folderId: "40" }],
  "40": [
    { kind: "document", title: "Ch 4 friction notes", url: "/course/7/materials/gp/401", folderId: null },
    { kind: "document", title: "Inclined planes worksheet", url: "/course/7/materials/gp/402", folderId: null },
  ],
};

const setup = (async () => {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://scraper");
    requests.push(`${url.pathname}${url.search}`);
    const json = (body: unknown) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/course/materials") return json({ items: MATERIALS[url.searchParams.get("folder") ?? ""] ?? [], up: null });
    if (url.pathname === "/course/document") return json({ file: `/attachment/${url.searchParams.get("path")!.split("/").pop()}/source/notes.txt` });
    if (url.pathname === "/course/file") {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      return res.end(Buffer.from(url.searchParams.get("path")!.includes("/401/") ? "Kinetic friction is mu times the normal force." : "Resolve gravity along the incline."));
    }
    res.writeHead(404).end("{}");
  });
  const base = await new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    resolve(address && typeof address !== "string" ? `http://127.0.0.1:${address.port}` : "");
  }));
  process.env.SLATES_SCRAPER_URL = base;
  const [gather, uploads, store] = await Promise.all([import("./gather"), import("./uploads"), import("./store")]);
  return { server, ...gather, ...uploads, ...store };
})();

const base: BuildRequest = {
  target: { id: "c0k3x9q2m7p1z8w4", courseId: "7", title: "Ch 4 quiz: friction", testKind: "quiz", dateOffset: 2, due: "Tue, Sep 29" },
  course: { id: "7", name: "AP Physics 1" },
  related: [{ id: "201", title: "Friction Review Sheet", dateOffset: 1, brief: "Review: static vs kinetic friction." }],
  custom: true,
  date: "2026-09-29",
};

test("with the search off, reads only what the student chose, in their order after the test", async () => {
  const { gather, saveUpload } = await setup;
  const upload = await saveUpload("my notes.txt", new TextEncoder().encode("Static friction holds until mu_s times N.").buffer as ArrayBuffer);
  requests.length = 0;

  const found = await gather({
    ...base,
    auto: false,
    notes: "Sections 4.4 to 4.6. No calculators.",
    uploads: [upload.id],
    picks: [{ title: "Ch 4 friction notes", url: "/course/7/materials/gp/401", where: "Materials › Chapter 4: Friction" }],
  }, () => {});

  assert.ok(!requests.some((line) => line.startsWith("/course/materials")), "didn't search the class's Materials");
  assert.deepEqual(found.sources.map((source) => source.where), ["Written by you", "Uploaded by you", "Materials › Chapter 4: Friction · picked by you"]);
  assert.ok(found.sources.every((source) => source.read));
  assert.ok(!found.sources.some((source) => source.title === "Friction Review Sheet"), "left the board's review sheet out");
  assert.match(found.texts.get(2)!, /Static friction holds/);
  assert.match(found.texts.get(3)!, /mu times the normal force/);
  assert.equal(found.notice, undefined);
});

test("with the search on, a pick Slates also finds is listed once, as the student's", async () => {
  const { gather } = await setup;
  const found = await gather({
    ...base,
    picks: [{ title: "Ch 4 friction notes", url: "/course/7/materials/gp/401", where: "Materials › Chapter 4: Friction" }],
  }, () => {});

  const notes = found.sources.filter((source) => source.title === "Ch 4 friction notes");
  assert.equal(notes.length, 1);
  assert.match(notes[0]!.where, /picked by you$/);
  assert.ok(found.sources.some((source) => source.title === "Inclined planes worksheet" && source.read), "still found the rest of the unit");
  assert.ok(found.sources.some((source) => source.title === "Friction Review Sheet"), "and the board's review sheet");
});

test("an upload with no text, or one that's gone, is listed and says why", async () => {
  const { gather, saveUpload } = await setup;
  const empty = await saveUpload("blank.txt", new ArrayBuffer(0));
  assert.match(empty.error ?? "", /no text/);
  const found = await gather({ ...base, auto: false, uploads: [empty.id, "u0000000000000000000a"] }, () => {});
  assert.deepEqual(found.sources.map((source) => [source.title, source.read]), [["blank.txt", false], ["An uploaded file", false]]);
  assert.match(found.sources[1]!.note!, /no longer on this computer/);
});

test("uploads take readable formats only, and delete cleanly", async () => {
  const { saveUpload, readUpload, deleteUpload, isUploadId } = await setup;
  await assert.rejects(saveUpload("photo.heic", new ArrayBuffer(4)), /PDF, TXT, MD, CSV, DOCX and PPTX/);
  const upload = await saveUpload("chapter.md", new TextEncoder().encode("# Friction\nOpposes relative motion.").buffer as ArrayBuffer);
  assert.ok(isUploadId(upload.id));
  assert.equal(upload.chars, (await readUpload(upload.id))!.text.length);
  await deleteUpload(upload.id);
  assert.equal(await readUpload(upload.id), null);
  assert.equal(fsSync.readdirSync(path.join(process.env.HOME!, ".slates", "study", "uploads")).some((name) => name.startsWith(upload.id)), false);
});

test("a test added by hand gets a set id of its own, listed beside Schoology's", async () => {
  const { isStudyId, saveSet, listSets } = await setup;
  assert.ok(isStudyId("12345"));
  assert.ok(isStudyId("c0k3x9q2m7p1z8w4"));
  for (const bad of ["c123", "C0K3X9Q2M7P1Z8W4", "../c0k3x9q2m7p1z8w4", "x0k3x9q2m7p1z8w4"]) assert.ok(!isStudyId(bad), bad);
  const set: StudySet = {
    id: "c0k3x9q2m7p1z8w4", courseId: "7", course: "AP Physics 1", title: "Ch 4 quiz: friction", kind: "quiz", due: "Tue, Sep 29",
    status: "ready", step: "", createdAt: 1, updatedAt: 1, sources: [], overview: "", guide: "", cards: [], questions: [],
    progress: { cards: {}, answers: {} }, custom: true, date: "2026-09-29",
  };
  await saveSet(set);
  assert.ok((await listSets()).some((entry) => entry.id === set.id && entry.custom && entry.date === "2026-09-29"));
});

test.after(async () => {
  const { server } = await setup;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
