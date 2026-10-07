"use client";

import { useCallback, useSyncExternalStore } from "react";

import { DEFAULT_MODEL_KEY, FREE_MODEL_KEY } from "@whirl/lib/models";

/* The composer's model, remembered across visits. The stored value is a
   tier key or a catalog slug (lib/model-catalog.ts) — kept as-is even if a
   catalog model has since been removed; the composer already falls back to
   the first entry when a key doesn't resolve. It rides a tiny external
   store (mirrors lib/composer-gates.ts) so the marketing composer, the
   chat composer and the command palette all see a pick the same frame,
   and so the remembered model paints on the first client frame instead of
   flashing the default.

   Not every write is a choice, though: opening a thread adopts whatever
   model answered it, and the picker corrects itself once the plan
   resolves. Only a pick made in the picker counts. Those arranged writes
   still dress the composer for the visit, but they never overwrite a pick
   in storage, and on their own they read back as Auto — so a user who
   never touched the picker always finds Auto waiting, and one who did
   finds what they chose. The free tier is the exception to the reset:
   it's all a free plan can reach, so it stays put rather than bouncing off
   a locked Auto on every load. */

const KEY = "composer-model";
const EXPLICIT_KEY = "composer-model-explicit";
const CHANGE_EVENT = "whirl:composer-model";

/** How a write got here — a pick in the picker, or the app arranging
 *  things on the user's behalf. Only the former sticks. */
export type ModelPickOptions = {
  /** Defaults to true: a bare `setModel(key)` is the user's own pick. */
  explicit?: boolean;
};

export type SetModelPref = (next: string, options?: ModelPickOptions) => void;

let cached: string | null = null;

function read(): string {
  try {
    const stored = localStorage.getItem(KEY);
    if (!stored) return DEFAULT_MODEL_KEY;
    if (localStorage.getItem(EXPLICIT_KEY) === "1") return stored;
    return stored === FREE_MODEL_KEY ? stored : DEFAULT_MODEL_KEY;
  } catch {
    // private mode etc. — the default stands for this visit
    return DEFAULT_MODEL_KEY;
  }
}

function snapshot(): string {
  if (cached === null) cached = read();
  return cached;
}

function serverSnapshot(): string {
  return DEFAULT_MODEL_KEY;
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY && event.key !== EXPLICIT_KEY) return;
    cached = null;
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useModelPref() {
  const model = useSyncExternalStore(subscribe, snapshot, serverSnapshot);

  const set = useCallback<SetModelPref>((next, options) => {
    const arranged = options?.explicit === false;
    cached = next;
    try {
      /* An arranged model rides this visit but never overwrites a pick —
         otherwise picking Heavy and sending would un-pick it the moment
         the reply came back wearing the model you just chose. With nothing
         picked there's nothing to protect, so it persists unmarked and
         reads back as Auto (or stays put, if it's the free tier). */
      if (!arranged || localStorage.getItem(EXPLICIT_KEY) !== "1") {
        localStorage.setItem(KEY, next);
        localStorage.setItem(EXPLICIT_KEY, arranged ? "0" : "1");
      }
    } catch {
      // private mode etc. — the pick still applies for this visit
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return [model, set] as const;
}
