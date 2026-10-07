"use client";

import { useMemo } from "react";
import { useQuery } from "@whirl/backend/react";
import { api } from "@whirl/backend/convex/_generated/api";
import {
  isClearedForLockedThread,
  NO_LOCKED_MODELS,
  type LockedModelPolicy,
} from "@whirl/backend/convex/lockedPolicy";

import type { ComposerModel } from "../models";

/* Which models a locked chat may run, from the server.
 *
 * The answer comes from OpenRouter's own list of models with zero-retention
 * endpoints (convex/zeroRetention.ts), resolved against whatever slug each
 * tier currently routes to. The turn handler checks the same thing before
 * it spends anything, so this is here to keep a user from picking a model
 * and only finding out after they've typed a message.
 *
 * Closed until it answers. A locked chat that can't yet verify a model's
 * retention refuses to send rather than guessing, so `known` starts false
 * and the composer says why. */

export function useLockedModelPolicy(enabled: boolean): LockedModelPolicy {
  const live = useQuery(api.zeroRetention.lockedModels, enabled ? {} : "skip");
  return live ?? NO_LOCKED_MODELS;
}

/** The subset of the catalog a locked chat can run, in catalog order. */
export function filterLockedModels(
  models: ComposerModel[],
  policy: LockedModelPolicy,
): ComposerModel[] {
  return models.filter((model) => isClearedForLockedThread(model.key, policy));
}

/**
 * Why this model can't send in a locked chat, or null when it can. The
 * composer shows this in place of the send button's tooltip and refuses the
 * send outright — a locked chat must never hand a conversation to a model
 * whose retention we haven't confirmed.
 */
export function lockedSendRejection(
  model: string,
  policy: LockedModelPolicy,
): string | null {
  if (isClearedForLockedThread(model, policy)) return null;
  return policy.known
    ? "This model keeps a copy of what you send it, so a locked chat cannot use it. Pick another model."
    : "Whirl is still checking which models keep no data. One moment.";
}

/** Convenience for callers that only hold the thread's locked flag. */
export function useLockedModels(isLocked: boolean, models: ComposerModel[]) {
  const policy = useLockedModelPolicy(isLocked);
  const allowed = useMemo(
    () => (isLocked ? filterLockedModels(models, policy) : models),
    [isLocked, models, policy],
  );
  return { policy, allowed };
}
