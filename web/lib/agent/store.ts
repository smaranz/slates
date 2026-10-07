import "server-only";

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AgentGroup, AgentProfile, ChatEvent, Routine, Skill } from "./types";

/**
 * Everything the Agent app keeps, on the machine that hosts Slates.
 *
 * Plain JSON and JSONL under ~/.slates/agent, written atomically, so a crash
 * mid-write leaves the previous file intact. Chats are append-only logs where
 * a later line with the same id replaces the earlier one.
 */

export const AGENT_HOME = path.join(os.homedir(), ".slates", "agent");
export const WORKSPACE = path.join(AGENT_HOME, "workspace");
export const FILES_DIR = path.join(AGENT_HOME, "files");
export const RUNTIME_DIR = path.join(AGENT_HOME, "runtime");
export const BROWSER_DIR = path.join(AGENT_HOME, "browser");
const CHATS_DIR = path.join(AGENT_HOME, "chats");

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${randomBytes(5).toString("hex")}`;
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function collection<T>(name: string) {
  const file = path.join(AGENT_HOME, `${name}.json`);
  return {
    all: (): T[] => readJson<{ items?: T[] }>(file, {}).items ?? [],
    save: (items: T[]) => writeJson(file, { items }),
  };
}

/** Read or write a named collection; for modules beside this one (threads). */
export function readCollection<T>(name: string): T[] {
  return collection<T>(name).all();
}

export function writeCollection<T>(name: string, items: T[]): void {
  collection<T>(name).save(items);
}

export const agents = collection<AgentProfile>("agents");
export const groups = collection<AgentGroup>("groups");
export const routines = collection<Routine>("routines");
export const skills = collection<Skill>("skills");

export function ensureDirs(): void {
  for (const dir of [AGENT_HOME, WORKSPACE, FILES_DIR, RUNTIME_DIR, CHATS_DIR]) fs.mkdirSync(dir, { recursive: true });
}

export function getAgent(id: string): AgentProfile | undefined {
  return agents.all().find((agent) => agent.id === id);
}

export function updateAgent(id: string, patch: (agent: AgentProfile) => AgentProfile): AgentProfile | undefined {
  const all = agents.all();
  const index = all.findIndex((agent) => agent.id === id);
  if (index < 0) return undefined;
  all[index] = patch(all[index]!);
  agents.save(all);
  return all[index];
}

export function findAgentByName(name: string): AgentProfile | undefined {
  const wanted = name.replace(/^@/, "").trim().toLowerCase();
  return agents.all().find((agent) => agent.name.toLowerCase() === wanted);
}

/* ---------- chats ---------- */

interface ChatCache {
  events: ChatEvent[];
  index: Map<string, number>;
  lines: number;
}

const state = globalThis as typeof globalThis & { __slatesAgentChats?: Map<string, ChatCache> };
const chats = (state.__slatesAgentChats ??= new Map());

function chatFile(chatId: string): string {
  if (!/^(agt|grp|thr)_[a-z0-9]{6,40}$/.test(chatId)) throw new Error("Invalid chat id.");
  return path.join(CHATS_DIR, `${chatId}.jsonl`);
}

function loadChat(chatId: string): ChatCache {
  const cached = chats.get(chatId);
  if (cached) return cached;
  const cache: ChatCache = { events: [], index: new Map(), lines: 0 };
  try {
    for (const line of fs.readFileSync(chatFile(chatId), "utf8").split("\n")) {
      if (!line.trim()) continue;
      cache.lines += 1;
      try {
        place(cache, JSON.parse(line) as ChatEvent);
      } catch {
        // A torn last line from a crash costs that line only.
      }
    }
  } catch {
    // No chat yet.
  }
  chats.set(chatId, cache);
  if (cache.lines > cache.events.length * 2 + 50) compact(chatId, cache);
  return cache;
}

function place(cache: ChatCache, event: ChatEvent): void {
  const at = cache.index.get(event.id);
  if (at === undefined) {
    cache.index.set(event.id, cache.events.length);
    cache.events.push(event);
  } else {
    cache.events[at] = event;
  }
}

function compact(chatId: string, cache: ChatCache): void {
  const file = chatFile(chatId);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(CHATS_DIR, { recursive: true });
  fs.writeFileSync(tmp, cache.events.map((event) => JSON.stringify(event)).join("\n") + "\n");
  fs.renameSync(tmp, file);
  cache.lines = cache.events.length;
}

export function chatEvents(chatId: string, limit = 400): ChatEvent[] {
  const events = loadChat(chatId).events;
  return events.length > limit ? events.slice(-limit) : events.slice();
}

export function getEvent(chatId: string, id: string): ChatEvent | undefined {
  const cache = loadChat(chatId);
  const at = cache.index.get(id);
  return at === undefined ? undefined : cache.events[at];
}

/** Record an event. Streaming updates stay in memory until `persist` is set. */
export function putEvent(chatId: string, event: ChatEvent, persist = true): void {
  const cache = loadChat(chatId);
  place(cache, event);
  if (!persist) return;
  fs.mkdirSync(CHATS_DIR, { recursive: true });
  fs.appendFileSync(chatFile(chatId), `${JSON.stringify(event)}\n`);
  cache.lines += 1;
}

/** Replace a chat's whole history (rollback, edit, branch). */
export function writeChat(chatId: string, events: ChatEvent[]): void {
  const cache: ChatCache = { events: [], index: new Map(), lines: 0 };
  for (const event of events) place(cache, event);
  chats.set(chatId, cache);
  compact(chatId, cache);
}

export function clearChat(chatId: string): void {
  chats.delete(chatId);
  fs.rmSync(chatFile(chatId), { force: true });
}

/** Every chat an agent can see: its own, and each group it belongs to. */
export function chatsForAgent(agentId: string): string[] {
  return [agentId, ...groups.all().filter((group) => group.members.includes(agentId)).map((group) => group.id)];
}
