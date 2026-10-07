"use client";

import type { SuggestionSlot } from "@whirl/lib/suggestions";
import { CAPSULE_SURFACE, SuggestionCard } from "./suggestion-card";

/* Conversation starters under the home composer. Two capsules, side by side
   on anything wider than a phone — the cards themselves live in
   suggestion-card.tsx.

   No entrance animation: they paint with the rest of home in one frame. A
   per-card cascade here read as pop-in. */
export function SuggestionCards({
  suggestions,
  onPick,
  onDismiss,
}: {
  /** Null until the paint cache has been read — see the silhouette below. */
  suggestions: SuggestionSlot[] | null;
  onPick: (prompt: string) => void;
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="grid items-start gap-3 sm:grid-cols-2">
      {suggestions === null
        ? /* The server's HTML can't know what this browser last saw, so the
             frame before hydration shows the capsules empty rather than
             guessing. Same geometry, so filling them in moves nothing —
             where a placeholder label would have had to be taken back. */
          [0, 1].map((slot) => (
            <div key={slot} className={`h-9 ${CAPSULE_SURFACE}`} />
          ))
        : suggestions.map((suggestion) => (
            <SuggestionCard
              key={suggestion.id}
              id={suggestion.id}
              prompt={suggestion.prompt}
              icon={suggestion.icon}
              loading={suggestion.loading}
              onPick={onPick}
              onDismiss={onDismiss}
            />
          ))}
    </div>
  );
}
