import assert from "node:assert/strict";
import fsSync from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import JSZip from "jszip";

import type { BuildRequest } from "./types";

// A fake sync service shaped like a real Schoology class: a unit folder that
// holds only subfolders, documents that are really outside links behind
// /link?path=…, a link view, and a Page. The gatherer should open every
// subfolder of the matching unit (slides before agendas), leave the other unit
// alone, read files, Pages and link views, and put the review sheet first.

process.env.HOME = fsSync.mkdtempSync(path.join(os.tmpdir(), "slates-study-gather-"));
// Keep the Agent app's browser (if one is running here) out of the test.
process.env.SLATES_AGENT_CDP_PORT = "9";
const requests: string[] = [];
let materialsDown = false;

async function pptx(lines: string[]): Promise<Buffer> {
  const zip = new JSZip();
  lines.forEach((line, index) => zip.file(`ppt/slides/slide${index + 1}.xml`, `<p:sld><a:t>${line}</a:t></p:sld>`));
  return zip.generateAsync({ type: "nodebuffer" });
}

const MATERIALS: Record<string, { kind: string; title: string; url: string; folderId: string | null }[]> = {
  "": [
    { kind: "folder", title: "Unit 2: Forces", url: "/course/70/materials?f=20", folderId: "20" },
    { kind: "folder", title: "Unit 3: Energy", url: "/course/70/materials?f=30", folderId: "30" },
    { kind: "document", title: "Syllabus", url: "/course/7/materials/link/view/1", folderId: null },
  ],
  "20": [
    { kind: "folder", title: "Daily Agendas", url: "/course/70/materials?f=21", folderId: "21" },
    { kind: "folder", title: "PPTs & Resources", url: "/course/70/materials?f=22", folderId: "22" },
    { kind: "folder", title: "Assignments", url: "/course/70/materials?f=23", folderId: "23" },
  ],
  "21": [{ kind: "page", title: "Daily Agenda M 9/14", url: "/page/211", folderId: null }],
  "22": [
    { kind: "document", title: "Unit 2 Notes - Newton's Laws", url: "/course/7/materials/gp/221", folderId: null },
    { kind: "document", title: "Forces lecture slides", url: "/course/7/materials/gp/222", folderId: null },
    { kind: "document", title: "PhET forces simulation", url: "/link?a=&path=https%3A%2F%2Fphet.colorado.edu%2Fen%2Fsimulations%2Fforces&nid=5", folderId: null },
    { kind: "document", title: "Forces review video", url: "/course/7/materials/link/view/224", folderId: null },
    { kind: "document", title: "Forces slides (Google)", url: "/link?a=&path=https%3A%2F%2Fdocs.google.com%2Fpresentation%2Fd%2F1E7hR_Pd5XN2Ctl548ukMOJgZikUGAaPHN_kiN7IauPk%2Fedit&nid=9", folderId: null },
  ],
  "23": [{ kind: "assignment", title: "HW: Free-body diagrams", url: "/assignment/102", folderId: null }],
};

const PAGES: Record<string, { text: string; links: { title: string; url: string }[]; files: string[] }> = {
  "/page/211": { text: "Warm-up: name the Newton's third law pair for a book on a table.", links: [], files: [] },
  "/course/7/materials/link/view/224": { text: "Watch before the test: net force and free-body diagrams.", links: [{ title: "Video", url: "https://www.youtube.com/watch?v=abc" }], files: [] },
};

const setup = (async () => {
  const slides = await pptx(["Newton&apos;s second law: F = ma", "Free-body diagrams show every force"]);
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://scraper");
    requests.push(`${url.pathname}${url.search}`);
    const json = (body: unknown, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/course/materials") {
      if (materialsDown) return json({ error: "No Schoology session" }, 500);
      return json({ items: MATERIALS[url.searchParams.get("folder") ?? ""] ?? [], up: null });
    }
    if (url.pathname === "/course/page") {
      const page = PAGES[url.searchParams.get("path") ?? ""];
      return page ? json(page) : json({ error: "not a page" }, 500);
    }
    if (url.pathname === "/google/file") {
      // Stands in for a school-only Google file, read through the sync service's signed-in browser.
      if (url.searchParams.get("url") !== "https://docs.google.com/presentation/d/1E7hR_Pd5XN2Ctl548ukMOJgZikUGAaPHN_kiN7IauPk/export/txt") return json({ error: "not allowed" }, 500);
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      return res.end("Slide deck: Newton's first law, inertia, and net force.");
    }
    if (url.pathname === "/course/document") {
      const id = url.searchParams.get("path")!.split("/").pop();
      return json({ file: id === "222" ? "/attachment/222/source/slides.pptx" : `/attachment/${id}/source/notes.txt` });
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
  const gather = await import("./gather");
  return { server, ...gather };
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

test("opens every subfolder of the matching unit, reads files, Pages and link views, and ranks the review sheet first", async () => {
  const { gather } = await setup;
  const steps: string[] = [];
  const found = await gather(request, (step) => steps.push(step));

  for (const folder of ["20", "21", "22", "23"]) assert.ok(requests.includes(`/course/materials?course=7&folder=${folder}`), `opened folder ${folder}`);
  assert.ok(!requests.some((line) => line.includes("folder=30")), "left Unit 3 alone");
  assert.ok(requests.indexOf("/course/materials?course=7&folder=22") < requests.indexOf("/course/materials?course=7&folder=21"), "slides before agendas");

  const titles = found.sources.map((source) => source.title);
  const source = (title: string) => found.sources.find((entry) => entry.title === title)!;
  assert.equal(found.sources[0]!.kind, "writeup", "the test's own write-up leads");
  assert.ok(titles.indexOf("Review packet") < titles.indexOf("Unit 2 Notes - Newton's Laws"), "review before notes");
  assert.ok(titles.includes("HW: Free-body diagrams"), "unit homework included");
  assert.ok(!titles.includes("Energy worksheet") && !titles.includes("Unit 1 Test"), "other work left out");

  assert.match(found.texts.get(source("Forces lecture slides").n)!, /Slide 1: Newton's second law: F = ma/);
  assert.match(found.texts.get(source("Forces review video").n)!, /net force and free-body diagrams/);
  assert.match(found.texts.get(source("Daily Agenda M 9/14").n)!, /third law pair/);
  const google = source("Forces slides (Google)");
  assert.ok(google.read, "school-only Google file read through the sync service");
  assert.equal(google.url, "https://docs.google.com/presentation/d/1E7hR_Pd5XN2Ctl548ukMOJgZikUGAaPHN_kiN7IauPk/edit");
  assert.match(found.texts.get(google.n)!, /inertia, and net force/);
  const phet = source("PhET forces simulation");
  assert.equal(phet.read, false);
  assert.equal(phet.url, "https://phet.colorado.edu/en/simulations/forces");
  assert.match(phet.note!, /study agent can open it/);
  assert.equal(found.notice, undefined);
  assert.ok(steps.some((step) => step.includes("PPTs & Resources")));
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
  const { relevance } = await setup;
  const unnumbered = { markers: [], words: ["french", "revolution"] };
  assert.ok(relevance("Unit 2: The French Revolution", unnumbered) > 0);
  assert.equal(relevance("Unit 1: The Enlightenment", unnumbered), 0);
  const unit2 = { markers: ["unit 2"], words: ["forces"] };
  assert.ok(relevance("Unit 2: Forces", unit2) >= 12);
  assert.ok(relevance("Unit 3: Energy", unit2) < 0);
  assert.ok(relevance("Chapter 3 reading", unit2) === 0, "a chapter number says nothing about a unit");
});

test("unwraps Schoology's outside links and knows which Google files can be exported", async () => {
  const { unwrapLink, googleExport } = await setup;
  assert.equal(
    unwrapLink("/link?a=&path=https%3A%2F%2Fdocs.google.com%2Fpresentation%2Fd%2F1E7hR_Pd5XN2Ctl548ukMOJgZikUGAaPHN_kiN7IauPk%2Fedit&nid=8569763834"),
    "https://docs.google.com/presentation/d/1E7hR_Pd5XN2Ctl548ukMOJgZikUGAaPHN_kiN7IauPk/edit",
  );
  assert.equal(unwrapLink("/course/7/materials/gp/1"), "/course/7/materials/gp/1");
  assert.equal(googleExport("https://docs.google.com/document/d/1wWL4P01dyT9KceFHYciHaji6gcbaYtI7ImWSQdqUs2E/mobilebasic"), "https://docs.google.com/document/d/1wWL4P01dyT9KceFHYciHaji6gcbaYtI7ImWSQdqUs2E/export?format=txt");
  assert.equal(googleExport("https://docs.google.com/presentation/d/1E7hR_Pd5XN2Ctl548ukMOJgZikUGAaPHN_kiN7IauPk/edit#slide=id.g1"), "https://docs.google.com/presentation/d/1E7hR_Pd5XN2Ctl548ukMOJgZikUGAaPHN_kiN7IauPk/export/txt");
  assert.equal(googleExport("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view"), "https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOpQrStUvWxYz012345");
  assert.equal(googleExport("https://www.youtube.com/watch?v=abc"), null);
});

test.after(async () => {
  const { server } = await setup;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
