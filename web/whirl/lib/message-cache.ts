"use client";

import { useLayoutEffect, useState } from "react";

import { isTerminal, type ChatMessage } from "./messages";

/* Last-known messages per thread (localStorage): visited threads — plus
   the latest ones the prefetcher warms — paint their transcript on the
   first frame while the live query catches up in the background. Only
   settled replies are stored (a half-streamed one must not resurrect),
   and an LRU index keeps the total footprint bounded. */

const KEY_PREFIX = "thread-messages:";
const INDEX_KEY = "thread-messages:index";
const MAX_CACHED_THREADS = 30;
const MAX_MESSAGES_PER_THREAD = 60;
/* Threads whose tail alone serializes past this stay uncached — better a
   spinner than a localStorage quota war. */
const MAX_BYTES_PER_THREAD = 300_000;

const cacheKey = (threadId: string) => `${KEY_PREFIX}${threadId}`;

function readIndex(): string[] {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(INDEX_KEY) ?? "[]",
    );
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/* Most-recently-written first; evicted tails take their payload with them. */
function touchIndex(threadId: string) {
  const index = [threadId, ...readIndex().filter((id) => id !== threadId)];
  for (const evicted of index.splice(MAX_CACHED_THREADS)) {
    try {
      window.localStorage.removeItem(cacheKey(evicted));
    } catch {
      /* best effort */
    }
  }
  try {
    window.localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    /* best effort */
  }
}

export function readThreadMessageCache(threadId: string): ChatMessage[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(cacheKey(threadId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ChatMessage[]) : null;
  } catch {
    return null;
  }
}

export function writeThreadMessageCache(
  threadId: string,
  messages: ChatMessage[],
) {
  if (typeof window === "undefined") return;
  /* Settled rows only, capped to the tail; extracted attachment text is
     dropped — it's model context, never rendered, and it's the one field
     that balloons (whole pasted documents). */
  const settled = messages
    .filter((message) => isTerminal(message.status))
    .slice(-MAX_MESSAGES_PER_THREAD)
    .map((message) => ({
      ...message,
      attachments: message.attachments?.map(({ text: _text, ...rest }) => rest),
    }));
  const payload = JSON.stringify(settled);
  if (payload.length > MAX_BYTES_PER_THREAD) return;
  try {
    window.localStorage.setItem(cacheKey(threadId), payload);
    touchIndex(threadId);
  } catch {
    /* Quota or private mode — drop everything cached and try once more,
       so one bloated era can't wedge the cache forever. */
    try {
      for (const id of readIndex()) {
        window.localStorage.removeItem(cacheKey(id));
      }
      window.localStorage.removeItem(INDEX_KEY);
      window.localStorage.setItem(cacheKey(threadId), payload);
      touchIndex(threadId);
    } catch {
      /* best effort */
    }
  }
}

/**
 * Drop a thread's cached transcript. Locking a chat calls this: the cache
 * holds the conversation as it was *before* the lock, in the clear, and
 * that snapshot must not outlive the moment the thread was sealed.
 */
export function clearThreadMessageCache(threadId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(cacheKey(threadId));
    window.localStorage.setItem(
      INDEX_KEY,
      JSON.stringify(readIndex().filter((id) => id !== threadId)),
    );
  } catch {
    /* best effort */
  }
}

/**
 * The cached transcript for a thread, read pre-paint (client-only, so SSR
 * and hydration agree). Callers remount per thread (the transcript is
 * keyed on threadId), so one read per visit.
 */
export function useCachedThreadMessages(
  threadId: string | undefined,
): ChatMessage[] | null {
  const [cached, setCached] = useState<ChatMessage[] | null>(null);
  useLayoutEffect(() => {
    setCached(threadId ? readThreadMessageCache(threadId) : null);
  }, [threadId]);
  return cached;
}
