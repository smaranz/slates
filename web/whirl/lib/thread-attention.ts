"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

/* Threads whose reply finished while you were looking somewhere else.

   The sidebar spins beside a thread with a turn in flight
   (useRunningThreadIds). When that spinner would simply vanish — because
   the reply landed while another thread, or home, was up — the row keeps
   a tick instead, until the thread is opened. Nothing on the server knows
   what you were looking at, so this is watched here: the running set is
   diffed as it changes, and the answer is kept in localStorage so a reload
   doesn't forget which replies are still unread.

   A module-level store (like lib/composer-draft.ts): one set, however many
   rows read it. Capped so it can't grow for the life of the tab — a thread
   deleted mid-turn leaves an id behind that nothing will ever clear. */

const STORAGE_KEY = "thread-list:finished";
const MAX_TRACKED = 50;

const EMPTY: ReadonlySet<string> = new Set();
let finished: ReadonlySet<string> = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      finished = new Set(
        parsed.filter((id): id is string => typeof id === "string"),
      );
    }
  } catch {
    /* Storage unavailable or junk — start empty. */
  }
}

function commit(next: Set<string>) {
  finished = next;
  for (const listener of listeners) listener();
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    /* A tick that doesn't survive a reload is still a tick. */
  }
}

export function markThreadFinished(threadId: string) {
  load();
  if (finished.has(threadId)) return;
  const next = new Set(finished);
  next.add(threadId);
  /* Insertion order is age: the oldest ticks are the ones to forget. */
  while (next.size > MAX_TRACKED) {
    const oldest = next.values().next().value;
    if (oldest === undefined) break;
    next.delete(oldest);
  }
  commit(next);
}

export function clearThreadFinished(threadId: string) {
  load();
  if (!finished.has(threadId)) return;
  const next = new Set(finished);
  next.delete(threadId);
  commit(next);
}

function subscribe(listener: () => void) {
  load();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot() {
  load();
  return finished;
}

/** The threads wearing a tick. Empty during SSR. */
export function useFinishedThreadIds(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}

/**
 * Watches the running set. A thread that leaves it while another view is
 * up gets its tick; a fresh turn starting there takes it back (the spinner
 * outranks it anyway); opening the thread clears it.
 *
 * `ready` is the subscription being live. The first answer after it comes
 * up is a baseline, not a change — nothing "finished" against an empty
 * set from before we were listening.
 */
export function useTrackFinishedThreads(
  runningIds: ReadonlySet<string>,
  activeThreadId: string | null,
  ready: boolean,
) {
  const previousRef = useRef<ReadonlySet<string> | null>(null);

  /* A navigation re-runs this too, and finds the set unchanged against
     itself — so the active thread is simply read fresh, not tracked. */
  useEffect(() => {
    if (!ready) {
      previousRef.current = null;
      return;
    }
    const previous = previousRef.current;
    previousRef.current = runningIds;
    for (const id of runningIds) clearThreadFinished(id);
    if (!previous) return;
    for (const id of previous) {
      if (!runningIds.has(id) && id !== activeThreadId) {
        markThreadFinished(id);
      }
    }
  }, [runningIds, activeThreadId, ready]);

  useEffect(() => {
    if (activeThreadId) clearThreadFinished(activeThreadId);
  }, [activeThreadId]);
}
