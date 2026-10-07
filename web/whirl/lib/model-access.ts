"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useUser } from "@whirl/backend/auth";
import { useCustomer } from "@whirl/backend/billing";
import { useConvexAuth, useQuery } from "@whirl/backend/react";

import { api } from "@whirl/backend/convex/_generated/api";
import { useDeploymentFeatures } from "@whirl/lib/deployment-features";
import { isCustomModelKey } from "@whirl/lib/models";
import { useCachedPlan } from "@whirl/lib/plan-cache";

/* Who may use which model, for the composer's picker. The restriction list
   comes from the console's Models tab (which preset tiers are paid-only);
   the plan comes from Autumn via the same cached-plan trick the user row
   uses. Both are cache-then-replace, so locks paint instantly and
   correctly on repeat visits. */

const CACHE_KEY = "tier-access";

/* Mirrors DEFAULT_RESTRICTED_TIERS in convex/models.ts — the answer before
   the first visit's live read lands. */
const DEFAULT_RESTRICTED = ["Auto", "Basic", "Max", "Image"];

function readAccessCache(): string[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return DEFAULT_RESTRICTED;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_RESTRICTED;
    return parsed.filter((tier): tier is string => typeof tier === "string");
  } catch {
    return DEFAULT_RESTRICTED;
  }
}

export type ModelAccess = {
  /** null while the plan is genuinely unknown (first visit, Autumn still
   *  answering) — show no locks rather than flashing them at a paid user. */
  isPaid: boolean | null;
  /** Whether this model key is off-limits on the current plan. */
  locked: (key: string) => boolean;
};

export function useModelAccess(): ModelAccess {
  const { user } = useUser();
  const { isAuthenticated } = useConvexAuth();
  const imageUntil = useQuery(
    api.slots.imageAccess,
    isAuthenticated ? {} : "skip",
  );
  const [expiredImageUntil, setExpiredImageUntil] = useState<number | null>(
    null,
  );
  const imagePass = imageUntil != null && imageUntil !== expiredImageUntil;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      const remaining = (imageUntil ?? 0) - Date.now();
      if (remaining > 0)
        timer = setTimeout(update, Math.min(remaining, 2_147_483_647));
      else setExpiredImageUntil(imageUntil ?? null);
    };
    const frame = requestAnimationFrame(update);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [imageUntil]);
  const { customer, isLoading: customerLoading, error } = useCustomer();
  /* An errored fetch (the pre-auth window on reload) is "unsettled", not
     "free" — a false Free reading here downgrades the picker's stored
     model out from under the user. */
  const plan = useCachedPlan(
    user?.id,
    customer,
    customerLoading || error != null,
  );

  const [cachedRestricted, setCachedRestricted] =
    useState<string[]>(DEFAULT_RESTRICTED);

  /* Read a frame after mount so SSR and hydration never touch storage —
     mirrors lib/name-cache.ts. */
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setCachedRestricted(readAccessCache());
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const live = useQuery(api.models.tierAccess);

  useEffect(() => {
    if (!live) return;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(live.restrictedTiers));
    } catch {
      // private mode etc. — next visit just loads the slow way
    }
  }, [live]);

  const restricted = useMemo(
    () => new Set(live ? live.restrictedTiers : cachedRestricted),
    [live, cachedRestricted],
  );

  /* A deployment without billing has no plans to sell — everyone gets
     everything, the same way the server treats them. */
  const { billing } = useDeploymentFeatures();
  const isPaid = !billing ? true : plan ? plan.planId !== null : null;

  /* Free users get exactly the unrestricted tiers; admin catalog models
     are a paid perk wholesale. Paid (and unknown) plans see no locks —
     the server re-checks everything anyway. */
  const locked = useCallback(
    (key: string): boolean =>
      isPaid === false &&
      // Wait for the pass query before downgrading a persisted Image selection.
      !(
        key === "Image" &&
        (imagePass || (isAuthenticated && imageUntil === undefined))
      ) &&
      (isCustomModelKey(key) || restricted.has(key)),
    [isPaid, restricted, imagePass, isAuthenticated, imageUntil],
  );

  return { isPaid, locked };
}
