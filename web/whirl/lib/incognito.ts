"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useMutation } from "@whirl/backend/react";
import { api } from "@whirl/backend/convex/_generated/api";
import type { Id } from "@whirl/backend/convex/_generated/dataModel";

import { clearPendingSend } from "./messages";
import { showToast } from "./toasts";

/* Incognito: an ephemeral chat that never touches the sidebar, the URL,
   or any localStorage cache. A thread row does exist server-side (the
   stream needs somewhere to land) but it's flagged `incognito` — hidden
   from listings, memory, and search — and hard-purged the moment you
   leave. State is a module-level store (mirrors lib/toasts.ts), and
   deliberately NOT persisted: a reload drops it, and the janitor sweep
   on the next load deletes whatever thread that reload orphaned. */

export type IncognitoState = {
  enabled: boolean;
  /** The ephemeral thread backing this session — latched on first send,
   *  never surfaced in the URL. */
  threadId: string | null;
};

const OFF: IncognitoState = { enabled: false, threadId: null };

let state: IncognitoState = OFF;
const listeners = new Set<() => void>();

function set(next: IncognitoState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useIncognitoState(): IncognitoState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => OFF,
  );
}

/** First send latches the freshly created thread; later sends reuse it. */
export function latchIncognitoThread(threadId: string) {
  if (state.enabled && state.threadId === null) {
    set({ enabled: true, threadId });
  }
}

export function useIncognitoActions() {
  const purge = useMutation(api.threads.purgeIncognito);

  const enter = useCallback(() => {
    set({ enabled: true, threadId: null });
    /* Clean slate: sweep anything a crashed session left behind. Best
       effort — the load-time janitor catches whatever this misses. */
    void purge({}).catch(() => {});
  }, [purge]);

  const leave = useCallback(() => {
    const { threadId } = state;
    set(OFF);
    if (!threadId) return;
    clearPendingSend(threadId);
    void purge({ threadId: threadId as Id<"threads"> }).catch(() =>
      showToast("Couldn't delete the incognito chat — it'll be swept next visit"),
    );
  }, [purge]);

  return { enter, leave };
}

/* The home greeting while incognito — you're nobody in particular here,
   so no name, just a knowing wink. Re-rolled on every entry. */
export const INCOGNITO_TAGLINES = [
  "Off the record.",
  "This chat never happened.",
  "Leave no trace.",
  "Just between us.",
  "Nobody was here.",
  "Gone when you are.",
  "Written in disappearing ink.",
  "Ask away. I'll forget.",
];

export function pickIncognitoTagline() {
  return INCOGNITO_TAGLINES[
    Math.floor(Math.random() * INCOGNITO_TAGLINES.length)
  ];
}
