import assert from "node:assert/strict";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// A scanned PDF (pages with no text layer) or a photo of notes is read off the
// page by a vision model; a PDF with real text never goes near one. The model
// is swapped for a fake here, so nothing is spent.

process.env.HOME = fsSync.mkdtempSync(path.join(os.tmpdir(), "slates-study-scan-"));

const setup = Promise.all([import("./scan"), import("./uploads")]).then(([scan, uploads]) => ({ ...scan, ...uploads }));

/** A one-page PDF, with a line of text on the page or with nothing: what a phone scanner writes is the second. */
function pdf(line?: string): ArrayBuffer {
  const content = line ? `BT /F1 12 Tf 72 720 Td (${line}) Tj ET` : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out).buffer as ArrayBuffer;
}

const LIMITS = { chars: 30_000, pages: 80 };
const calls: { mediaType: string; name: string; bytes: number }[] = [];
let answer: string | Error = "";

test.before(async () => {
  const { setScanReader } = await setup;
  setScanReader(async (file) => {
    calls.push({ mediaType: file.mediaType, name: file.name, bytes: file.data.byteLength });
    if (answer instanceof Error) throw answer;
    return answer;
  });
});

test("only an empty text layer, or a scanner app's stamp, counts as a scan", async () => {
  const { looksScanned } = await setup;
  for (const layer of ["", "[45 pages total]", "Scanned with CamScanner Scanned with CamScanner 1 2 3", "CamScanner"]) assert.ok(looksScanned(layer), layer);
  assert.equal(looksScanned("Newton's second law says the net force on an object equals its mass times its acceleration."), false);
});

test("a PDF with real text is read from its text layer, never by the model", async () => {
  const { fileText } = await setup;
  calls.length = 0;
  const read = await fileText(pdf("Newton's second law says the net force equals mass times acceleration, so a heavier cart needs more force."), "pdf", "notes.pdf", LIMITS);
  assert.equal(read.scanned, false);
  assert.match(read.text, /second law/);
  assert.equal(calls.length, 0);
});

test("a scanned PDF and a photo are read off the page", async () => {
  const { fileText } = await setup;
  calls.length = 0;
  answer = "Unit 4 review\nFriction opposes relative motion.\n--- page 2 ---\nf_k = mu_k N";
  const scan = await fileText(pdf(), "pdf", "CamScanner 9-20-26.pdf", LIMITS);
  assert.deepEqual([scan.scanned, scan.text], [true, answer]);
  const photo = await fileText(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer as ArrayBuffer, "jpg", "whiteboard.jpg", LIMITS);
  assert.equal(photo.scanned, true);
  assert.deepEqual(calls.map((call) => [call.mediaType, call.name]), [["application/pdf", "CamScanner 9-20-26.pdf"], ["image/jpeg", "whiteboard.jpg"]]);
});

test("a page with nothing on it comes back empty, and a failed read says so", async () => {
  const { fileText } = await setup;
  answer = "[nothing readable]";
  assert.deepEqual(await fileText(pdf(), "pdf", "blank.pdf", LIMITS), { text: "", scanned: true });
  answer = new Error("429 Rate limit reached\nretry later");
  await assert.rejects(fileText(pdf(), "pdf", "busy.pdf", LIMITS), { message: "Couldn’t read the scan: 429 Rate limit reached" });
});

test("an uploaded scan is read on arrival and says it was a scan", async () => {
  const { saveUpload, readUpload } = await setup;
  answer = "Chapter 4 notes: static friction holds until mu_s N.";
  const upload = await saveUpload("CamScanner 9-20-26 15.24 3.pdf", pdf());
  assert.deepEqual([upload.scanned, upload.chars, upload.error], [true, answer.length, undefined]);
  assert.equal((await readUpload(upload.id))!.text, answer);

  answer = new Error("Incorrect API key provided");
  const failed = await saveUpload("scan.pdf", pdf());
  assert.equal(failed.error, "Couldn’t read the scan: Incorrect API key provided");
  assert.equal(failed.chars, 0);

  answer = "[nothing readable]";
  assert.equal((await saveUpload("blank.png", new ArrayBuffer(8))).error, "Slates looked at every page and found no words to read.");
});

test("uploads take photos, but not HEIC or formats with no words", async () => {
  const { saveUpload } = await setup;
  await assert.rejects(saveUpload("IMG_2041.HEIC", new ArrayBuffer(4)), /HEIC photos/);
  await assert.rejects(saveUpload("slides.key", new ArrayBuffer(4)), /PDF, Word, PowerPoint and text files, and photos/);
});

test.after(async () => {
  const { setScanReader } = await setup;
  setScanReader(null);
});
