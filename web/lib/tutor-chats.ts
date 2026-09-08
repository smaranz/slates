"use client";

import { useCallback, useSyncExternalStore } from "react";

import type { Attachment } from "./attachments";
import type { TutorDocument } from "./tutor-documents";
import type { TutorGraph } from "./tutor-graph";
import type { TutorImage } from "./tutor-image";
import type { Quiz } from "./tutor-quiz";

/**
 * Every tutor conversation, kept across reloads.
 *
 * The tutor used to hold its thread in component state, so leaving the view —
 * to look at the assignment being discussed, which is the obvious next thing
 * to do — threw the conversation away. Chats live here instead: one list, one
 * active id, written to disk.
 *
 * Deliberately its own store rather than part of `lib/store.tsx`. That store is
 * the board — the snapshot, your marks, what's synced — and it reloads and
 * rewrites all of it together. A conversation has nothing to do with any of
 * that and shouldn't ride along on its writes.
 */
const KEY = "slates.tutorChats.v1";

/** Chats past this are dropped oldest-first. Nothing needs a year of them. */
const MAX_CHATS = 40;

/** Streaming updates land per token; the disk doesn't need to see each one. */
const WRITE_DELAY_MS = 400;

export interface TutorChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments?: Attachment[];
  /** Human-readable summaries of any board actions this reply took. */
  actions?: string[];
  /** A practice set the tutor built for this reply, if it built one. */
  quiz?: Quiz;
  /** A study guide, outline, or other document the tutor wrote for this reply. */
  document?: TutorDocument;
  /** A graph the tutor plotted directly in chat (not inside a document or quiz). */
  graph?: TutorGraph;
  /**
   * A teaching video the tutor kicked off. Only the id is kept — the script,
   * narration and MP4 live under ~/.slates/lessons, orders of magnitude too
   * large for localStorage, and the player looks the lesson up by id.
   */
  lesson?: { id: string; topic: string };
  /**
   * Files a skill wrote during this reply. Names only — the bytes stay in
   * ~/.slates/tutor-output and are fetched on demand.
   */
  files?: { name: string; size: number }[];
  /** An illustration the tutor drew for this reply, if it drew one. */
  image?: TutorImage;
}

export interface TutorChat {
  id: string;
  /** Taken from the opening message; "New chat" until there is one. */
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: TutorChatMessage[];
}

interface ChatState {
  /** Most recently used first — the order the list renders in. */
  chats: TutorChat[];
  activeId: string;
}

const EMPTY: ChatState = { chats: [], activeId: "" };

const listeners = new Set<() => void>();

/** Null until the first client read; the server never has storage to read. */
let state: ChatState | null = null;
let flushTimer: number | null = null;
let flushOnExit: (() => void) | null = null;

function newId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function blankChat(): TutorChat {
  const now = Date.now();
  return { id: newId(), title: "", createdAt: now, updatedAt: now, messages: [] };
}

/**
 * The opening message, cut to something that fits a list row.
 *
 * Cut on a word so a title never ends mid-word, and never on the assistant's
 * reply — what *you* asked is what makes a conversation findable again.
 */
function titleFrom(messages: TutorChatMessage[]): string {
  const first = messages.find((m) => m.role === "user" && m.text.trim())?.text.trim();
  if (!first) return "";
  const flat = first.replace(/\s+/g, " ");
  if (flat.length <= 48) return flat;
  const cut = flat.lastIndexOf(" ", 48);
  return `${flat.slice(0, cut > 20 ? cut : 48)}…`;
}

function isChat(value: unknown): value is TutorChat {
  const c = value as TutorChat;
  return (
    !!c &&
    typeof c.id === "string" &&
    typeof c.title === "string" &&
    Array.isArray(c.messages) &&
    c.messages.every((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string")
  );
}

function load(): ChatState {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<ChatState>;
    const chats = (parsed.chats ?? []).filter(isChat).filter((c) => c.messages.length);
    if (!chats.length) return EMPTY;
    const activeId = chats.some((c) => c.id === parsed.activeId) ? parsed.activeId! : chats[0].id;
    return { chats, activeId };
  } catch {
    // A corrupt blob is not worth failing over — start with an empty list.
    return EMPTY;
  }
}

/**
 * What actually goes to disk.
 *
 * An attached image is a data URL and can be several megabytes, which is most
 * of the storage budget for one message. They are dropped on save and the chip
 * that named them is kept: a conversation is worth remembering, and a
 * screenshot pasted into it is not worth losing every other conversation over
 * when the quota blows. `toTutorMessageParts` tells the model plainly that a
 * dropped image is no longer available rather than pretending it can see it.
 */
function forStorage(value: ChatState): ChatState {
  return {
    activeId: value.activeId,
    chats: value.chats.slice(0, MAX_CHATS).map((chat) => ({
      ...chat,
      messages: chat.messages.map((m) => {
        const next = m.attachments?.some((a) => a.kind === "image")
          ? {
              ...m,
              attachments: m.attachments.map((a) =>
                a.kind === "image" ? { ...a, dataUrl: "", dropped: true } : a
              ),
            }
          : m;
        // Same trade as a pasted image: the prompt is worth keeping, the
        // generated bytes aren't worth the storage quota once saved.
        return next.image && next.image.dataUrl
          ? { ...next, image: { ...next.image, dataUrl: "", dropped: true } }
          : next;
      }),
    })),
  };
}

function save() {
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!state) return;

  // Shed the oldest conversations rather than losing the write entirely: a
  // long thread full of pasted documents can outgrow the quota on its own.
  let keep = forStorage(state);
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(keep));
      return;
    } catch {
      if (keep.chats.length <= 1) return;
      keep = { ...keep, chats: keep.chats.slice(0, Math.ceil(keep.chats.length / 2)) };
    }
  }
}

function commit(next: ChatState) {
  state = next;
  listeners.forEach((fn) => fn());

  if (flushTimer !== null) window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(save, WRITE_DELAY_MS);

  // A closed or backgrounded window doesn't wait out the debounce — the last
  // thing said before closing the tab is exactly what must not be lost.
  if (!flushOnExit) {
    flushOnExit = () => save();
    window.addEventListener("pagehide", flushOnExit);
    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") save();
    });
  }
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // A second window writing chats should show up here too.
  const reload = () => {
    state = load();
    listeners.forEach((fn) => fn());
  };
  window.addEventListener("storage", reload);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", reload);
  };
}

function getSnapshot(): ChatState {
  if (!state) state = load();
  return state;
}

/** The prerender has no storage, so it always renders an empty tutor. */
function getServerSnapshot(): ChatState {
  return EMPTY;
}

/* ---- whether the conversation rail is showing ---- */

const RAIL_KEY = "slates.tutorRail";
const railListeners = new Set<() => void>();

function subscribeRail(onChange: () => void) {
  railListeners.add(onChange);
  return () => railListeners.delete(onChange);
}

function getRailSnapshot(): boolean {
  try {
    const stored = window.localStorage.getItem(RAIL_KEY);
    // A first-run phone should lead with the conversation and composer, not a
    // 320px history drawer. Once the student chooses, that preference wins on
    // every viewport.
    if (stored === null) return !window.matchMedia("(max-width: 760px)").matches;
    return stored !== "0";
  } catch {
    return !window.matchMedia("(max-width: 760px)").matches;
  }
}

/** The prerender has no storage, and an open rail is the default anyway. */
function getRailServerSnapshot(): boolean {
  return true;
}

/**
 * Read through `useSyncExternalStore` rather than restored in an effect: an
 * effect that calls setState on mount paints the rail in the wrong state for a
 * frame first, and the prerender has no storage to read from at all.
 */
export function useTutorRail() {
  const open = useSyncExternalStore(subscribeRail, getRailSnapshot, getRailServerSnapshot);

  const toggle = useCallback(() => {
    try {
      window.localStorage.setItem(RAIL_KEY, getRailSnapshot() ? "0" : "1");
    } catch {
      /* ignore — the choice just won't survive a reload */
    }
    railListeners.forEach((fn) => fn());
  }, []);

  return [open, toggle] as const;
}

/**
 * Every saved conversation, plus the one being had right now.
 *
 * `updateMessages` takes the chat id explicitly rather than writing to
 * whichever chat is active: a reply streams in for seconds, and switching
 * conversations while it does must not pour the rest of it into the one you
 * switched to.
 */
export function useTutorChats() {
  const { chats, activeId } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  /** Start a fresh conversation, reusing the current one if it's already empty. */
  const startChat = useCallback(() => {
    const now = getSnapshot();
    const active = now.chats.find((c) => c.id === now.activeId);
    if (active && !active.messages.length) return active.id;

    const chat = blankChat();
    // Only ever one unused chat at a time — an abandoned blank is not history.
    const kept = now.chats.filter((c) => c.messages.length);
    commit({ chats: [chat, ...kept], activeId: chat.id });
    return chat.id;
  }, []);

  const openChat = useCallback((id: string) => {
    const now = getSnapshot();
    if (now.activeId === id || !now.chats.some((c) => c.id === id)) return;
    commit({ chats: now.chats.filter((c) => c.messages.length || c.id === id), activeId: id });
  }, []);

  const deleteChat = useCallback((id: string) => {
    const now = getSnapshot();
    const chats = now.chats.filter((c) => c.id !== id);
    commit({ chats, activeId: now.activeId === id ? (chats[0]?.id ?? "") : now.activeId });
  }, []);

  const renameChat = useCallback((id: string, title: string) => {
    const now = getSnapshot();
    const trimmed = title.replace(/\s+/g, " ").trim();
    if (!trimmed) return;
    commit({
      ...now,
      chats: now.chats.map((c) => (c.id === id ? { ...c, title: trimmed } : c)),
    });
  }, []);

  const updateMessages = useCallback(
    (id: string, update: (messages: TutorChatMessage[]) => TutorChatMessage[]) => {
      const now = getSnapshot();
      const chat = now.chats.find((c) => c.id === id);
      if (!chat) return;

      const messages = update(chat.messages);
      if (messages === chat.messages) return;

      const next: TutorChat = {
        ...chat,
        messages,
        title: chat.title || titleFrom(messages),
        updatedAt: Date.now(),
      };
      // Most recently used floats to the top, which is the order the list reads in.
      commit({ ...now, chats: [next, ...now.chats.filter((c) => c.id !== id)] });
    },
    []
  );

  return {
    chats,
    activeId,
    active: chats.find((c) => c.id === activeId),
    startChat,
    openChat,
    deleteChat,
    renameChat,
    updateMessages,
  };
}
