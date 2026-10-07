"use client";

import { useEffect, useState } from "react";

import {
  PAID_PLAN_IDS,
  readUsageSummary,
  type CustomerLike,
  type PlanId,
} from "@whirl/lib/plan";

/* Autumn answers noticeably later than Clerk, so the plan badge used to pop
   in after the rest of the user row. Cache the last known plan per user in
   localStorage: repeat visits paint it immediately and the live answer
   replaces it silently (it almost always matches). */

export type PlanSummary = { planId: PlanId | null; planName: string };

const cacheKey = (userId: string) => `plan-summary:${userId}`;

function readPlanCache(userId: string): PlanSummary | null {
  try {
    const raw = localStorage.getItem(cacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PlanSummary>;
    const planId =
      parsed.planId != null &&
      (PAID_PLAN_IDS as readonly string[]).includes(parsed.planId)
        ? (parsed.planId as PlanId)
        : null;
    if (typeof parsed.planName !== "string") return null;
    return { planId, planName: parsed.planName };
  } catch {
    return null;
  }
}

/**
 * Last known plan for `userId`, or null while it's still unknown (first
 * visit, Autumn pending). Resolution order: live Autumn answer, then the
 * cache, then "Free" once Autumn has genuinely finished without a
 * customer. `customerUnsettled` must cover errors as well as loading —
 * a failed fetch (the pre-auth window on reload) means UNKNOWN, not
 * "Free": claiming Free here once tricked the model picker into
 * downgrading a paid user's stored pick on every reload.
 */
export function useCachedPlan(
  userId: string | undefined,
  customer: CustomerLike,
  customerUnsettled: boolean,
): PlanSummary | null {
  const [cached, setCached] = useState<PlanSummary | null>(null);

  /* In an effect (not lazy state) so SSR/hydration never touch storage. */
  useEffect(() => {
    setCached(userId ? readPlanCache(userId) : null);
  }, [userId]);

  useEffect(() => {
    if (!userId || !customer) return;
    const { planId, planName } = readUsageSummary(customer);
    try {
      localStorage.setItem(
        cacheKey(userId),
        JSON.stringify({ planId, planName } satisfies PlanSummary),
      );
    } catch {
      // private mode etc. — next visit just loads the slow way
    }
  }, [userId, customer]);

  if (customer) {
    const { planId, planName } = readUsageSummary(customer);
    return { planId, planName };
  }
  if (cached) return cached;
  if (!customerUnsettled) return { planId: null, planName: "Free" };
  return null;
}
