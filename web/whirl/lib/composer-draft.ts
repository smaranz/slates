"use client";

import { useSyncExternalStore } from "react";

/* The chat composer's draft text, as a tiny module-level store (mirrors
   lib/artifact-panel.ts).

   It lives out here so a keystroke re-renders the pill and nothing else.
   Held as React state on the chat face, every character reconciled the
   whole transcript behind the composer (and re-measured the dock's layout
   projection), so typing got slower the longer the conversation ran. The
   writers — suggestion cards, the marketing prefill, quoted selections,
   clearing on send — only ever push text in, so none of them subscribe. */

let draft = "";
const listeners = new Set<() => void>();

export function getComposerDraft(): string {
  return draft;
}

/** Replace the draft, or patch it — the quote writers append to it. */
export function setComposerDraft(
  next: string | ((current: string) => string),
): void {
  const value = typeof next === "function" ? next(draft) : next;
  if (value === draft) return;
  draft = value;
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** Subscribe to the draft — the composer face, and nothing above it. */
export function useComposerDraft(): string {
  return useSyncExternalStore(subscribe, getComposerDraft, getComposerDraft);
}
