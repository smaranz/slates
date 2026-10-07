"use client";

import { useSyncExternalStore } from "react";

import { isSuggestionIcon, type Suggestion } from "@whirl/lib/suggestions";

/* The batch itself lives in Convex (see convex/homeSuggestions.ts). What is
   left here is a paint cache and nothing more — the two prompts last shown, so
   a returning user sees their cards on the first frame instead of a pair of
   shimmering placeholders while the query resolves. It is never consulted to
   decide whether a generation is needed; that call belongs to the server,
   which is the whole reason the state lives there.

   v4 drops the user id out of the key, and that is the entire point of the
   version bump: Clerk needs a network beat before it can say who is asking, so
   a key that needed the id could only ever be read a beat after the frame it
   was meant to paint — which made the cache dead weight and put "One sec..."
   on screen every single visit. The owner rides inside the payload instead:
   read it immediately, paint it, and drop it once Clerk answers if it turns
   out to belong to whoever was signed in last. */
const CACHE_KEY = "home-suggestions:v4";
const VISIBLE_COUNT = 2;

export type SuggestionSnapshot = {
  /** Whose cards these are — checked once Clerk knows who is looking. */
  userId: string;
  suggestions: Suggestion[];
};

function isSuggestion(value: unknown): value is Suggestion {
  if (!value || typeof value !== "object") return false;
  const { prompt, icon } = value as { prompt?: unknown; icon?: unknown };
  return (
    typeof prompt === "string" &&
    prompt.trim().length > 0 &&
    typeof icon === "string" &&
    isSuggestionIcon(icon)
  );
}

function readStorage(): SuggestionSnapshot | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const { userId, suggestions } = parsed as {
      userId?: unknown;
      suggestions?: unknown;
    };
    if (typeof userId !== "string" || !Array.isArray(suggestions)) return null;

    const cards = suggestions
      .filter(isSuggestion)
      .map(({ prompt, icon }) => ({ prompt, icon }));
    return cards.length === VISIBLE_COUNT
      ? { userId, suggestions: cards }
      : null;
  } catch {
    return null;
  }
}

/* Memoized, because `useSyncExternalStore` compares snapshots by identity:
   parsing storage on every render would hand back a new object every time and
   never settle. `undefined` means nobody has looked yet. */
let cached: SuggestionSnapshot | null | undefined;
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function snapshot(): SuggestionSnapshot | null {
  if (cached === undefined) cached = readStorage();
  return cached;
}

/**
 * The cards this browser last painted.
 *
 * `undefined` until the store has been read — which is to say on the server
 * and through the hydration render, since those two have to agree and the
 * server cannot know what is in this browser. React re-renders with the real
 * value before the first paint, so the capsules still come up filled; the one
 * frame in between shows an empty silhouette rather than a placeholder that
 * would have to be taken straight back.
 */
export function useSuggestionSnapshot() {
  return useSyncExternalStore(subscribe, snapshot, () => undefined);
}

function sameCards(a: Suggestion[], b: Suggestion[]) {
  return (
    a.length === b.length &&
    a.every(
      (card, at) => card.prompt === b[at]?.prompt && card.icon === b[at]?.icon,
    )
  );
}

export function writeSuggestionSnapshot(
  userId: string,
  suggestions: Suggestion[],
) {
  if (
    suggestions.length !== VISIBLE_COUNT ||
    !suggestions.every(isSuggestion)
  ) {
    return;
  }
  /* Convex hands out fresh identities on every update, so this runs again for
     pairs that haven't actually changed. Bail before touching storage or
     waking a single subscriber. */
  if (
    cached &&
    cached.userId === userId &&
    sameCards(cached.suggestions, suggestions)
  ) {
    return;
  }

  cached = { userId, suggestions };
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
  } catch {
    // Suggestions still work when storage is unavailable or full.
  }
  for (const listener of listeners) listener();
}
