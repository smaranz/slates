#!/usr/bin/env node
/**
 * Builds the counselor's library index.
 *
 *   npm run counselor:ingest -- /path/to/knowledge-library
 *
 * Walks a directory of counseling material — PDFs, Word docs, slide decks,
 * spreadsheets, Markdown — pulls the text out of each, splits it into
 * retrieval-sized passages, embeds them, and writes the result to
 * `~/.slates/knowledge/`.
 *
 * The library itself is never copied into the repo. It is somebody's
 * accumulated professional material, often hundreds of megabytes of it, and it
 * is not Slates' to redistribute. Only the index — text passages and vectors —
 * lands on this machine, and only for the person who ran this.
 *
 * Re-running is safe and cheap: a manifest of file sizes and mtimes is kept
 * alongside the index, and an unchanged file keeps its existing embeddings
 * rather than paying to compute them again.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";

const run = promisify(execFile);
const require = createRequire(import.meta.url);

const OUT_DIR = path.join(os.homedir(), ".slates", "knowledge");
const MANIFEST = path.join(OUT_DIR, "index.json");
const VECTORS = path.join(OUT_DIR, "vectors.bin");
const SOURCES = path.join(OUT_DIR, "sources.json");

const MODEL = "text-embedding-3-small";
const DIMENSIONS = 512;
/** The embeddings endpoint takes an array; this is a comfortable batch. */
const BATCH = 96;
/** Past this, a "document" is a data dump and its text is noise. */
const MAX_DOC_CHARS = 900_000;

const EXTRACTABLE = new Set([".pdf", ".md", ".markdown", ".txt", ".docx", ".pptx", ".xlsx", ".csv"]);

/* ─────────────────────────── text extraction ─────────────────────────── */

async function extractPdf(file) {
  // The legacy build is the one that runs outside a browser: the modern entry
  // point reaches for DOM APIs that don't exist in Node.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await fsp.readFile(file));
  // `destroy()` lives on the loading task, not on the document it resolves to
  // — and it is the thing that shuts down the worker. Skipping it leaks a
  // worker per file, which over a few hundred documents is the whole run.
  const task = pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false });
  const doc = await task.promise;

  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // pdf.js hands back positioned runs, not lines. `hasEOL` is the only
    // signal for where a line actually ended; without it every page collapses
    // into one unbroken paragraph and the chunker has nothing to split on.
    let line = "";
    const lines = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      line += item.str;
      if (item.hasEOL) {
        lines.push(line);
        line = "";
      }
    }
    if (line) lines.push(line);
    pages.push(lines.join("\n"));
    page.cleanup();
  }
  await task.destroy();
  return pages.join("\n\n");
}

/** Every Office format is a zip of XML, so one unzip path serves all three. */
async function unzipEntries(file, match) {
  const { stdout } = await run("unzip", ["-Z1", file], { maxBuffer: 64 * 1024 * 1024 });
  const names = stdout.split("\n").filter((n) => match.test(n));
  const out = [];
  for (const name of names) {
    try {
      const { stdout: xml } = await run("unzip", ["-p", file, name], {
        maxBuffer: 128 * 1024 * 1024,
        encoding: "utf8",
      });
      out.push(xml);
    } catch {
      // A single unreadable part shouldn't cost the whole document.
    }
  }
  return out;
}

/** Strips XML to its text, keeping paragraph and cell boundaries as breaks. */
function xmlText(xml) {
  return xml
    .replace(/<\/(w:p|a:p|w:tr|row)>/g, "\n")
    .replace(/<\/(w:tc|c)>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

async function extractDocx(file) {
  const parts = await unzipEntries(file, /^word\/(document|header\d*|footer\d*)\.xml$/);
  return parts.map(xmlText).join("\n\n");
}

async function extractPptx(file) {
  const parts = await unzipEntries(file, /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/);
  // One slide per block, so a deck chunks slide-wise rather than as one wall.
  return parts.map((p) => xmlText(p).trim()).filter(Boolean).join("\n\n");
}

async function extractXlsx(file) {
  // Cell values live in a shared string table; the sheets hold indices into it.
  const [sharedXml] = await unzipEntries(file, /^xl\/sharedStrings\.xml$/);
  const shared = sharedXml
    ? [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText(m[1]).replace(/\s+/g, " ").trim())
    : [];

  const sheets = await unzipEntries(file, /^xl\/worksheets\/sheet\d+\.xml$/);
  const out = [];
  for (const sheet of sheets) {
    const rows = [];
    for (const row of sheet.match(/<row[\s\S]*?<\/row>/g) ?? []) {
      const cells = [];
      for (const cell of row.match(/<c[\s\S]*?(?:\/>|<\/c>)/g) ?? []) {
        const value = cell.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        if (value == null) continue;
        cells.push(/t="s"/.test(cell) ? (shared[Number(value)] ?? "") : value);
      }
      if (cells.some(Boolean)) rows.push(cells.join(" · "));
    }
    if (rows.length) out.push(rows.join("\n"));
  }
  return out.join("\n\n");
}

async function extract(file) {
  const ext = path.extname(file).toLowerCase();
  switch (ext) {
    case ".pdf": return extractPdf(file);
    case ".docx": return extractDocx(file);
    case ".pptx": return extractPptx(file);
    case ".xlsx": return extractXlsx(file);
    default: return fsp.readFile(file, "utf8");
  }
}

/* ─────────────────────────── embedding ─────────────────────────── */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function embedBatch(texts, key) {
  // A whole library runs into the per-minute token ceiling somewhere in the
  // last few hundred batches. That is a wait, not a failure — losing an hour
  // of extraction to it would be absurd, so back off and carry on.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, input: texts, dimensions: DIMENSIONS }),
    });

    if (res.ok) {
      const body = await res.json();
      // The API is documented to return them in order, but the index is on
      // each row and getting this wrong would misattribute every passage
      // silently.
      return body.data.sort((a, b) => a.index - b.index).map((row) => row.embedding);
    }

    const detail = await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 6) {
      throw new Error(`Embedding failed (${res.status}): ${detail.slice(0, 300)}`);
    }

    // Prefer the wait the server actually asked for over a guess.
    const asked = Number(detail.match(/try again in ([\d.]+)s/)?.[1]);
    const wait = Number.isFinite(asked) ? (asked + 1) * 1000 : 2000 * 2 ** attempt;
    process.stdout.write(`\r${res.status} — waiting ${(wait / 1000).toFixed(1)}s`.padEnd(48));
    await sleep(wait);
  }
}

/** Stored normalized, so retrieval's dot product is already the cosine. */
function normalize(vector) {
  let sum = 0;
  for (const v of vector) sum += v * v;
  const len = Math.sqrt(sum) || 1;
  return vector.map((v) => v / len);
}

/* ─────────────────────────── the run ─────────────────────────── */

function readKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  for (const name of [".env.local", ".env"]) {
    const file = path.join(process.cwd(), name);
    if (!fs.existsSync(file)) continue;
    const found = fs
      .readFileSync(file, "utf8")
      .match(/^OPENAI_API_KEY=(.*)$/m)?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, "");
    if (found) return found;
  }
  return null;
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (EXTRACTABLE.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

/** A readable title from a filename, with the noise publishers leave behind. */
function titleOf(file) {
  return path
    .basename(file, path.extname(file))
    .replace(/[_]+/g, " ")
    .replace(/\s*\(\d+\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const source = process.argv[2];
  if (!source) {
    console.error("Usage: npm run counselor:ingest -- <path to your knowledge library>");
    process.exit(1);
  }
  if (!fs.existsSync(source)) {
    console.error(`No such directory: ${source}`);
    process.exit(1);
  }

  const key = readKey();
  if (!key) {
    console.error("No OPENAI_API_KEY. Put one in web/.env.local or the environment.");
    process.exit(1);
  }

  // The chunker is TypeScript shared with the app. Importing it directly keeps
  // one definition of how a passage is cut.
  require("tsx/cjs");
  const { chunkDocument, cleanText, detectTopics, detectCycleYear } = require("../lib/counselor/knowledge/text.ts");

  const files = walk(source).sort();
  console.log(`Found ${files.length} readable files under ${source}\n`);

  // Anything already indexed and unchanged keeps its vectors.
  let previous = { chunks: [], sources: {} };
  let previousVectors = null;
  try {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
    const sources = JSON.parse(fs.readFileSync(SOURCES, "utf8"));
    const raw = fs.readFileSync(VECTORS);
    if (manifest.model === MODEL && manifest.dimensions === DIMENSIONS) {
      previous = { chunks: manifest.chunks, sources };
      previousVectors = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    }
  } catch {
    // No usable previous index. Everything gets embedded.
  }

  const chunks = [];
  /** Indices into previousVectors, or null where a fresh embedding is needed. */
  const reuse = [];
  const pending = [];
  const sources = {};

  let documents = 0;
  let skipped = 0;

  for (const [i, file] of files.entries()) {
    const rel = path.relative(source, file);
    const stat = fs.statSync(file);
    const stamp = `${stat.size}:${Math.round(stat.mtimeMs)}`;
    const label = `[${String(i + 1).padStart(3)}/${files.length}] ${rel.slice(0, 70)}`;

    // Unchanged since the last run: lift its chunks and vectors across.
    if (previous.sources[rel] === stamp && previousVectors) {
      const kept = previous.chunks
        .map((chunk, at) => ({ chunk, at }))
        .filter(({ chunk }) => chunk.file === rel);
      if (kept.length) {
        for (const { chunk, at } of kept) {
          chunks.push(chunk);
          reuse.push(at);
        }
        sources[rel] = stamp;
        documents++;
        console.log(`${label} — cached (${kept.length})`);
        continue;
      }
    }

    let text;
    try {
      text = await extract(file);
    } catch (err) {
      console.log(`${label} — SKIPPED (${err.message.slice(0, 60)})`);
      skipped++;
      continue;
    }

    const clean = cleanText(text).slice(0, MAX_DOC_CHARS);
    if (clean.length < 400) {
      // Almost always a scanned PDF with no text layer, or a cover sheet.
      console.log(`${label} — SKIPPED (no extractable text)`);
      skipped++;
      continue;
    }

    const isMarkdown = /\.(md|markdown)$/i.test(file);
    const parts = chunkDocument(clean, isMarkdown);
    if (!parts.length) {
      console.log(`${label} — SKIPPED (nothing to chunk)`);
      skipped++;
      continue;
    }

    const title = titleOf(file);
    const topics = detectTopics(path.basename(file), clean);
    const cycleYear = detectCycleYear(path.basename(file), clean);

    for (const part of parts) {
      chunks.push({ title, file: rel, heading: part.heading, content: part.content, topics, cycleYear });
      reuse.push(null);
      pending.push(part.heading ? `${title} — ${part.heading}\n${part.content}` : `${title}\n${part.content}`);
    }
    sources[rel] = stamp;
    documents++;
    console.log(`${label} — ${parts.length} passages${topics.length ? ` [${topics.join(", ")}]` : ""}`);
  }

  if (!chunks.length) {
    console.error("\nNothing could be read out of that directory.");
    process.exit(1);
  }

  const fresh = reuse.filter((r) => r === null).length;
  console.log(`\n${documents} documents, ${chunks.length} passages (${fresh} to embed, ${chunks.length - fresh} cached, ${skipped} files skipped)`);

  const vectors = new Float32Array(chunks.length * DIMENSIONS);
  let at = 0;
  for (let i = 0; i < chunks.length; i++) {
    if (reuse[i] === null) continue;
    vectors.set(previousVectors.subarray(reuse[i] * DIMENSIONS, (reuse[i] + 1) * DIMENSIONS), i * DIMENSIONS);
  }

  const needing = chunks.map((_, i) => i).filter((i) => reuse[i] === null);
  for (let start = 0; start < pending.length; start += BATCH) {
    const slice = pending.slice(start, start + BATCH);
    const embeddings = await embedBatch(slice, key);
    for (const [k, embedding] of embeddings.entries()) {
      vectors.set(normalize(embedding), needing[start + k] * DIMENSIONS);
    }
    at += slice.length;
    process.stdout.write(`\rEmbedding ${at}/${pending.length}`);
  }
  if (pending.length) process.stdout.write("\n");

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    MANIFEST,
    JSON.stringify({
      version: 1,
      builtAt: new Date().toISOString(),
      model: MODEL,
      dimensions: DIMENSIONS,
      documents,
      chunks,
    })
  );
  fs.writeFileSync(VECTORS, Buffer.from(vectors.buffer, vectors.byteOffset, vectors.byteLength));
  fs.writeFileSync(SOURCES, JSON.stringify(sources));

  const mb = (fs.statSync(VECTORS).size + fs.statSync(MANIFEST).size) / 1e6;
  console.log(`\nWrote ${OUT_DIR} — ${chunks.length} passages, ${mb.toFixed(1)} MB.`);
  console.log("The counselor will pick it up on its next question.");
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
