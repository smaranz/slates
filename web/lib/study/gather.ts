import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { TextLimits } from "../attachment-text";
import { SCRAPER_URL } from "../ports";
import type { ItemAttachment } from "../types";
import { classify } from "./detect";
import { googleExport, NeedsGoogleSignIn, readGoogle } from "./google";
import { fileText, READS } from "./scan";
import type { BuildRequest, SourceKind, StudyItemInput, StudySource } from "./types";
import { readUpload } from "./uploads";

/**
 * Go into Schoology and find what a test is actually on.
 *
 * Four places, in the order they are trusted: review sheets for the unit, the
 * test's own write-up and handouts, the class's Materials folders that match
 * the test (by unit or chapter number first, then by the words the unit's
 * homework uses), and the homework itself. Files are read through the sync
 * service, which holds the Schoology session; nothing here can reach
 * Schoology on its own.
 */

const PER_DOC: TextLimits = { chars: 14_000, pages: 40 };
/** What goes to the writer in total. Enough for a unit; not a semester. */
const BUDGET = 70_000;
const MAX_LISTINGS = 10;
const MAX_MATERIAL_FILES = 10;
const MAX_HOMEWORK = 8;
/** How far back a unit's homework reaches before a test. */
const UNIT_DAYS = 28;

export interface Gathered {
  sources: StudySource[];
  texts: Map<number, string>;
  notice?: string;
}

export interface MaterialItem {
  kind: string;
  title: string;
  filename?: string;
  url: string;
  folderId: string | null;
}

interface Candidate {
  title: string;
  kind: SourceKind;
  where: string;
  url: string | null;
  priority: number;
  /** Text already in hand (a write-up), or how to fetch it. */
  text?: string;
  attachment?: string;
  /** Any other readable Schoology link: a document, Page, link view or Google file. */
  item?: string;
  note?: string;
  /** The student chose it, so no cap on Materials files applies and it keeps more of its text. */
  picked?: boolean;
}

/** Text kept from one thing the student chose: more than an automatic find, because they chose it. */
const PICKED_CHARS = 30_000;

const STOP = new Set(
  ("the a an and or of to in on for with from by at as is are be this that these those your you my our their it its into " +
    "about test tests quiz quizzes exam exams examen prueba unit units chapter chapters hw homework due reminder need " +
    "bring class sections section part review study guide practice notes day week period lockdown browser alternate " +
    "retake group finish handout worksheet sheet page pages odd even from").split(" "),
);

export function words(text: string): string[] {
  const plain = text.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return [...new Set((plain.match(/[a-z][a-z'-]{2,}/g) ?? []).map((w) => w.replace(/'s$/, "")).filter((w) => !STOP.has(w)))];
}

/** "Unit 2", "Ch 4", "Chapter 10" and section numbers like 4.4, as comparable tokens. */
export function markers(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b(unit|u|chapter|ch|module|lesson|topic)\.?\s*#?\s*(\d{1,2})\b/gi)) {
    const label = /^u(nit)?$/i.test(m[1]!) ? "unit" : /^ch(apter)?$/i.test(m[1]!) ? "ch" : m[1]!.toLowerCase();
    out.add(`${label} ${Number(m[2])}`);
  }
  for (const m of text.matchAll(/\b(\d{1,2})\.\d{1,2}\b/g)) out.add(`ch ${Number(m[1])}`);
  return [...out];
}

export function relevance(title: string, context: { markers: string[]; words: string[] }): number {
  let score = 0;
  // "Unit 3" counts against a Unit 2 test, but says nothing about a test with no unit in its name.
  const kinds = new Set(context.markers.map((marker) => marker.split(" ")[0]));
  for (const marker of markers(title)) {
    if (context.markers.includes(marker)) score += 10;
    else if (kinds.has(marker.split(" ")[0])) score -= 6;
  }
  for (const word of words(title)) if (context.words.includes(word)) score += 2;
  if (/\b(review|study guide|practice (test|quiz|exam)|test prep|notes|key (terms|concepts)|vocab)/i.test(title)) score += 3;
  return score;
}

function extOf(url: string): string {
  return (/\.([a-z0-9]+)(?:[?#]|$)/i.exec(url)?.[1] ?? "").toLowerCase();
}

async function scraper<T>(pathAndQuery: string): Promise<T> {
  const response = await fetch(`${SCRAPER_URL}${pathAndQuery}`, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `The sync service answered ${response.status}.`);
  return body;
}

/** One level of a class's Materials, as Schoology files it. */
export async function listMaterials(courseId: string, folderId?: string | null): Promise<MaterialItem[]> {
  if (!/^\d+$/.test(courseId) || (folderId && !/^\d+$/.test(folderId))) throw new Error("That isn't a Schoology class or folder id.");
  return (await scraper<{ items: MaterialItem[] }>(`/course/materials?course=${courseId}${folderId ? `&folder=${folderId}` : ""}`)).items ?? [];
}

/** Schoology wraps outside links as /link?path=<url>; this is where they really go. */
export function unwrapLink(url: string): string {
  const wrapped = /^\/link\?(?:.*&)?path=([^&]+)/.exec(url);
  return wrapped ? decodeURIComponent(wrapped[1]!) : url;
}

export { googleExport };

/**
 * The words behind any link a class posts in Schoology: its own documents and
 * attachments, Pages the teacher wrote, link views, and the Google Docs and
 * Slides that most teachers post by link. Also returns where a page points, so
 * the study agent can follow it.
 */
export async function readSchoologyItem(raw: string): Promise<{ text: string; links: { title: string; url: string }[] }> {
  const url = raw.replace(/^https?:\/\/[\w.-]+\.schoology\.com(?=\/)/i, "");
  const outside = unwrapLink(url);
  if (/^https?:\/\//i.test(outside)) return { text: await readGoogle(outside, PER_DOC), links: [] };
  if (/^\/course\/\d+\/materials\/gp\/\d+$/.test(url) || /^\/attachment\/\d+\//.test(url)) return { text: await readSchoologyFile(url), links: [] };
  if (/^\/(?:page\/\d+|course\/\d+\/materials\/(?:link\/view|page)\/\d+)/.test(url)) {
    const page = await scraper<{ text: string; links: { title: string; url: string }[]; files: string[] }>(`/course/page?path=${encodeURIComponent(url)}`);
    const parts = [page.text];
    // A link view is mostly a frame around one Google file; read the file.
    const google = page.links.find((link) => googleExport(link.url));
    if (google && page.text.length < 600) parts.push(await readGoogle(google.url, PER_DOC).catch(() => ""));
    for (const file of page.files.slice(0, 3)) parts.push(await readSchoologyFile(file).catch(() => ""));
    const text = parts.filter(Boolean).join("\n\n").trim().slice(0, PER_DOC.chars);
    if (!text) throw new Error("That page has no text Slates can read.");
    return { text, links: page.links };
  }
  throw new Error("That isn't a link Slates can read. Open it in the browser.");
}

/**
 * The text of any Schoology file: a Materials document (/course/…/materials/gp/…)
 * or an attachment (/attachment/…). Read through the sync service's session and cached.
 */
export async function readSchoologyFile(url: string): Promise<string> {
  const cache = await loadCache();
  const file = /^\/course\/\d+\/materials\/gp\/\d+$/.test(url)
    ? (await scraper<{ file: string }>(`/course/document?path=${encodeURIComponent(url)}`)).file
    : url;
  if (!/^\/attachment\/\d+\//.test(file)) throw new Error("That isn't a Schoology file. Open other pages in the browser.");
  const text = await readAttachment(file, cache);
  await saveCache(cache);
  if (!text) throw new Error("Slates can't read text from that kind of file.");
  return text;
}

const cacheFile = () => path.join(os.homedir(), ".slates", "study", "text-cache.json");

function loadCache(): Promise<Record<string, string>> {
  return fs.readFile(cacheFile(), "utf8").then((raw) => JSON.parse(raw) as Record<string, string>, () => ({}));
}

async function saveCache(cache: Record<string, string>): Promise<void> {
  await fs.mkdir(path.dirname(cacheFile()), { recursive: true });
  await fs.writeFile(cacheFile(), JSON.stringify(cache)).catch(() => {});
}

/** Whole-handout text, read once per file and kept: a posted handout doesn't change. Scans and photos are read off the page. */
async function readAttachment(url: string, cache: Record<string, string>): Promise<string> {
  if (cache[url] !== undefined) return cache[url]!;
  const ext = extOf(url);
  if (!READS.includes(ext)) return "";
  const response = await fetch(`${SCRAPER_URL}/course/file?path=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Schoology wouldn't send the file (${response.status}).`);
  const name = decodeURIComponent(url.split(/[?#]/)[0]!.split("/").pop() || `file.${ext}`);
  const { text } = await fileText(await response.arrayBuffer(), ext, name, PER_DOC);
  cache[url] = text;
  return text;
}

function attachmentCandidates(item: StudyItemInput, kind: SourceKind, where: string, priority: number): Candidate[] {
  return (item.attachments ?? []).map((attachment: ItemAttachment) => {
    const base = { title: attachment.title || attachment.filename || "Attachment", kind, where, priority };
    if (attachment.kind === "file" && /^\/attachment\/\d+\//.test(attachment.url)) {
      return READS.includes(extOf(attachment.url))
        ? { ...base, url: attachment.url, attachment: attachment.url }
        : { ...base, url: attachment.url, note: "Not a format Slates can read." };
    }
    const target = attachment.target ?? unwrapLink(attachment.url);
    return googleExport(target)
      ? { ...base, url: target, item: target }
      : { ...base, url: target, note: "A link to another site; the study agent can open it in its browser." };
  });
}

/** The class's Materials folders that match the test, and the files in them. */
async function materialCandidates(
  courseId: string,
  context: { markers: string[]; words: string[] },
  onStep: (step: string) => void,
): Promise<{ candidates: Candidate[]; matched: string[] }> {
  let listings = 0;
  const list = async (folderId: string | null) => {
    listings += 1;
    return listMaterials(courseId, folderId);
  };

  const files: (MaterialItem & { where: string; score: number })[] = [];
  const matched: string[] = [];
  const take = (items: MaterialItem[], trail: string[], bias: number) => {
    for (const item of items) {
      if (item.kind === "folder" || ["assignment", "assessment", "discussion"].includes(item.kind)) continue;
      files.push({ ...item, where: ["Materials", ...trail].join(" › "), score: relevance(item.title, context) + bias });
    }
  };

  const root = await list(null);
  take(root, [], 0);
  const units = root
    .filter((item) => item.kind === "folder" && item.folderId)
    .map((item) => ({ item, score: relevance(item.title, context) }))
    .filter((folder) => folder.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
  for (const unit of units) {
    if (listings >= MAX_LISTINGS) break;
    matched.push(unit.item.title);
    onStep(`Opening “${unit.item.title}” in Materials`);
    const inside = await list(unit.item.folderId);
    take(inside, [unit.item.title], 4);
    // A unit's subfolders are all part of the unit, whatever they're called ("PPTs & Resources", "Daily Agendas").
    const subfolders = inside
      .filter((item) => item.kind === "folder" && item.folderId)
      .sort((a, b) => subfolderRank(b.title) - subfolderRank(a.title) || relevance(b.title, context) - relevance(a.title, context));
    for (const sub of subfolders) {
      if (listings >= MAX_LISTINGS) break;
      onStep(`Opening “${unit.item.title} › ${sub.title}”`);
      take(await list(sub.folderId), [unit.item.title, sub.title], 3 + subfolderRank(sub.title));
    }
  }

  const picked = files
    .filter((file) => file.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MATERIAL_FILES + 8);

  return {
    matched,
    candidates: picked.map((file) => {
      const outside = unwrapLink(file.url);
      const external = /^https?:\/\//i.test(outside);
      return {
        title: file.title || file.filename || "Untitled",
        kind: /\b(review|study guide|practice (test|quiz|exam)|test prep)\b/i.test(file.title) ? "review" : "material",
        where: file.where,
        url: external ? outside : file.url,
        priority: /\b(review|study guide)\b/i.test(file.title) ? 90 + file.score : 40 + file.score,
        ...(readable(file.url)
          ? { item: file.url }
          : { note: external ? "A link to another site; the study agent can open it in its browser." : "Slates can't read this kind of item." }),
      };
    }),
  };
}

/** A unit's subfolders to open first: its slides and notes before its daily agendas. */
function subfolderRank(title: string): number {
  if (/\b(review|study|test prep|notes|ppts?|slides|resources|readings?|handouts?|lectures?|videos?)\b/i.test(title)) return 2;
  if (/\b(daily|agendas?)\b/i.test(title)) return 0;
  return 1;
}

/** Whether Slates can read an item's words itself; the study agent can still open the rest in its browser. */
export function readable(url: string): boolean {
  const outside = unwrapLink(url);
  if (/^https?:\/\//i.test(outside)) return googleExport(outside) !== null;
  return /^\/(?:course\/\d+\/materials\/gp\/\d+$|attachment\/\d+\/|page\/\d+|course\/\d+\/materials\/(?:link\/view|page)\/\d+)/.test(url);
}

/** The student's own material: their notes on the test, files they uploaded, and Materials items they picked. */
async function chosenCandidates(request: BuildRequest): Promise<Candidate[]> {
  const out: Candidate[] = [];
  if (request.notes?.trim()) {
    out.push({ title: "Your notes on what it covers", kind: "writeup", where: "Written by you", url: null, priority: 99, text: request.notes.trim(), picked: true });
  }
  for (const id of request.uploads ?? []) {
    const upload = await readUpload(id).catch(() => null);
    const base = { kind: "handout" as const, where: "Uploaded by you", url: null, priority: 98 };
    if (!upload) out.push({ ...base, title: "An uploaded file", note: "The file is no longer on this computer. Upload it again." });
    else if (upload.error || !upload.text) out.push({ ...base, title: upload.name, note: upload.error ?? "Had no text Slates could read." });
    else out.push({ ...base, title: upload.name, text: upload.text, picked: true });
  }
  for (const pick of request.picks ?? []) {
    const outside = unwrapLink(pick.url);
    const external = /^https?:\/\//i.test(outside);
    out.push({
      title: pick.title,
      kind: /\b(review|study guide|practice (test|quiz|exam)|test prep)\b/i.test(pick.title) ? "review" : "material",
      where: `${pick.where || "Materials"} · picked by you`,
      url: external ? outside : pick.url,
      priority: 97,
      picked: true,
      ...(readable(pick.url)
        ? { item: pick.url }
        : { note: external ? "A link to another site; the study agent can open it in its browser." : "Slates can't read this kind of item." }),
    });
  }
  return out;
}

/** One candidate per file or link. When the student picked something Slates also found, their pick stays. */
function dedupe(candidates: Candidate[]): Candidate[] {
  const out: Candidate[] = [];
  const byKey = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key = candidate.item ?? candidate.attachment;
    if (!key) {
      out.push(candidate);
      continue;
    }
    const earlier = byKey.get(key);
    if (!earlier) {
      byKey.set(key, candidate);
      out.push(candidate);
    } else if (candidate.picked && !earlier.picked) {
      out[out.indexOf(earlier)] = candidate;
      byKey.set(key, candidate);
    }
  }
  return out;
}

export async function gather(request: BuildRequest, onStep: (step: string) => void): Promise<Gathered> {
  const { target, course } = request;
  const auto = request.auto !== false;
  const targetDay = target.dateOffset ?? 0;
  const unit = (auto ? request.related : [])
    .filter((item) => item.id !== target.id)
    .filter((item) => item.dateOffset == null || (item.dateOffset <= targetDay && item.dateOffset >= targetDay - UNIT_DAYS));
  const reviews = unit.filter((item) => /\b(review|study guide|practice (test|quiz|exam)|test prep)\b/i.test(item.title));
  const homework = unit
    .filter((item) => !reviews.includes(item) && !classify({ title: item.title, kind: item.kind }))
    .sort((a, b) => Math.abs(targetDay - (a.dateOffset ?? targetDay - UNIT_DAYS)) - Math.abs(targetDay - (b.dateOffset ?? targetDay - UNIT_DAYS)))
    .slice(0, MAX_HOMEWORK);

  const context = {
    markers: markers(`${target.title} ${target.brief ?? ""}`),
    words: words(`${target.title} ${target.title} ${target.brief ?? ""} ${[...reviews, ...homework].map((item) => item.title).join(" ")}`),
  };

  const candidates: Candidate[] = [];
  if (target.brief?.trim()) {
    candidates.push({ title: target.title, kind: "writeup", where: "The test’s description in Schoology", url: target.url ?? null, priority: 100, text: target.brief });
  }
  candidates.push(...attachmentCandidates(target, "handout", "Attached to the test", 95));
  candidates.push(...(await chosenCandidates(request)));
  for (const review of reviews) {
    if (review.brief?.trim()) candidates.push({ title: review.title, kind: "review", where: "Review assignment", url: review.url ?? null, priority: 92, text: review.brief });
    candidates.push(...attachmentCandidates(review, "review", `Attached to “${review.title}”`, 91));
  }
  for (const item of homework) {
    const where = `Homework${item.due ? ` · ${item.due.replace(/^Due\s+/i, "due ")}` : ""}`;
    if (item.brief?.trim()) candidates.push({ title: item.title, kind: "homework", where, url: item.url ?? null, priority: 30, text: item.brief });
    candidates.push(...attachmentCandidates(item, "homework", `Attached to “${item.title}”`, 35));
  }

  let notice: string | undefined;
  if (auto) {
    onStep(`Looking through ${course.name} in Schoology`);
    try {
      const found = await materialCandidates(course.id, context, onStep);
      candidates.push(...found.candidates);
      if (!found.matched.length && !found.candidates.length) notice = "No folder in this class’s Materials matched the test, so this is built from the test, its unit’s homework and review sheets.";
    } catch (error) {
      notice = `Couldn’t open this class’s Materials (${error instanceof Error ? error.message : String(error)}), so this is built from what’s on your board.`;
    }
  }

  const ordered = dedupe(candidates).sort((a, b) => b.priority - a.priority);
  const readableCount = ordered.filter((candidate) => candidate.text || candidate.attachment || candidate.item).length;
  onStep(readableCount ? `Reading ${readableCount} ${readableCount === 1 ? "item" : "items"} from Schoology` : "Nothing readable was posted for this test");

  const cache = await loadCache();
  const sources: StudySource[] = [];
  const texts = new Map<number, string>();
  let used = 0;
  let materialFiles = 0;
  let lockedGoogle = 0;
  for (const candidate of ordered) {
    const n = sources.length + 1;
    const source: StudySource = { n, title: candidate.title, kind: candidate.kind, where: candidate.where, url: candidate.url, chars: 0, read: false, ...(candidate.note ? { note: candidate.note } : {}) };
    sources.push(source);
    if (candidate.note) continue;
    if (used >= BUDGET) {
      source.note = "Left out — there was already enough to study from.";
      continue;
    }
    try {
      let text = candidate.text ?? "";
      if (candidate.attachment) text = await readAttachment(candidate.attachment, cache);
      if (candidate.item) {
        if (!candidate.picked && materialFiles >= MAX_MATERIAL_FILES) {
          source.note = "Left out — there was already enough to study from.";
          continue;
        }
        if (!candidate.picked) materialFiles += 1;
        text = (await readSchoologyItem(candidate.item)).text;
      }
      text = text.trim().slice(0, Math.min(candidate.picked ? PICKED_CHARS : PER_DOC.chars, BUDGET - used));
      if (!text) {
        source.note = "Had no text Slates could read.";
        continue;
      }
      texts.set(n, text);
      used += text.length;
      source.chars = text.length;
      source.read = true;
    } catch (error) {
      const message = error instanceof Error ? error.message.split("\n")[0]! : String(error);
      source.note = error instanceof NeedsGoogleSignIn || message.startsWith("Couldn’t") ? message : `Couldn’t be read: ${message}`;
      if (error instanceof NeedsGoogleSignIn) lockedGoogle += 1;
    }
  }
  await saveCache(cache);
  if (lockedGoogle) {
    notice = [
      notice,
      `${lockedGoogle === 1 ? "One of the class’s Google files is" : `${lockedGoogle} of the class’s Google files are`} shared only inside your school. Sign in to your school Google account once in Agent › Computer › Tutor & Study, then rebuild, and Slates can read ${lockedGoogle === 1 ? "it" : "them"}.`,
    ].filter(Boolean).join(" ");
  }
  return { sources, texts, notice };
}
