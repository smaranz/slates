"use client";

import { useSyncExternalStore } from "react";

/* Which lock dialog is up, and for what.

   The two places that open one are nowhere near each other in the tree — the
   composer's command palette and a sidebar row's ⋯ menu — and neither is a
   sensible owner of a modal that outlives it. So the request is a
   module-level store (the shape lib/toasts.ts and lib/incognito.ts already
   use) and one host near the root renders whatever it names. */

export type LockDialog =
  | {
      kind: "lock";
      /** Absent starts a brand-new locked chat instead of converting one —
       *  which is also what decides whether the intro has to warn about
       *  what locking will strip out. */
      threadId?: string;
    }
  | { kind: "unlock"; threadId: string }
  | { kind: "password"; threadId: string }
  | { kind: "remove"; threadId: string };

let current: LockDialog | null = null;
const listeners = new Set<() => void>();

function set(next: LockDialog | null) {
  current = next;
  for (const listener of listeners) listener();
}

export function requestLock(threadId?: string) {
  set({ kind: "lock", ...(threadId ? { threadId } : {}) });
}

export function requestUnlock(threadId: string) {
  set({ kind: "unlock", threadId });
}

export function requestPasswordChange(threadId: string) {
  set({ kind: "password", threadId });
}

export function requestLockRemoval(threadId: string) {
  set({ kind: "remove", threadId });
}

export function closeLockDialog() {
  if (current !== null) set(null);
}

export function useLockDialog(): LockDialog | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => current,
    () => null,
  );
}
