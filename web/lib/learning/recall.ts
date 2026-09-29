import "server-only";

import fs from "node:fs";
import path from "node:path";

import { agents, chatEvents, groups } from "@/lib/agent/store";
import { MEMORY_HOME } from "./memory";

/**
 * Recall: finding something in a past conversation, the way Hermes Agent's
 * session search does, by plain word matching over every chat rather than
 * asking another model to summarise (slower, costs, and can make things up).
 *
 * It covers the agents' chats, which live on the host already, and the
 * tutor's, which the tutor route copies here as each reply finishes (the
 * tutor's own list is kept in the browser that asked).
 */

export const TUTOR_CHATS = path.join(MEMORY_HOME, "tutor-chats");

export interface TranscriptLine {
  who: string;
  text: string;
  at?: number;
}

export interface Transcript {
  id: string;
  where: "tutor" | "agent" | "group";
  title: string;
  updatedAt: number;
  lines: TranscriptLine[];
}

/* ---------- the tutor's copies ---------- */

export function isTutorChatId(id: unknown): id is string {
  return typeof id === "string" && /^c[a-z0-9]{4,40}$/.test(id);
}

export function saveTutorTranscript(chat: { id: string; title: string; lines: TranscriptLine[] }): void {
  if (!isTutorChatId(chat.id)) return;
  fs.mkdirSync(TUTOR_CHATS, { recursive: true });
  const file = path.join(TUTOR_CHATS, `${chat.id}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ id: chat.id, title: chat.title, updatedAt: Date.now(), lines: chat.lines }));
  fs.renameSync(tmp, file);
}

export function deleteTutorTranscript(id: string): void {
  if (isTutorChatId(id)) fs.rmSync(path.join(TUTOR_CHATS, `${id}.json`), { force: true });
}

function tutorTranscripts(): Transcript[] {
  let names: string[];
  try {
    names = fs.readdirSync(TUTOR_CHATS).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const out: Transcript[] = [];
  for (const name of names) {
    try {
      const chat = JSON.parse(fs.readFileSync(path.join(TUTOR_CHATS, name), "utf8")) as Omit<Transcript, "where">;
      if (isTutorChatId(chat.id) && Array.isArray(chat.lines)) out.push({ ...chat, where: "tutor", title: chat.title || "Tutor chat" });
    } catch {
      // A torn file costs that chat only.
    }
  }
  return out;
}

function agentTranscripts(): Transcript[] {
  const names = new Map(agents.all().map((agent) => [agent.id, agent.name]));
  const chats = [
    ...agents.all().map((agent) => ({ id: agent.id, where: "agent" as const, title: `${agent.name} (agent)` })),
    ...groups.all().map((group) => ({ id: group.id, where: "group" as const, title: `${group.name} (group chat)` })),
  ];
  return chats
    .map((chat) => {
      const lines: TranscriptLine[] = [];
      for (const event of chatEvents(chat.id, 5000)) {
        if (event.type === "user") lines.push({ who: "Student", text: event.text, at: event.at });
        else if (event.type === "agent" && !event.streaming && event.text.trim() !== "PASS") lines.push({ who: names.get(event.agentId) ?? "Agent", text: event.text, at: event.at });
        else if (event.type === "handoff") lines.push({ who: `${event.from === "tutor" ? "Tutor" : names.get(event.from) ?? "Agent"} → ${names.get(event.to) ?? "Agent"}`, text: event.text, at: event.at });
      }
      return { ...chat, updatedAt: lines.at(-1)?.at ?? 0, lines };
    })
    .filter((chat) => chat.lines.length);
}

export function allTranscripts(): Transcript[] {
  return [...tutorTranscripts(), ...agentTranscripts()];
}

/* ---------- searching ---------- */

const STOP = new Set(
  "a an and are as at be but by can could did do does for from had has have how i if in into is it its just me my of on or our so than that the their them then there these they this to was we were what when where which who why will with would you your about any some".split(" "),
);

/** A plural as its singular, so "tests" finds "test" and "studies" finds "study". */
function singular(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(s|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

/** Lower-cased words, stop words out and plurals folded. */
export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => word.length > 1 && !STOP.has(word)).map(singular);
}

export interface Hit {
  chat: Transcript;
  line: number;
  score: number;
}

/**
 * Chats ranked by their best-matching line: BM25-style weighting (a rare word
 * counts for more than a common one, repeats count for less each time), a
 * bonus for the whole phrase, and a slight lean toward recent chats.
 */
export function search(chats: Transcript[], query: string, limit = 5, now = Date.now()): Hit[] {
  const wanted = [...new Set(terms(query))];
  if (!wanted.length) return [];
  const phrase = query.trim().toLowerCase();
  const indexed = chats.map((chat) => chat.lines.map((line) => terms(line.text)));
  const docs = indexed.reduce((n, lines) => n + lines.length, 0) || 1;
  const df = new Map<string, number>();
  for (const lines of indexed) for (const words of lines) for (const word of new Set(words)) df.set(word, (df.get(word) ?? 0) + 1);

  const hits: Hit[] = [];
  for (const [c, chat] of chats.entries()) {
    let best: Hit | null = null;
    for (const [l, words] of indexed[c]!.entries()) {
      let score = 0;
      for (const word of wanted) {
        const tf = words.filter((w) => w === word).length;
        if (!tf) continue;
        const idf = Math.log(1 + (docs - (df.get(word) ?? 0) + 0.5) / ((df.get(word) ?? 0) + 0.5));
        score += idf * ((tf * 2.2) / (tf + 1.2));
      }
      if (!score) continue;
      if (phrase.length > 3 && chat.lines[l]!.text.toLowerCase().includes(phrase)) score *= 1.5;
      if (!best || score > best.score) best = { chat, line: l, score };
    }
    if (!best) continue;
    const days = Math.max(0, (now - (chat.lines[best.line]?.at ?? chat.updatedAt)) / 86_400_000);
    hits.push({ ...best, score: best.score * (1 + 0.15 * Math.exp(-days / 30)) });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

const when = (at: number) => (at ? new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "undated");

function header(chat: Transcript): string {
  return `${chat.where === "tutor" ? `Tutor chat "${chat.title}"` : chat.title} · last active ${when(chat.updatedAt)} · id ${chat.id}`;
}

/**
 * What `search_chats` answers: matches with a few lines either side, one chat
 * in full (around a match, if a query came with it), or the latest chats.
 */
export function recall(options: { query?: string; chat?: string; exclude?: string; chats?: Transcript[] }): string {
  const all = (options.chats ?? allTranscripts()).filter((chat) => chat.id !== options.exclude || chat.id === options.chat);
  const query = (options.query ?? "").trim();

  if (options.chat) {
    const chat = all.find((c) => c.id === options.chat);
    if (!chat) return `There's no chat with id ${options.chat}.`;
    const around = query ? search([chat], query, 1)[0]?.line : undefined;
    const start = around === undefined ? Math.max(0, chat.lines.length - 30) : Math.max(0, around - 12);
    const lines = chat.lines.slice(start, start + 30);
    return `${header(chat)}${start > 0 ? `\n(${start} earlier messages not shown)` : ""}\n\n${lines.map((line) => `${line.who}: ${clip(line.text, 1500)}`).join("\n\n")}`;
  }

  if (!query) {
    const recent = all.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 10);
    if (!recent.length) return "There are no past chats yet.";
    return `The most recent chats:\n${recent.map((chat) => `- ${header(chat)}: ${clip(chat.lines.find((line) => line.who === "Student")?.text ?? chat.lines[0]!.text, 140)}`).join("\n")}`;
  }

  const hits = search(all, query);
  if (!hits.length) return `Nothing in past chats matches "${query}".`;
  return [
    `${hits.length} past ${hits.length === 1 ? "chat mentions" : "chats mention"} that. To read more of one, call search_chats with its id as chat.`,
    ...hits.map((hit, n) => {
      const from = Math.max(0, hit.line - 2);
      const lines = hit.chat.lines.slice(from, hit.line + 3);
      return `[${n + 1}] ${header(hit.chat)}\n${lines.map((line) => `  ${line.who}: ${clip(line.text, line === hit.chat.lines[hit.line] ? 600 : 240)}`).join("\n")}`;
    }),
  ].join("\n\n");
}
