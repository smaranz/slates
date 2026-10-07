/* Plan + usage derivation from the Autumn customer object. Trimmed mirror of
   the main app's lib/messages.ts — keep the plan-id lists in sync with
   convex/inference/billing.ts. */

export type PlanId = "mini" | "turbo" | "mega" | PlatinumPlanId;

/* The premium line. Sold from /platinum rather than the pricing grid, and
   only while an admin has it open (convex/platinum.ts) — but once someone is
   on it, it's a plan like any other, so it belongs in every list below. */
export type PlatinumPlanId = "platinum" | "platinum_max";

export const PLATINUM_PLAN_IDS: readonly PlatinumPlanId[] = [
  "platinum",
  "platinum_max",
];

export const PAID_PLAN_IDS: readonly PlanId[] = [
  "mini",
  "turbo",
  "mega",
  ...PLATINUM_PLAN_IDS,
];

export function isPlatinumPlan(planId: string | null | undefined): boolean {
  return (PLATINUM_PLAN_IDS as readonly string[]).includes(planId ?? "");
}

// Fallback used only when Autumn hasn't reported an `included_usage` yet.
const FREE_MESSAGE_LIMIT = 15;

// `past_due` counts so a lapsed-payment customer still reads as their plan
// rather than silently dropping to Free.
const IN_FORCE_PLAN_STATUSES = new Set(["active", "trialing", "past_due"]);

type PlanProductLike = {
  id: string;
  name?: string | null;
  status?: string | null;
  is_add_on?: boolean;
  canceled_at?: number | null;
  current_period_end?: number | null;
  trial_ends_at?: number | null;
};

type CustomerFeatureLike = {
  unlimited?: boolean | null;
  balance?: number | null;
  included_usage?: number | null;
  next_reset_at?: number | null;
};

export type CustomerLike =
  | {
      products?: readonly PlanProductLike[];
      features?: Record<string, CustomerFeatureLike | undefined>;
    }
  | null
  | undefined;

export function findActivePlanProduct(
  customer: CustomerLike,
): PlanProductLike | undefined {
  return customer?.products?.find(
    (p) =>
      !p.is_add_on &&
      (PAID_PLAN_IDS as readonly string[]).includes(p.id) &&
      IN_FORCE_PLAN_STATUSES.has(p.status ?? "active"),
  );
}

export type UsageSummary = {
  planId: PlanId | null;
  planName: string;
  unlimited: boolean;
  /** 0–100, how much of the allowance is left. */
  remainingPct: number;
  /** Count-based allowance used by the Free plan. Null for paid plans. */
  freeMessages: {
    remaining: number;
    included: number;
    used: number;
  } | null;
  /** Epoch ms of the next quota refill, if Autumn reported one. */
  nextResetAt: number | null;
};

/* Paid plans draw from the USD `usage` pool; free customers get a
   count-based `messages` allowance instead. The percentage remains useful
   for drawing a proportional meter, while free-plan copy uses the concrete
   message counts below. */
export function readUsageSummary(customer: CustomerLike): UsageSummary {
  const product = findActivePlanProduct(customer);
  const feature = product
    ? customer?.features?.usage
    : customer?.features?.messages;

  const unlimited = !!feature?.unlimited;
  const included =
    typeof feature?.included_usage === "number" && feature.included_usage > 0
      ? feature.included_usage
      : product
        ? 0
        : FREE_MESSAGE_LIMIT;
  const balance =
    typeof feature?.balance === "number"
      ? Math.max(0, feature.balance)
      : included;
  const remainingPct =
    !unlimited && included > 0
      ? Math.min(100, Math.max(0, (balance / included) * 100))
      : 100;
  const freeMessages = product
    ? null
    : {
        remaining: Math.floor(balance),
        included: Math.floor(included),
        used: Math.max(0, Math.floor(included - balance)),
      };

  return {
    planId: product ? (product.id as PlanId) : null,
    planName: product?.name ?? "Free",
    unlimited,
    remainingPct,
    freeMessages,
    nextResetAt:
      typeof feature?.next_reset_at === "number" ? feature.next_reset_at : null,
  };
}

/** "1 message" / "4 messages", shared by every free-plan usage surface. */
export function formatMessageCount(count: number): string {
  const safeCount = Math.max(0, Math.floor(count));
  return `${safeCount} ${safeCount === 1 ? "message" : "messages"}`;
}

/**
 * Friendly allowance copy without turning a count-based plan into a percent.
 * The compact cut drops "free" so the line still fits the user menu, which is
 * only as wide as the sidebar.
 */
export function formatFreeMessagesLeft(
  { remaining }: NonNullable<UsageSummary["freeMessages"]>,
  { compact = false }: { compact?: boolean } = {},
): string {
  if (remaining <= 0) {
    return compact ? "No messages left" : "No free messages left";
  }
  if (compact) return `${formatMessageCount(remaining)} left`;
  return `${remaining} free ${remaining === 1 ? "message" : "messages"} left`;
}

/** "4d 14h" / "14h 32m" / "soon" — time until the next quota refill. */
export function formatResetsIn(nextResetAt: number, now = Date.now()): string {
  const ms = nextResetAt - now;
  if (ms <= 60_000) return "soon";
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor((minutes % (60 * 24)) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}
