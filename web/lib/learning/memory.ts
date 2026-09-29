import "server-only";

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { agents, updateAgent } from "@/lib/agent/store";
import type { Learned, MemoryBookView, MemoryEntry } from "./types";

/**
 * What Slates' helpers remember between chats, kept the way Hermes Agent
 * keeps it: a few short entries held to a character budget and shown to the
 * model in full at the top of every turn, so remembering never depends on the
 * model deciding to look something up.
 *
 * Two books. The student profile is shared by every agent and the tutor, so
 * what one of them learns about the student, all of them know. Each helper
 * also keeps its own notes on how to do its job. A full book refuses a new
 * entry until the helper merges or drops old ones, rather than quietly pushing
 * the oldest out.
 */

export const MEMORY_HOME = path.join(os.homedir(), ".slates", "memory");

export const STUDENT_LIMIT = 2_500;
export const NOTES_LIMIT = 2_200;
const ENTRY_LIMIT = 400;

export interface Book {
  kind: "student" | "self";
  /** How the prompt heads it. */
  title: string;
  limit: number;
  read(): MemoryEntry[];
  write(entries: MemoryEntry[]): void;
}

function valid(entry: unknown): entry is MemoryEntry {
  const e = entry as MemoryEntry;
  return !!e && typeof e.id === "string" && typeof e.text === "string" && typeof e.at === "number";
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export function fileBook(file: string, kind: Book["kind"], title: string, limit: number): Book {
  return {
    kind,
    title,
    limit,
    read: () => {
      try {
        const items = (JSON.parse(fs.readFileSync(file, "utf8")) as { items?: unknown[] }).items;
        return Array.isArray(items) ? items.filter(valid) : [];
      } catch {
        return [];
      }
    },
    write: (entries) => writeJson(file, { items: entries }),
  };
}

export function studentBook(): Book {
  const book = fileBook(path.join(MEMORY_HOME, "student.json"), "student", "STUDENT PROFILE (shared by every agent and the tutor)", STUDENT_LIMIT);
  adoptAgentMemories(book);
  return book;
}

const ADOPTED = path.join(MEMORY_HOME, ".adopted-agent-memory");
let adopted = false;

/**
 * Once: what agents remembered before there was a shared profile moves into
 * it. Their old tool saved "a fact or preference about the student", which
 * is exactly what every helper should know, and left where it was it would
 * stay with the one agent that heard it. Newest first while there's room;
 * anything that doesn't fit, or that the profile would refuse, stays in that
 * agent's notes.
 */
function adoptAgentMemories(book: Book): void {
  if (adopted) return;
  adopted = true;
  if (fs.existsSync(ADOPTED)) return;
  try {
    const entries = book.read();
    const seen = new Set(entries.map((entry) => entry.text.toLowerCase()));
    let used = usedChars(entries);
    const moved = new Map<string, Set<string>>();
    const legacy = agents
      .all()
      .flatMap((agent) => (agent.memory ?? []).map((entry) => ({ agent, entry })))
      .sort((a, b) => b.entry.at - a.entry.at);
    for (const { agent, entry } of legacy) {
      const text = cleanEntry(entry.text);
      if (!text || text.length > ENTRY_LIMIT || SECRET.test(text)) continue;
      if (!seen.has(text.toLowerCase())) {
        if (used + text.length > book.limit) continue;
        entries.push({ id: entry.id, text, at: entry.at, by: agent.name });
        seen.add(text.toLowerCase());
        used += text.length;
      }
      if (!moved.has(agent.id)) moved.set(agent.id, new Set());
      moved.get(agent.id)!.add(entry.id);
    }
    if (moved.size) {
      book.write(entries.sort((a, b) => a.at - b.at));
      for (const [id, ids] of moved) updateAgent(id, (agent) => ({ ...agent, memory: agent.memory.filter((entry) => !ids.has(entry.id)) }));
    }
    fs.mkdirSync(MEMORY_HOME, { recursive: true });
    fs.writeFileSync(ADOPTED, `${new Date().toISOString()} moved=${[...moved.values()].reduce((n, ids) => n + ids.size, 0)}\n`);
  } catch (error) {
    // Nothing is lost either way; it's tried again on the next turn.
    adopted = false;
    console.error("[memory] couldn't move agents' memories into the shared profile:", error instanceof Error ? error.message : error);
  }
}

export function tutorBook(): Book {
  return fileBook(path.join(MEMORY_HOME, "tutor.json"), "self", "YOUR NOTES (only you see these)", NOTES_LIMIT);
}

export function usedChars(entries: MemoryEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.text.length, 0);
}

export function viewBook(book: Book): MemoryBookView {
  const entries = book.read();
  return { entries, limit: book.limit, used: usedChars(entries) };
}

function newId(): string {
  return `mem_${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
}

const count = (n: number) => n.toLocaleString("en-US");
const usage = (book: Book, entries: MemoryEntry[]) => `${count(usedChars(entries))}/${count(book.limit)} chars`;
const listing = (entries: MemoryEntry[]) => (entries.length ? entries.map((entry) => `§ ${entry.text}`).join("\n") : "(empty)");

/** Passwords, one-time codes and keys: a memory shown to every model on every turn is no place for them. */
const SECRET =
  /\b(password|passcode|passwd|api[ _-]?key|secret key|access token|auth token|2fa code|verification code|login code)\b\s*(is|was|:|=)|\b(sk|pk|rk)-[a-z0-9_-]{16,}|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}/i;

export function cleanEntry(text: string): string {
  return text.replace(/^[\s§•*-]+/, "").replace(/\s+/g, " ").trim();
}

export interface MemoryOp {
  action: "add" | "replace" | "remove";
  content?: string;
  old_text?: string;
}

export interface MemoryOutcome {
  ok: boolean;
  /** What the model is told. */
  message: string;
  change?: Learned;
}

/** An id, or a piece of text that picks out one entry. Duplicates with the same text count as one. */
function match(entries: MemoryEntry[], key: string): MemoryEntry[] {
  const byId = entries.filter((entry) => entry.id === key);
  if (byId.length) return byId;
  const needle = key.toLowerCase();
  return entries.filter((entry) => entry.text.toLowerCase().includes(needle));
}

/**
 * Add, replace or remove one entry, with Hermes' rules: `old_text` is a piece
 * of the entry rather than an id the model would have to carry around, a
 * piece that matches two different entries is refused, and a book with no
 * room says so with everything in it, so the model can make room and try
 * again in the same turn.
 */
export function editBook(book: Book, op: MemoryOp, by: string): MemoryOutcome {
  const entries = book.read();
  const name = book.kind === "student" ? "the student profile" : "your notes";
  const fail = (message: string): MemoryOutcome => ({ ok: false, message });
  const content = cleanEntry(op.content ?? "");

  if (op.action !== "remove") {
    if (!content) return fail("content is empty: say what to save.");
    if (content.length > ENTRY_LIMIT) return fail(`That entry is ${content.length} characters. Keep each entry under ${ENTRY_LIMIT}: split it, or say it shorter.`);
    if (SECRET.test(content)) return fail("Memory can't hold passwords, codes or keys. Leave that part out.");
  }

  const full = (after: number) =>
    fail(
      `${book.kind === "student" ? "The student profile is" : "Your notes are"} at ${usage(book, entries)}, and this would take it to ${count(after)}. Make room now, in this turn: ` +
        `use replace to merge overlapping entries into shorter ones, or remove ones that no longer matter, then try again. It holds:\n${listing(entries)}`,
    );

  if (op.action === "add") {
    if (entries.some((entry) => entry.text.toLowerCase() === content.toLowerCase())) return { ok: true, message: `That's already in ${name}.` };
    const after = usedChars(entries) + content.length;
    if (after > book.limit) return full(after);
    const next = [...entries, { id: newId(), text: content, at: Date.now(), by }];
    book.write(next);
    return { ok: true, message: `Saved to ${name} (${usage(book, next)}).`, change: { kind: "memory", action: "added", book: book.kind, text: content } };
  }

  const key = (op.old_text ?? "").trim();
  if (!key) return fail("old_text is empty: give a piece of the entry to change.");
  const hits = match(entries, key);
  if (!hits.length) return fail(`Nothing in ${name} contains "${key}". It holds:\n${listing(entries)}`);
  if (new Set(hits.map((hit) => hit.text.toLowerCase())).size > 1) {
    return fail(`"${key}" is in ${hits.length} different entries. Use a longer piece that picks out one:\n${listing(hits)}`);
  }
  const target = hits[0]!;

  if (op.action === "remove") {
    const next = entries.filter((entry) => !hits.includes(entry));
    book.write(next);
    return { ok: true, message: `Removed from ${name} (${usage(book, next)}).`, change: { kind: "memory", action: "removed", book: book.kind, text: target.text } };
  }

  const next = entries
    .filter((entry) => entry === target || !hits.includes(entry))
    .map((entry) => (entry === target ? { ...entry, text: content, at: Date.now(), by } : entry));
  const after = usedChars(next);
  if (after > book.limit) return full(after);
  book.write(next);
  return { ok: true, message: `Updated ${name} (${usage(book, next)}).`, change: { kind: "memory", action: "updated", book: book.kind, text: content } };
}

/** The books as the model sees them, with how full each is. */
export function renderBooks(books: Book[]): string {
  return books
    .map((book) => {
      const entries = book.read();
      return `${book.title} [${usage(book, entries)}]\n${entries.length ? listing(entries) : "(nothing yet)"}`;
    })
    .join("\n\n");
}

export const MEMORY_GUIDANCE = [
  "Your memory lasts between chats; it's shown above as it stands now. Keep it current with the memory tool, in the moment rather than at the end:",
  "- target student (shared with every agent and the tutor): what you learn about the student: preferences, how they like to be helped, their schedule and commitments, goals, what they find hard, and corrections they give you.",
  "- target self (yours alone): what makes you better at your job for them: approaches that worked, conventions for their work, quirks of a site or tool.",
  "- Save when they tell you something that will still matter next week, correct you, or ask you to remember something. Don't save one-off task details, what you did this turn, or anything already on their Schoology board.",
  "- Corrections and preferences first, then facts, then procedures. One short, specific entry per fact. Change an entry with replace rather than adding a near-duplicate; when a book is nearly full, merge or drop old entries.",
  "- Never save passwords, codes or keys.",
].join("\n");

export function memoryPrompt(books: Book[]): string {
  return `<memory>\n${renderBooks(books)}\n</memory>\n\n${MEMORY_GUIDANCE}`;
}
