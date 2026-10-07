import "server-only";

import { agents, clearChat, groups, newId, readCollection, writeCollection } from "./store";

/**
 * Conversations with the agents.
 *
 * An agent used to have exactly one chat, its own (`agt_…`), plus one per group
 * it was in (`grp_…`). The Agent app now works like a chat app: any number of
 * threads, each with one agent or one group. A thread (`thr_…`) keeps its own
 * working context per agent, so a new conversation starts clean while the
 * agent's memory, skills and routines carry across all of them.
 *
 * The original per-agent and per-group chats still exist — routines, handoffs
 * and the tutor post there — and are listed as threads of their own.
 */

export type ThreadTarget = { kind: "agent" | "group"; id: string };

export interface AgentThread {
  id: string;
  title: string;
  titleStatus?: "generating" | "ready";
  createdAt: number;
  updatedAt: number;
  pinnedAt?: number;
  folderId?: string;
  /** Overrides the agent's own model for this conversation. */
  model?: string;
  target: ThreadTarget;
  /** The Cursor SDK runtime carrying each agent's context in this thread. */
  runtimes: Record<string, string>;
}

/** Sidebar state for the original chats, which have no thread record of their own. */
export interface ChatMeta {
  id: string;
  pinnedAt?: number;
  folderId?: string;
  title?: string;
  updatedAt?: number;
  hidden?: boolean;
}

const THREADS = "threads";
const META = "chat-meta";

export function allThreads(): AgentThread[] {
  return readCollection<AgentThread>(THREADS);
}

function saveThreads(items: AgentThread[]): void {
  writeCollection(THREADS, items);
}

export function getThread(id: string): AgentThread | undefined {
  return allThreads().find((thread) => thread.id === id);
}

export function createThread(target: ThreadTarget, title: string, model?: string): AgentThread {
  const now = Date.now();
  const thread: AgentThread = {
    id: newId("thr"),
    title,
    titleStatus: "ready",
    createdAt: now,
    updatedAt: now,
    target,
    runtimes: {},
    ...(model ? { model } : {}),
  };
  saveThreads([...allThreads(), thread]);
  return thread;
}

export function updateThread(id: string, patch: (thread: AgentThread) => AgentThread): AgentThread | undefined {
  const all = allThreads();
  const index = all.findIndex((thread) => thread.id === id);
  if (index < 0) return undefined;
  all[index] = patch(all[index]!);
  saveThreads(all);
  return all[index];
}

export function deleteThread(id: string): void {
  saveThreads(allThreads().filter((thread) => thread.id !== id));
  clearChat(id);
}

/* ── the original chats ─────────────────────────────────────────────────── */

export function allChatMeta(): ChatMeta[] {
  return readCollection<ChatMeta>(META);
}

export function updateChatMeta(id: string, patch: (meta: ChatMeta) => ChatMeta): void {
  const all = allChatMeta();
  const index = all.findIndex((meta) => meta.id === id);
  if (index < 0) all.push(patch({ id }));
  else all[index] = patch(all[index]!);
  writeCollection(META, all);
}

/* ── resolving a chat ───────────────────────────────────────────────────── */

/** Who a chat talks to: an agent's own chat, a group's, or a thread's target. */
export function chatTarget(chatId: string): ThreadTarget | null {
  if (chatId.startsWith("agt_")) return agents.all().some((a) => a.id === chatId) ? { kind: "agent", id: chatId } : null;
  if (chatId.startsWith("grp_")) return groups.all().some((g) => g.id === chatId) ? { kind: "group", id: chatId } : null;
  if (chatId.startsWith("thr_")) return getThread(chatId)?.target ?? null;
  return null;
}

export function isGroupChat(chatId: string): boolean {
  return chatTarget(chatId)?.kind === "group";
}

/** The group a chat belongs to, if it's a group conversation. */
export function groupOfChat(chatId: string) {
  const target = chatTarget(chatId);
  return target?.kind === "group" ? groups.all().find((g) => g.id === target.id) : undefined;
}

/** The agents a chat reaches. */
export function membersOfChat(chatId: string): string[] {
  const target = chatTarget(chatId);
  if (!target) return [];
  if (target.kind === "agent") return [target.id];
  return groups.all().find((g) => g.id === target.id)?.members ?? [];
}
