"use client";

import { useSyncExternalStore } from "react";

/* Which locked threads are open right now, and with what key.

   Memory only — deliberately. A content key in localStorage would be a
   password written on the underside of the keyboard: the whole point is
   that closing the tab closes the chat. A reload asks again.

   The map is module-level (same shape as lib/toasts.ts and lib/incognito.ts)
   so a settings round trip or a thread hop can't drop a key the user just
   typed a password for. Whirl tabs live for hours, so it evicts on three
   different clocks: idle threads time out, signing out empties it, and a
   deleted thread is forgotten on the spot. The sweep only runs while
   something is actually held. */

type OpenThread = { key: CryptoKey; touchedAt: number };

/* Everything this tab has opened, keyed by the envelope that produced it.
   Ciphertext is unique per seal (a fresh IV every time), so an entry can
   never go stale — editing or renaming mints a new envelope, and the old one
   is simply never asked for again.

   It lives here rather than beside its readers because locking up has to
   mean it: dropping a key without dropping what that key decrypted would
   leave the conversation in memory with nothing guarding it. Both are the
   same act, so they're in the same place. Blunt on purpose — re-locking one
   thread clears every thread's, which costs a re-decrypt and nothing else. */
const PLAINTEXT_LIMIT = 2_000;
const plaintext = new Map<string, string>();

/** What an envelope opened to, if this tab has already opened it. */
export function readPlaintext(envelope: string): string | undefined {
  return plaintext.get(envelope);
}

export function rememberPlaintext(envelope: string, opened: string) {
  if (plaintext.size >= PLAINTEXT_LIMIT) plaintext.clear();
  plaintext.set(envelope, opened);
}

/** How long an unlocked thread stays open with nobody looking at it. Long
 *  enough to survive a lunch break, short enough that an abandoned laptop
 *  isn't an open chat by dinner. */
const AUTO_LOCK_MS = 30 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

const keyring = new Map<string, OpenThread>();
const listeners = new Set<() => void>();

/* The subscribable value is a plain set of ids: components re-render when
   a thread opens or closes, never when a key is merely touched. */
let openIds: ReadonlySet<string> = new Set();
const NONE: ReadonlySet<string> = new Set();

let sweepTimer: ReturnType<typeof setInterval> | null = null;

function publish() {
  openIds = new Set(keyring.keys());
  for (const listener of listeners) listener();
}

function stopSweeping() {
  if (sweepTimer === null) return;
  clearInterval(sweepTimer);
  sweepTimer = null;
}

function sweep() {
  const cutoff = Date.now() - AUTO_LOCK_MS;
  let dropped = false;
  for (const [threadId, entry] of keyring) {
    if (entry.touchedAt > cutoff) continue;
    keyring.delete(threadId);
    dropped = true;
  }
  if (keyring.size === 0) stopSweeping();
  if (dropped) {
    plaintext.clear();
    publish();
  }
}

function startSweeping() {
  if (sweepTimer !== null || typeof window === "undefined") return;
  sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
}

/** Hold a thread's content key for this session. */
export function holdKey(threadId: string, key: CryptoKey) {
  keyring.set(threadId, { key, touchedAt: Date.now() });
  startSweeping();
  publish();
}

/** The key for a thread, if it's open. Reading it counts as activity, so a
 *  thread being actively used never times out underneath the user. */
export function readKey(threadId: string): CryptoKey | null {
  const entry = keyring.get(threadId);
  if (!entry) return null;
  entry.touchedAt = Date.now();
  return entry.key;
}

/** Lock one thread back up, and forget what its key had opened. */
export function forgetKey(threadId: string) {
  if (!keyring.delete(threadId)) return;
  if (keyring.size === 0) stopSweeping();
  plaintext.clear();
  publish();
}

/** Lock everything — signing out, or the user asking for it outright. */
export function forgetAllKeys() {
  plaintext.clear();
  if (keyring.size === 0) return;
  keyring.clear();
  stopSweeping();
  publish();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The ids of every thread open in this session. */
export function useOpenThreadIds(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribe,
    () => openIds,
    () => NONE,
  );
}

/** Whether one thread is open. Subscribes to the set, so it re-renders on
 *  an unlock or an auto-lock and on nothing else. */
export function useIsThreadOpen(threadId: string | null | undefined): boolean {
  return useOpenThreadIds().has(threadId ?? "");
}
