"use client";

import { useEffect, useState } from "react";

import {
  PAID_PLAN_IDS,
  readUsageSummary,
  type CustomerLike,
  type PlanId,
  type UsageSummary,
} from "@whirl/lib/plan";

/* Same trick as lib/plan-cache.ts, one level up: the user menu's usage
   meter used to skeleton on every open until Autumn answered. Cache the
   whole last-known summary per user in localStorage — repeat opens paint
   it immediately and the live answer replaces it silently. */

const cacheKey = (userId: string) => `usage-summary:${userId}`;

function readUsageCache(userId: string): UsageSummary | null {
  try {
    const raw = localStorage.getItem(cacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UsageSummary>;
    if (typeof parsed.planName !== "string") return null;
    if (typeof parsed.unlimited !== "boolean") return null;
    if (typeof parsed.remainingPct !== "number") return null;
    const planId =
      parsed.planId != null &&
      (PAID_PLAN_IDS as readonly string[]).includes(parsed.planId)
        ? (parsed.planId as PlanId)
        : null;
    const free = parsed.freeMessages;
    const freeMessages =
      free &&
      typeof free.remaining === "number" &&
      typeof free.included === "number" &&
      typeof free.used === "number"
        ? { remaining: free.remaining, included: free.included, used: free.used }
        : null;
    return {
      planId,
      planName: parsed.planName,
      unlimited: parsed.unlimited,
      remainingPct: parsed.remainingPct,
      freeMessages,
      nextResetAt:
        typeof parsed.nextResetAt === "number" ? parsed.nextResetAt : null,
    };
  } catch {
    return null;
  }
}

/**
 * Last known usage for `userId`, or null while it's genuinely unknown
 * (first-ever open, Autumn pending). Resolution order matches
 * useCachedPlan: live answer, then the cache, then the Free defaults once
 * the fetch has settled without a customer. `customerUnsettled` must cover
 * errors as well as loading — a failed fetch means UNKNOWN, not "Free".
 */
export function useCachedUsage(
  userId: string | undefined,
  customer: CustomerLike,
  customerUnsettled: boolean,
): UsageSummary | null {
  const [cached, setCached] = useState<UsageSummary | null>(null);

  /* In an effect (not lazy state) so SSR/hydration never touch storage. */
  useEffect(() => {
    setCached(userId ? readUsageCache(userId) : null);
  }, [userId]);

  useEffect(() => {
    if (!userId || !customer) return;
    try {
      localStorage.setItem(
        cacheKey(userId),
        JSON.stringify(readUsageSummary(customer)),
      );
    } catch {
      // private mode etc. — next open just loads the slow way
    }
  }, [userId, customer]);

  if (customer) return readUsageSummary(customer);
  if (cached) return cached;
  if (!customerUnsettled) return readUsageSummary(null);
  return null;
}
