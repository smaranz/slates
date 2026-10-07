import "server-only";

import fs from "node:fs";
import path from "node:path";

import type { SDKImage } from "@cursor/sdk";

import { busyChats, rerun, stopChat, userMessage, workspaceUpload } from "@/lib/agent/engine";
import { publish } from "@/lib/agent/hub";
import { agents, chatEvents, FILES_DIR, groups, newId, skills, writeChat } from "@/lib/agent/store";
import {
  allChatMeta,
  allThreads,
  chatTarget,
  createThread,
  deleteThread,
  getThread,
  updateChatMeta,
  updateThread,
  type ThreadTarget,
} from "@/lib/agent/threads";
import { DEFAULT_MODEL, type AgentProfile, type ChatEvent } from "@/lib/agent/types";
import { touch, touchThread } from "../bus";
import { toMessages, type AgentRef, type WireMessage } from "../convert";
import { readState, UPLOADS_DIR, writeState } from "../state";
import { fail, type Fn } from "./types";

/* ── helpers ───────────────────────────────────────────────────────────── */

const IMAGE_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

function agentRefs(): Map<string, AgentRef> {
  return new Map(agents.all().map((a) => [a.id, { id: a.id, name: a.name, hue: a.hue }]));
}

function targetName(target: ThreadTarget | null): string {
  if (!target) return "Gone";
  if (target.kind === "agent") return agents.all().find((a) => a.id === target.id)?.name ?? "Agent";
  return groups.all().find((g) => g.id === target.id)?.name ?? "Group";
}

/** A model key from the composer: "cursor/<id>" picks a model, anything else means the agent's own. */
export function modelFromKey(key: unknown): string | undefined {
  return typeof key === "string" && key.startsWith("cursor/") ? key.slice("cursor/".length) : undefined;
}

function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (!line) return "New chat";
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line;
}

/** The agent a brand-new chat goes to when nothing was picked: the first one, made if there are none. */
function defaultTarget(): ThreadTarget {
  const existing = agents.all()[0];
  if (existing) return { kind: "agent", id: existing.id };
  const agent: AgentProfile = {
    id: newId("agt"),
    name: "Atlas",
    job: "General help: research, files, the browser, and keeping you organized.",
    rules: "",
    model: DEFAULT_MODEL,
    hue: 210,
    voiceReplies: false,
    createdAt: Date.now(),
    memory: [],
  };
  agents.save([agent]);
  publish({ kind: "roster" });
  return { kind: "agent", id: agent.id };
}

function validTarget(raw: unknown): ThreadTarget | null {
  const t = raw as Partial<ThreadTarget> | undefined;
  if (!t || typeof t.id !== "string") return null;
  if (t.kind === "agent" && agents.all().some((a) => a.id === t.id)) return { kind: "agent", id: t.id };
  if (t.kind === "group" && groups.all().some((g) => g.id === t.id)) return { kind: "group", id: t.id };
  return null;
}

type ThreadSummary = ReturnType<typeof summary>;

function summary(args: {
  id: string;
  title: string;
  titleStatus?: string;
  createdAt: number;
  updatedAt: number;
  pinnedAt?: number;
  folderId?: string;
  model?: string;
  target: ThreadTarget | null;
  inbox: boolean;
}) {
  const agent = args.target?.kind === "agent" ? agents.all().find((a) => a.id === args.target!.id) : undefined;
  return {
    id: args.id,
    title: args.title,
    titleStatus: args.titleStatus ?? "ready",
    createdAt: args.createdAt,
    updatedAt: args.updatedAt,
    pinnedAt: args.pinnedAt ?? null,
    model: args.model ? `cursor/${args.model}` : null,
    compactionStatus: "idle",
    compactionBoundary: null,
    compactionUpdatedAt: null,
    compactionMarkers: [],
    shareId: null,
    locked: false,
    lockedTitle: null,
    folderId: args.folderId ?? null,
    branchedFromThreadId: null,
    /* The agent layer: who this conversation is with. */
    target: args.target ? { ...args.target, name: targetName(args.target), hue: agent?.hue ?? null } : null,
    /** The agent's or group's own chat, where routines and handoffs land. */
    inbox: args.inbox,
  };
}

function listThreads(): ThreadSummary[] {
  const meta = new Map(allChatMeta().map((m) => [m.id, m]));
  const rows: ThreadSummary[] = allThreads().map((t) =>
    summary({ ...t, model: t.model, target: t.target, inbox: false }),
  );
  // The original per-agent and per-group chats, once they have anything in them.
  const inboxes = [...agents.all().map((a) => ({ id: a.id, name: a.name, createdAt: a.createdAt })), ...groups.all().map((g) => ({ id: g.id, name: g.name, createdAt: g.createdAt }))];
  for (const chat of inboxes) {
    const events = chatEvents(chat.id, 1);
    const m = meta.get(chat.id);
    if (!events.length || m?.hidden) continue;
    rows.push(
      summary({
        id: chat.id,
        // Routines, handoffs and the tutor's passed-on work land here.
        title: m?.title ?? `${chat.name}'s inbox`,
        createdAt: chat.createdAt,
        updatedAt: Math.max(events[events.length - 1]!.at, m?.updatedAt ?? 0),
        pinnedAt: m?.pinnedAt,
        folderId: m?.folderId,
        target: chatTarget(chat.id),
        inbox: true,
      }),
    );
  }
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

function requireChat(threadId: unknown): string {
  const id = String(threadId ?? "");
  if (!chatTarget(id)) fail("That conversation doesn't exist anymore.");
  return id;
}

function messagesFor(chatId: string): WireMessage[] {
  return toMessages(chatEvents(chatId, 2000), agentRefs(), busyChats().get(chatId), readState().answers);
}

/** Map a message id back to its last event (for rollback and branching). */
function lastEventOf(chatId: string, messageId: string): string {
  const message = messagesFor(chatId).find((m) => m.id === messageId);
  const last = message?.eventIds[message.eventIds.length - 1];
  if (!last) fail("That message isn't in this chat anymore.");
  return last;
}

/** Attachments from the composer: images go to the model, everything else onto the PC. */
function takeAttachments(raw: unknown): { images: SDKImage[]; imageFiles: string[]; notes: string[] } {
  const images: SDKImage[] = [];
  const imageFiles: string[] = [];
  const notes: string[] = [];
  const uploads = readState().uploads;
  for (const item of Array.isArray(raw) ? raw.slice(0, 10) : []) {
    const a = item as { storageId?: string; name?: string; type?: string; text?: string };
    const upload = a.storageId ? uploads[a.storageId] : undefined;
    const name = String(a.name ?? "file").slice(0, 120);
    if (!upload) {
      if (a.text) notes.push(`Attached ${name}:\n${a.text.slice(0, 20_000)}`);
      continue;
    }
    const bytes = fs.readFileSync(path.join(UPLOADS_DIR, upload.file));
    const ext = IMAGE_EXT[upload.type];
    if (ext) {
      const file = `${newId("img")}.${ext}`;
      fs.mkdirSync(FILES_DIR, { recursive: true });
      fs.writeFileSync(path.join(FILES_DIR, file), bytes);
      imageFiles.push(file);
      images.push({ data: bytes.toString("base64"), mimeType: upload.type });
    } else {
      notes.push(`Attached file (saved on this PC): ${workspaceUpload(name, bytes)}`);
    }
  }
  return { images, imageFiles, notes };
}

function composeText(content: unknown, notes: string[], skillMentions: unknown): string {
  let text = typeof content === "string" ? content.trim().slice(0, 20_000) : "";
  const named = (Array.isArray(skillMentions) ? skillMentions : [])
    .map((m) => skills.all().find((s) => s.id === (m as { installId?: string }).installId)?.name)
    .filter(Boolean);
  if (named.length) text += `\n\n(Use the saved skill${named.length > 1 ? "s" : ""} ${named.map((n) => `"${n}"`).join(", ")}: open with get_skill first.)`;
  if (notes.length) text += `${text ? "\n\n" : ""}${notes.join("\n\n")}`;
  return text;
}

function bump(chatId: string): void {
  if (chatId.startsWith("thr_")) updateThread(chatId, (t) => ({ ...t, updatedAt: Date.now() }));
  else updateChatMeta(chatId, (m) => ({ ...m, updatedAt: Date.now(), hidden: false }));
}

/* ── threads ───────────────────────────────────────────────────────────── */

export const threads: Record<string, Fn> = {
  listForCurrentUser: () => listThreads(),

  runningThreadIds: () => [...busyChats().keys()],

  updateThread: ({ threadId, title }) => {
    const id = requireChat(threadId);
    const next = String(title ?? "").trim().slice(0, 120);
    if (!next) fail("A chat needs a name.");
    if (id.startsWith("thr_")) updateThread(id, (t) => ({ ...t, title: next, titleStatus: "ready" }));
    else updateChatMeta(id, (m) => ({ ...m, title: next }));
    touchThread(id);
    return null;
  },

  regenerateTitle: ({ threadId }) => {
    const id = requireChat(threadId);
    const firstUser = chatEvents(id, 2000).find((e) => e.type === "user") as Extract<ChatEvent, { type: "user" }> | undefined;
    if (id.startsWith("thr_")) updateThread(id, (t) => ({ ...t, title: titleFrom(firstUser?.text ?? t.title), titleStatus: "ready" }));
    touchThread(id);
    return null;
  },

  setPinned: ({ threadId, pinned }) => {
    const id = requireChat(threadId);
    const pinnedAt = pinned ? Date.now() : undefined;
    if (id.startsWith("thr_")) updateThread(id, (t) => ({ ...t, pinnedAt }));
    else updateChatMeta(id, (m) => ({ ...m, pinnedAt }));
    touch("threads");
    return null;
  },

  setFolder: ({ threadId, folderId }) => {
    const id = requireChat(threadId);
    const folder = typeof folderId === "string" ? folderId : undefined;
    if (id.startsWith("thr_")) updateThread(id, (t) => ({ ...t, folderId: folder }));
    else updateChatMeta(id, (m) => ({ ...m, folderId: folder }));
    touch("threads");
    return null;
  },

  deleteThread: async ({ threadId }) => {
    const id = requireChat(threadId);
    await stopChat(id);
    if (id.startsWith("thr_")) deleteThread(id);
    else {
      // An agent's own chat can't go — it's where its routines report — so it's cleared and hidden.
      writeChat(id, []);
      updateChatMeta(id, (m) => ({ ...m, hidden: true }));
    }
    touchThread(id);
    return null;
  },

  rollbackToMessage: async ({ threadId, messageId }) => {
    const id = requireChat(threadId);
    await stopChat(id);
    const keep = lastEventOf(id, String(messageId));
    const events = chatEvents(id, 100_000);
    writeChat(id, events.slice(0, events.findIndex((e) => e.id === keep) + 1));
    touchThread(id);
    return null;
  },

  branchThread: ({ threadId, messageId }) => {
    const id = requireChat(threadId);
    const keep = lastEventOf(id, String(messageId));
    const events = chatEvents(id, 100_000);
    const source = getThread(id);
    const thread = createThread(chatTarget(id)!, `${source?.title ?? targetName(chatTarget(id))} (branch)`, source?.model);
    writeChat(thread.id, events.slice(0, events.findIndex((e) => e.id === keep) + 1).filter((e) => !("streaming" in e && e.streaming)));
    touch("threads");
    return { threadId: thread.id };
  },

  getThreadArtifacts: () => ({ documents: [], htmlArtifacts: [] }),
  purgeIncognito: () => null,
  shareThread: () => fail("Chats stay on your PC — there are no public links in Slates."),
  unshareThread: () => null,
};

/* ── messages ──────────────────────────────────────────────────────────── */

export const messages: Record<string, Fn> = {
  listForThread: ({ threadId }) => {
    const id = String(threadId ?? "");
    return chatTarget(id) ? messagesFor(id) : [];
  },

  sendUserMessage: (args) => {
    let chatId = typeof args.threadId === "string" ? args.threadId : "";
    const options = (args.options ?? {}) as { model?: string };
    const { images, imageFiles, notes } = takeAttachments(args.attachments);
    const text = composeText(args.content, notes, args.skills);
    if (!text && !images.length) fail("Write something first.");

    if (!chatId) {
      const target = validTarget(args.target) ?? defaultTarget();
      chatId = createThread(target, titleFrom(String(args.content ?? "") || "Image"), modelFromKey(options.model)).id;
    } else {
      requireChat(chatId);
      const model = modelFromKey(options.model);
      if (chatId.startsWith("thr_")) updateThread(chatId, (t) => ({ ...t, model }));
    }

    const userEventId = userMessage(chatId, text || "(image)", images, imageFiles);
    bump(chatId);
    touchThread(chatId);
    return { threadId: chatId, userMessageId: userEventId, assistantId: `a_${userEventId}` };
  },

  updateAssistantMessage: async ({ threadId, status }) => {
    const id = requireChat(threadId);
    if (status === "stopped") await stopChat(id);
    touchThread(id);
    return null;
  },

  resetAssistantMessage: async ({ threadId, messageId }) => {
    const id = requireChat(threadId);
    const list = messagesFor(id);
    const at = list.findIndex((m) => m.id === messageId);
    const user = [...list.slice(0, at)].reverse().find((m) => m.role === "user");
    if (!user) fail("There's nothing to answer again.");
    await rerun(id, user.id);
    touchThread(id);
    return null;
  },

  updateUserMessage: ({ threadId, messageId, content }) => {
    const id = requireChat(threadId);
    const text = String(content ?? "").trim();
    if (!text) fail("A message can't be empty.");
    pendingEdits.set(`${id}:${messageId}`, text);
    return null;
  },

  prepareAssistantRetryFromUser: async ({ threadId, userMessageId }) => {
    const id = requireChat(threadId);
    const key = `${id}:${userMessageId}`;
    const text = pendingEdits.get(key);
    pendingEdits.delete(key);
    await rerun(id, String(userMessageId), text);
    touchThread(id);
    return null;
  },

  answerQuestionPhase: ({ threadId, messageId, answers }) => {
    const id = requireChat(threadId);
    const message = messagesFor(id).find((m) => m.id === messageId);
    const question = message?.phases?.find((p) => p.kind === "question") as { questions?: { id: string }[] } | undefined;
    const eventId = question?.questions?.[0]?.id;
    if (eventId) writeState((s) => ({ ...s, answers: { ...s.answers, [eventId]: Array.isArray(answers) ? answers : [] } }));
    touchThread(id);
    return null;
  },

  generateAttachmentUploadUrl: () => "/api/whirl/upload",
  getStreamBody: () => null,
  recentUsage: () => [],
};

/** An edit is two calls (rewrite, then retry); the text waits here in between. */
const pendingEdits = new Map<string, string>();

/* ── the composer's queue ──────────────────────────────────────────────── */

export const messageQueue: Record<string, Fn> = {
  // The agents queue turns themselves, so a queued message is simply sent.
  enqueue: (args) => messages.sendUserMessage!(args),
  listForThread: () => [],
  remove: () => null,
};
