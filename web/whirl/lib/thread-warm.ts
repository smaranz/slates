"use client";

import type { ConvexReactClient } from "@whirl/backend/react";
import { api } from "@whirl/backend/convex/_generated/api";
import type { Id } from "@whirl/backend/convex/_generated/dataModel";

import { writeThreadMessageCache } from "./message-cache";
import { computeIsGenerating, type ChatMessage } from "./messages";

/* Reading a thread's transcript once and parking it in the localStorage
   cache (lib/message-cache.ts), so opening that thread paints real messages
   on the first frame instead of a spinner.

   Two callers: the background prefetcher, which sweeps the newest threads a
   beat after load, and the sidebar rows, which warm whatever the pointer
   rests on. Anything further down someone's history than the prefetcher
   reaches therefore still opens instantly, as long as they aimed at it
   first — which, for a list you have to scroll to, is nearly always.

   Deliberately one-shot reads. A live `useQuery` per thread would mean a
   permanent subscription to a whole conversation each, re-running on the
   server whenever anything in it changed. */

/* The revision cached per thread — keyed by id and overwritten, so a thread
   that moves on gets read again and one that hasn't is left alone. Capped
   so an enormous library can't grow this for the life of the tab; forgetting
   costs one redundant read. */
const MAX_TRACKED = 400;
const warmed = new Map<string, number>();
const inFlight = new Set<string>();

/* One shared timer for hover intent: sweeping the pointer down the sidebar
   should not fire a query per row it crosses. */
const HOVER_INTENT_MS = 140;
let hoverTimer: ReturnType<typeof setTimeout> | undefined;

/** Whether this revision of the thread is already in the cache. */
export function isThreadWarm(threadId: string, updatedAt: number): boolean {
  return warmed.get(threadId) === updatedAt;
}

/**
 * Read the transcript and cache it, unless this revision is already cached
 * or the same read is already in flight. Resolves either way; nothing on
 * screen depends on it succeeding.
 */
export async function warmThread(
  convex: ConvexReactClient,
  threadId: string,
  updatedAt: number,
): Promise<void> {
  if (isThreadWarm(threadId, updatedAt) || inFlight.has(threadId)) return;
  inFlight.add(threadId);
  try {
    const messages = (await convex.query(api.messages.listForThread, {
      threadId: threadId as Id<"threads">,
    })) as ChatMessage[];
    /* Never snapshot a half-written reply — it would paint as the thread's
       real content on the next cold open. */
    if (computeIsGenerating(messages)) return;
    writeThreadMessageCache(threadId, messages);
    if (warmed.size >= MAX_TRACKED) warmed.clear();
    warmed.set(threadId, updatedAt);
  } catch {
    /* A thread deleted mid-sweep, or a connection that dropped. The next
       hover (or the next listing change) tries again. */
  } finally {
    inFlight.delete(threadId);
  }
}

/** Warm after a beat of hovering — cancelled if the pointer moves on. */
export function warmThreadOnHover(
  convex: ConvexReactClient,
  threadId: string,
  updatedAt: number,
) {
  if (isThreadWarm(threadId, updatedAt)) return;
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => {
    void warmThread(convex, threadId, updatedAt);
  }, HOVER_INTENT_MS);
}

/** The pointer left before the intent timer fired. */
export function cancelHoverWarm() {
  clearTimeout(hoverTimer);
  hoverTimer = undefined;
}
