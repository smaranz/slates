"use client";

import { useEffect, useState } from "react";
import { useConvex, useConvexAuth } from "@whirl/backend/react";

import { useRunningThreadIds, useThreads } from "@whirl/lib/threads";
import { isThreadWarm, warmThread } from "@whirl/lib/thread-warm";

/* Warms the latest threads behind the scenes: a beat after load it reads
   their transcripts once and fills the localStorage cache, so opening one
   paints real messages on the first frame instead of a spinner. Renders
   nothing. The reading and the bookkeeping both live in lib/thread-warm.ts,
   which the sidebar rows share for hover warming.

   Sequential rather than parallel, for the same reason the delay exists:
   this is background work, and it must never be what the open thread is
   queued behind. */

const PREFETCH_COUNT = 20;
/* Let the first paint and the visible thread win the connection first. */
const IDLE_DELAY_MS = 1500;

export function ThreadPrefetcher() {
  const { isAuthenticated } = useConvexAuth();
  const threads = useThreads(isAuthenticated);
  const runningIds = useRunningThreadIds(isAuthenticated);
  const convex = useConvex();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setReady(true), IDLE_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!ready || !isAuthenticated || !threads) return;

    const pending = threads
      .slice(0, PREFETCH_COUNT)
      /* A thread mid-reply has nothing worth caching yet, and its updatedAt
         moves with every chunk — reading it here would be a fresh query per
         streamed beat. It gets warmed once it settles. */
      .filter((thread) => !runningIds.has(thread.id))
      /* A locked thread's rows are ciphertext, and its transcript is opened
         in memory rather than read from the cache — warming one would spend
         bandwidth on something nothing ever paints. */
      .filter((thread) => !thread.locked)
      .filter((thread) => !isThreadWarm(thread.id, thread.updatedAt));
    if (pending.length === 0) return;

    let cancelled = false;
    void (async () => {
      for (const thread of pending) {
        if (cancelled) return;
        await warmThread(convex, thread.id, thread.updatedAt);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, isAuthenticated, threads, runningIds, convex]);

  return null;
}
