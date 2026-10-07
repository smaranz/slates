"use client";

/* Deferred, de-duplicated localStorage writes.

   `setItem` is synchronous and goes to disk, and the caches in front of it
   are fed by Convex subscriptions that push far more often than their
   contents change — the thread listing re-sends on every push, and a reply
   landing its phases pushes several times a second. Serializing the whole
   list and blocking the main thread on each of those is a real stutter,
   and it grows with how much history you have.

   So the work itself waits for an idle moment, a burst of pushes collapses
   into one write, and an unchanged payload never reaches storage at all.
   Callers hand over a thunk rather than a value: building the snapshot is
   the expensive half, and it should happen once per idle beat, not once
   per push. */

/* Keyed by storage key, which is a small fixed set (one per cache, one per
   signed-in user). Capped anyway so a caller that starts minting keys per
   thread can't quietly grow this for the life of the tab — dropping the
   memo costs one redundant write, nothing more. */
const MAX_TRACKED_KEYS = 32;
const lastWritten = new Map<string, string>();
const pending = new Map<string, () => unknown>();

let scheduled = false;

function whenIdle(run: () => void) {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(run, { timeout: 2_000 });
    return;
  }
  window.setTimeout(run, 200);
}

function flush() {
  scheduled = false;
  const work = [...pending];
  pending.clear();

  for (const [key, build] of work) {
    let payload: string;
    try {
      payload = JSON.stringify(build());
    } catch {
      /* An unserializable snapshot is a caller bug, never a reason to take
         the interaction down with it. */
      continue;
    }
    if (lastWritten.get(key) === payload) continue;
    try {
      window.localStorage.setItem(key, payload);
      if (lastWritten.size >= MAX_TRACKED_KEYS) lastWritten.clear();
      lastWritten.set(key, payload);
    } catch {
      /* Quota, private mode, storage turned off — the cache is an
         optimization and every reader already copes without it. */
    }
  }
}

/**
 * Cache `build()`'s value under `key` on the next idle beat, unless it
 * serializes to exactly what's already there.
 */
export function writeCacheWhenIdle(key: string, build: () => unknown) {
  if (typeof window === "undefined") return;
  pending.set(key, build);
  if (scheduled) return;
  scheduled = true;
  whenIdle(flush);
}

/** Forget what we believe is stored — after a wipe, or on sign-out. */
export function forgetCachedWrites() {
  lastWritten.clear();
  pending.clear();
}
