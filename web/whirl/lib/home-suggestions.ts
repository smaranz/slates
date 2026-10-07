"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUser } from "@whirl/backend/auth";
import { api } from "@whirl/backend/convex/_generated/api";
import { useAction, useConvexAuth, useMutation, useQuery } from "@whirl/backend/react";

import {
  useSuggestionSnapshot,
  writeSuggestionSnapshot,
} from "@whirl/lib/suggestion-cache";
import {
  isSuggestionIcon,
  pickFallbacks,
  type Suggestion,
  type SuggestionSlot,
} from "@whirl/lib/suggestions";
import { showToast } from "@whirl/lib/toasts";

/** Cards under the composer. */
export const VISIBLE_COUNT = 2;
const LOADING_PROMPT = "One sec...";
/** Give up after this many failed attempts rather than retrying on a loop. */
const MAX_ATTEMPTS = 2;

export const INITIAL_SUGGESTIONS: SuggestionSlot[] = Array.from(
  { length: VISIBLE_COUNT },
  (_, index) => ({
    id: `suggestion-${index}`,
    prompt: LOADING_PROMPT,
    icon: "sparkles",
    loading: true,
  }),
);

type StoredSuggestion = { prompt: string; icon: string };

/** Server rows carry `icon` as a plain string; only keys this app has a glyph
 * for survive the crossing. */
function toSuggestion(value: StoredSuggestion): Suggestion | null {
  return isSuggestionIcon(value.icon)
    ? { prompt: value.prompt, icon: value.icon }
    : null;
}

function toSlots(
  suggestions: (Suggestion | null)[],
  pendingSlot: number | null,
): SuggestionSlot[] {
  return INITIAL_SUGGESTIONS.map((slot, index) => {
    const suggestion = suggestions[index];
    if (!suggestion || pendingSlot === index) return slot;
    return { ...slot, ...suggestion, loading: false };
  });
}

/** Owns the two home suggestions.
 *
 * The batch itself lives in Convex (convex/homeSuggestions.ts) — including the
 * reserve behind the cards and the record of what has been dismissed — because
 * that state decides when a user pays for a generation. A cleared browser
 * cache must not be able to bill someone for suggestions they already have, so
 * localStorage here is strictly a way to paint the first frame. */
export function useHomeSuggestions(enabled: boolean) {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const { user } = useUser();
  const userId = user?.id ?? null;
  const active = enabled && isAuthenticated && Boolean(userId);
  /* Signed out there is no batch to read, nothing to personalize from and
     nobody to bill, so the cards settle on a local draw of standbys instead of
     shimmering at a query that is never going to run. */
  const signedOut = enabled && !authLoading && !isAuthenticated;

  const stored = useQuery(api.homeSuggestions.get, active ? {} : "skip");
  const replenish = useAction(api.homeSuggestions.replenish);
  /* Optimistic: the replacement is already in the reserve the client can see,
     so the card morphs into it on click rather than after a round trip. */
  const dismissCard = useMutation(
    api.homeSuggestions.dismiss,
  ).withOptimisticUpdate((localStore, { slot }) => {
    const current = localStore.getQuery(api.homeSuggestions.get, {});
    if (!current || !current.visible[slot]) return;
    const [next, ...rest] = current.reserve;
    localStore.setQuery(
      api.homeSuggestions.get,
      {},
      next
        ? {
            ...current,
            visible: current.visible.map((suggestion: unknown, at: number) =>
              at === slot ? next : suggestion,
            ),
            reserve: rest,
          }
        : { ...current, pendingSlot: slot },
    );
  });

  /* The paint cache: a returning user's cards are simply there while the query
     resolves behind them, so the loading state never reaches the screen.
     `undefined` is the frame before it has been read — see the hook. */
  const snapshot = useSuggestionSnapshot();
  /* Held only until Clerk can vouch for it. Cards cached by whoever was signed
     in last belong to them, so they last exactly as long as it takes to find
     out this is somebody else — or nobody. The gap is the point: for the one
     beat Clerk needs, a returning user is far likelier to be themselves than
     not, and that beat is the whole first paint. */
  const painted =
    !signedOut && snapshot && (!userId || snapshot.userId === userId)
      ? snapshot.suggestions
      : null;

  const attemptsRef = useRef(0);
  const requestedRef = useRef<string | null>(null);
  /* Drawn once per visit so a signed-out or failed home screen doesn't
     reshuffle under the user — it only changes when they dismiss a card. */
  const [offline, setOffline] = useState(() => pickFallbacks(VISIBLE_COUNT));

  /* Identifies the gap the server is being asked to fill. It changes the
     moment the gap does, which is what lets a failure expire on its own
     instead of needing to be cleared. */
  const gap =
    stored &&
    (stored.visible.length < VISIBLE_COUNT || stored.pendingSlot !== null)
      ? `${userId}:${stored.visible.length}:${stored.pendingSlot}`
      : null;
  const [failedGap, setFailedGap] = useState<string | null>(null);
  const failed = gap !== null && failedGap === gap;

  const suggestions = useMemo(() => {
    /* Nothing honest to show yet — SuggestionCards holds the silhouette. */
    if (snapshot === undefined) return null;
    if (!stored || stored.visible.length === 0) {
      const shown = painted ?? (failed || signedOut ? offline : null);
      return shown ? toSlots(shown, null) : INITIAL_SUGGESTIONS;
    }
    /* A failed replenish drops the pending state locally: the card the user
       tried to dismiss is still stored, so it comes back rather than
       shimmering forever. The server keeps the request and retries later. */
    return toSlots(
      stored.visible.map(toSuggestion),
      failed ? null : stored.pendingSlot,
    );
  }, [failed, offline, painted, signedOut, snapshot, stored]);

  /* Keep the paint cache in step with the server, but only with a settled
     pair — half a batch would paint a card the next visit has to take back. */
  useEffect(() => {
    if (!userId || !stored || stored.pendingSlot !== null) return;
    const visible = (stored.visible as Parameters<typeof toSuggestion>[0][])
      .map(toSuggestion)
      .filter((suggestion): suggestion is Suggestion => suggestion !== null);
    if (visible.length === VISIBLE_COUNT) {
      writeSuggestionSnapshot(userId, visible);
    }
  }, [stored, userId]);

  /* Ask the server to fill whatever it says is missing. It decides whether
     that costs anything, and holds a lease while it does, so calling this on
     every visit is safe and a second tab is a no-op. */
  useEffect(() => {
    if (!active || gap === null) {
      /* Cleared, not just reset: the same gap can open again later (dismiss
         card 0 twice with an empty reserve), and a stale mark would swallow
         the second request. */
      attemptsRef.current = 0;
      requestedRef.current = null;
      return;
    }

    /* One request per distinct gap, so a re-render can't re-ask and a failed
       attempt can't spin. */
    if (requestedRef.current === gap) return;
    if (attemptsRef.current >= MAX_ATTEMPTS) return;
    requestedRef.current = gap;
    attemptsRef.current += 1;

    void replenish().catch(() => {
      setFailedGap(gap);
      showToast("Couldn't refresh your suggestions. Try again in a bit?");
    });
  }, [active, gap, replenish]);

  const dismiss = useCallback(
    async (id: string) => {
      if (!suggestions) return;
      const slot = suggestions.findIndex((suggestion) => suggestion.id === id);
      if (slot < 0 || suggestions[slot]?.loading) return;
      /* One replacement at a time: an empty reserve means the server is
         holding a single pending slot, and a second dismissal would take that
         slot over and strand the first card shimmering for good. */
      if (suggestions.some((suggestion) => suggestion.loading)) {
        showToast("Still finding the last one — give it a sec.");
        return;
      }
      /* Nothing to dismiss server-side without an account: swap in another
         standby, preferring one the visitor hasn't been shown yet. */
      if (signedOut) {
        setOffline((current) => {
          const [next] = pickFallbacks(
            1,
            current.map((suggestion) => suggestion.prompt),
          );
          return next
            ? current.map((suggestion, at) => (at === slot ? next : suggestion))
            : current;
        });
        return;
      }
      /* A fresh ask deserves a fresh verdict: whatever failed last time
         shouldn't suppress this dismissal's loading state. */
      setFailedGap(null);
      try {
        await dismissCard({ slot });
      } catch {
        showToast("Couldn't dismiss that one. Try again?");
      }
    },
    [dismissCard, signedOut, suggestions],
  );

  return { suggestions, dismiss };
}
