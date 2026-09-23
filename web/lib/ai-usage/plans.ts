/**
 * Pure reducers for linked AI plans.
 *
 * Kept free of the filesystem so unit tests can exercise activate / remove
 * without touching ~/.slates.
 */

import type { PlanKind, UsagePlan, UsageProvider } from "./types";

export interface LinkPlanInput {
  provider: UsageProvider;
  label: string;
  kind: PlanKind;
  monthlyUsd?: number | null;
  keyHint?: string | null;
  id?: string;
  linkedAt?: number;
}

function newId(): string {
  return `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function clampLabel(label: string): string {
  return label.trim().slice(0, 40) || "Untitled plan";
}

/**
 * Add a linked plan. A new api plan for a provider becomes active and
 * deactivates other api plans for that provider; same for subscriptions,
 * independently of api plans.
 */
export function linkPlan(plans: UsagePlan[], input: LinkPlanInput): UsagePlan[] {
  const plan: UsagePlan = {
    id: input.id ?? newId(),
    provider: input.provider,
    label: clampLabel(input.label),
    kind: input.kind,
    monthlyUsd: input.monthlyUsd ?? null,
    keyHint: input.keyHint ?? null,
    active: true,
    linkedAt: input.linkedAt ?? Date.now(),
    source: "linked",
  };

  return [
    ...plans.map((p) =>
      p.provider === plan.provider && p.kind === plan.kind ? { ...p, active: false } : p
    ),
    plan,
  ];
}

/** Mark one linked plan active; deactivates siblings of the same kind+provider. */
export function activatePlan(plans: UsagePlan[], id: string): UsagePlan[] {
  const target = plans.find((p) => p.id === id);
  if (!target) return plans;
  return plans.map((p) => {
    if (p.id === id) return { ...p, active: true };
    if (p.provider === target.provider && p.kind === target.kind) return { ...p, active: false };
    return p;
  });
}

export function removePlan(plans: UsagePlan[], id: string): UsagePlan[] {
  return plans.filter((p) => p.id !== id);
}

/** Deactivate linked api plans for a provider so the env key is what agents use. */
export function useEnv(plans: UsagePlan[], provider: UsageProvider): UsagePlan[] {
  return plans.map((p) =>
    p.provider === provider && p.kind === "api" ? { ...p, active: false } : p
  );
}

/** Deactivate linked subscriptions so the machine CLI login is attributed. */
export function useCli(plans: UsagePlan[], provider: UsageProvider): UsagePlan[] {
  return plans.map((p) =>
    p.provider === provider && p.kind === "subscription" ? { ...p, active: false } : p
  );
}

export function activeApiPlan(plans: UsagePlan[], provider: UsageProvider): UsagePlan | null {
  return plans.find((p) => p.provider === provider && p.kind === "api" && p.active) ?? null;
}

export function activeSubscriptionPlan(
  plans: UsagePlan[],
  provider: UsageProvider
): UsagePlan | null {
  return plans.find((p) => p.provider === provider && p.kind === "subscription" && p.active) ?? null;
}
