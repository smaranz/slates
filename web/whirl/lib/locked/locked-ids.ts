"use client";

import { useLayoutEffect, useState, useSyncExternalStore } from "react";

/* Which threads are locked, remembered across reloads.
 *
 * Whether a thread is locked otherwise only arrives with the sidebar
 * listing, which on a reload lands *after* the transcript has painted — so
 * for a frame the chat face believed it was looking at an ordinary thread
 * and drew the last transcript it had cached, in the clear. A locked chat
 * flashing its contents before the lock catches up is the one thing this
 * feature must never do.
 *
 * So the answer is written down where it can be read before anything else
 * resolves. Just the ids: a set of opaque strings tells an attacker with
 * the disk nothing that the presence of the thread row didn't already, and
 * it is the smallest thing that closes the gap. */

const KEY = "locked-threads";

let ids: ReadonlySet<string> = new Set();
const NONE: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function publish(next: ReadonlySet<string>) {
  ids = next;
  for (const listener of listeners) listener();
}

function persist(next: ReadonlySet<string>) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...next]));
  } catch {
    /* Quota or private mode. The listing still corrects the UI a moment
       later; this only ever bought the first frame. */
  }
}

function read(): ReadonlySet<string> {
  if (typeof window === "undefined") return NONE;
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(KEY) ?? "[]",
    );
    return new Set(
      Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [],
    );
  } catch {
    return NONE;
  }
}

/** Note a thread as locked, the moment it is. */
export function rememberLocked(threadId: string) {
  if (ids.has(threadId)) return;
  const next = new Set(ids).add(threadId);
  persist(next);
  publish(next);
}

/** Forget one — the lock came off, or the thread did. */
export function forgetLocked(threadId: string) {
  if (!ids.has(threadId)) return;
  const next = new Set(ids);
  next.delete(threadId);
  persist(next);
  publish(next);
}

/**
 * Bring the record in line with what the server says. Called with the
 * sidebar listing, so a thread locked (or unlocked, or deleted) on another
 * device converges here on the next load rather than staying wrong.
 */
export function syncLockedIds(
  threads: readonly { id: string; locked?: boolean }[],
) {
  const next = new Set<string>();
  for (const thread of threads) {
    if (thread.locked) next.add(thread.id);
  }
  if (next.size === ids.size && [...next].every((id) => ids.has(id))) return;
  persist(next);
  publish(next);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Every thread the last visit knew to be locked. Same pre-paint hydration
 * as `useKnownLocked`, for callers holding a list rather than one id.
 */
export function useKnownLockedIds(): ReadonlySet<string> {
  const [hydrated, setHydrated] = useState(false);
  useLayoutEffect(() => {
    if (hydrated) return;
    publish(read());
    setHydrated(true);
  }, [hydrated]);

  return useSyncExternalStore(
    subscribe,
    () => ids,
    () => NONE,
  );
}

/**
 * Whether this thread was locked as far as the last visit knew. Read
 * pre-paint (client-only, so SSR and hydration agree) — which is early
 * enough that the locked face is the first thing drawn, not the second.
 *
 * Only worth consulting while the listing is still in flight; once it
 * lands, it is the authority.
 */
export function useKnownLocked(threadId: string | null): boolean {
  const [hydrated, setHydrated] = useState(false);
  useLayoutEffect(() => {
    if (hydrated) return;
    publish(read());
    setHydrated(true);
  }, [hydrated]);

  const current = useSyncExternalStore(
    subscribe,
    () => ids,
    () => NONE,
  );
  return threadId !== null && current.has(threadId);
}
