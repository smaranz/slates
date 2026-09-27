import assert from "node:assert/strict";
import fsSync from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import JSZip from "jszip";

import type { BuildRequest } from "./types";

// A fake sync service standing in for Schoology: a class with a Unit 2 and a
// Unit 3 folder, and a test on Unit 2. The gatherer should open Unit 2 only,
// read its slides and notes, and put the review sheet first.

process.env.HOME = fsSync.mkdtempSync(path.join(os.tmpdir(), "slates-study-gather-"));
const requests: string[] = [];
let materialsDown = false;

async function pptx(lines: string[]): Promise<Buffer> {
  const zip = new JSZip();
  lines.forEach((line, index) => zip.file(`ppt/slides/slide${index + 1}.xml`, `<p:sld><a:t>${line}</a:t></p:sld>`));
  return zip.generateAsync({ type: "nodebuffer" });
}

const setup = (async () => {
  const slides = await pptx(["Newton&apos;s second law: F = ma", "Free-body diagrams show every force"]);
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://scraper");
    requests.push(`${url.pathname}${url.search}`);
    const json = (body: unknown) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/course/materials" && materialsDown) {
      res.writeHead(500, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "No Schoology session" }));
    }
    if (url.pathname === "/course/materials" && !url.searchParams.get("folder")) {
      return json({ items: [
        { kind: "folder", title: "Unit 2: Forces", url: "/course/7/materials?f=20", folderId: "20" },
        { kind: "folder", title: "Unit 3: Energy", url: "/course/7/materials?f=30", folderId: "30" },
        { kind: "document", title: "Syllabus", url: "/course/7/materials/gp/1", folderId: null },
      ] });
    }
    if (url.pathname === "/course/materials" && url.searchParams.get("folder") === "20") {
      return json({ items: [
        { kind: "document", title: "Unit 2 Notes - Newton's Laws", url: "/course/7/materials/gp/21", folderId: null },
        { kind: "document", title: "Forces lecture slides", url: "/course/7/materials/gp/22", folderId: null },
        { kind: "link", title: "PhET forces simulation", url: "/course/7/materials/link/23", folderId: null },
      ] });
    }
    if (url.pathname === "/course/document") {
      const id = url.searchParams.get("path")!.split("/").pop();
      return json({ file: id === "22" ? "/attachment/22/source/slides.pptx" : `/attachment/${id}/source/notes.txt` });
    }
    if (url.pathname === "/course/file") {
      const file = url.searchParams.get("path")!;
      res.writeHead(200, { "content-type": "application/octet-stream" });
      if (file.endsWith(".pptx")) return res.end(slides);
      return res.end(Buffer.from(file.includes("/41/") ? "Review: net force, Newton's third law pairs, friction." : "Net force is the vector sum of all forces."));
    }
    res.writeHead(404).end("{}");
  });
  const base = await new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    resolve(address && typeof address !== "string" ? `http://127.0.0.1:${address.port}` : "");
  }));
  process.env.SLATES_SCRAPER_URL = base;
  const { gather } = await import("./gather");
  return { server, gather };
})();

const request: BuildRequest = {
  target: { id: "100", courseId: "7", title: "Unit 2 Test", testKind: "test", brief: "Covers Newton's laws and free-body diagrams.", dateOffset: 3, due: "Due Tuesday" },
  course: { id: "7", name: "AP Physics 1" },
  related: [
    { id: "101", title: "Unit 2 Review Packet", dateOffset: 2, attachments: [{ kind: "file", title: "Review packet", url: "/attachment/41/source/review.txt" }] },
    { id: "102", title: "HW: Free-body diagrams", dateOffset: -2, brief: "Draw FBDs for problems 1-8." },
    { id: "103", title: "Unit 1 Test", dateOffset: -20 },
    { id: "104", title: "Energy worksheet", dateOffset: 10 },
  ],
};

test("opens the matching unit's folder, reads its files, and ranks the review sheet first", async () => {
  const { gather } = await setup;
  const steps: string[] = [];
  const found = await gather(request, (step) => steps.push(step));

  assert.ok(requests.includes("/course/materials?course=7&folder=20"), "opened Unit 2");
  assert.ok(!requests.some((line) => line.includes("folder=30")), "left Unit 3 alone");

  const titles = found.sources.map((source) => source.title);
  assert.equal(found.sources[0]!.kind, "writeup", "the test's own write-up leads");
  assert.ok(titles.indexOf("Review packet") < titles.indexOf("Unit 2 Notes - Newton's Laws"), "review before notes");
  assert.ok(titles.includes("HW: Free-body diagrams"), "unit homework included");
  assert.ok(!titles.includes("Energy worksheet"), "work after the test left out");
  assert.ok(!titles.includes("Unit 1 Test"), "other tests left out");

  const slides = found.sources.find((source) => source.title === "Forces lecture slides")!;
  assert.ok(slides.read);
  assert.match(found.texts.get(slides.n)!, /Slide 1: Newton's second law: F = ma/);
  const link = found.sources.find((source) => source.title === "PhET forces simulation")!;
  assert.equal(link.read, false);
  assert.match(link.note!, /link to another site/);
  assert.equal(found.notice, undefined);
  assert.ok(steps.some((step) => step.includes("Unit 2: Forces")));
});

test("says so, and still builds from the board, when Materials can't be reached", async () => {
  const { gather } = await setup;
  materialsDown = true;
  const found = await gather(request, () => {});
  materialsDown = false;
  assert.match(found.notice ?? "", /Couldn’t open this class’s Materials \(No Schoology session\)/);
  assert.ok(found.sources.some((source) => source.kind === "writeup" && source.read));
  assert.ok(found.sources.some((source) => source.title === "Review packet" && source.read));
});

test("a unit number only counts against a folder when the test names a different one", async () => {
  const { relevance } = await import("./gather");
  const unnumbered = { markers: [], words: ["french", "revolution"] };
  assert.ok(relevance("Unit 2: The French Revolution", unnumbered) > 0);
  assert.equal(relevance("Unit 1: The Enlightenment", unnumbered), 0);
  const unit2 = { markers: ["unit 2"], words: ["forces"] };
  assert.ok(relevance("Unit 2: Forces", unit2) >= 12);
  assert.ok(relevance("Unit 3: Energy", unit2) < 0);
  assert.ok(relevance("Chapter 3 reading", unit2) === 0, "a chapter number says nothing about a unit");
});

test.after(async () => {
  const { server } = await setup;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
