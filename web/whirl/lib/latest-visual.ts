"use client";

import { useEffect, useId, useSyncExternalStore } from "react";

/* Decides which chat card renders the actual visual for an inline HTML
   artifact. Edits mutate the artifact row in place, so every card pointing
   at it would show the same (latest) content — a thread with follow-ups
   would repeat the visual at every step. Instead each mounted card
   registers here with its position in the thread (message createdAt +
   phase index), and only the furthest-along card for an artifact renders
   the iframe; the earlier ones collapse into compact rows. */

const cardsByArtifact = new Map<string, Map<string, number>>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isLatest(htmlId: string, cardKey: string): boolean {
  const cards = cardsByArtifact.get(htmlId);
  if (!cards || !cards.has(cardKey)) return true;
  const own = cards.get(cardKey)!;
  for (const [key, order] of cards) {
    if (key === cardKey) continue;
    /* Ties (which shouldn't happen — orders encode message + phase index)
       break deterministically on the key so exactly one card wins. */
    if (order > own || (order === own && key > cardKey)) return false;
  }
  return true;
}

/**
 * Whether this card is the furthest-along one showing `htmlId`, given its
 * `order` (any number that increases down the thread). Pass `undefined` for
 * cards that never compete (full pages, working edits without a row yet) —
 * those are always "latest".
 */
export function useIsLatestVisualCard(
  htmlId: string | undefined,
  order: number,
): boolean {
  const cardKey = useId();

  useEffect(() => {
    if (!htmlId) return;
    let cards = cardsByArtifact.get(htmlId);
    if (!cards) {
      cards = new Map();
      cardsByArtifact.set(htmlId, cards);
    }
    cards.set(cardKey, order);
    emit();
    return () => {
      const current = cardsByArtifact.get(htmlId);
      if (!current) return;
      current.delete(cardKey);
      if (current.size === 0) cardsByArtifact.delete(htmlId);
      emit();
    };
  }, [htmlId, cardKey, order]);

  return useSyncExternalStore(
    subscribe,
    () => !htmlId || isLatest(htmlId, cardKey),
    () => true,
  );
}
