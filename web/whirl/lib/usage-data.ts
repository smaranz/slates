"use client";

import { useMemo } from "react";
import { useQuery } from "@whirl/backend/react";
import { IconArchiveFilled, IconDatabaseFilled } from "@tabler/icons-react";

import { api } from "@whirl/backend/convex/_generated/api";
import { useComposerModels } from "@whirl/lib/model-catalog";
import { isCustomModelKey } from "@whirl/lib/models";
import type { ComposerModel } from "@whirl/lib/models";
import { readUsageSummary, type CustomerLike } from "@whirl/lib/plan";

/* The usage tab's data spine: `messages:recentUsage` line items (assistant
   turns, compactions, memory-index runs) plus the client-side massaging the
   charts and table share. Token fields are best-effort — null on rows from
   before the backend started recording them. */

export type UsageRow = {
  id: string;
  threadId: string;
  createdAt: number;
  model: string;
  thinking: boolean;
  search: boolean;
  usageCost: number;
  extraUsageCost: number;
  searchSources: number;
  thoughtMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  totalTokens: number | null;
  /** Estimated tokens of the conversation actually sent — the prompt side
   *  that's genuinely the user's. Null on legacy rows. */
  promptContentTokens: number | null;
};

export function useRecentUsage(limit = 200): UsageRow[] | undefined {
  return useQuery(api.messages.recentUsage, { limit }) as
    | UsageRow[]
    | undefined;
}

/* Two numbers, no accounting theater: the user's prompt tokens and the
   model's output tokens. Our overhead (system prompt, tool schemas, cache
   mechanics) never shows up here. */
export type TokenBreakdown = {
  /** Prompt tokens — the user's conversation content, not our scaffolding. */
  input: number;
  output: number;
  total: number;
};

/** Null when the row predates token recording — "—" beats a lying zero. */
export function rowTokens(row: UsageRow): TokenBreakdown | null {
  if (
    row.inputTokens == null &&
    row.outputTokens == null &&
    row.totalTokens == null
  ) {
    return null;
  }
  /* Prompt side: the recorded estimate of the conversation actually sent.
     Legacy rows predate it and fall back to the provider's lump — nothing
     better was recorded for them. */
  const input = row.promptContentTokens ?? row.inputTokens ?? 0;
  const output = row.outputTokens ?? 0;
  return { input, output, total: input + output };
}

/** Full counts, no k-abbreviation — "12,847", per the usage table spec. */
export function formatTokens(count: number): string {
  return Math.round(count).toLocaleString();
}

/** Share of the plan pool, kept honest at the small end ("<0.1%"). */
export function formatPlanPct(pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return "0%";
  if (pct < 0.1) return "<0.1%";
  return pct >= 10 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`;
}

/** The slice of a row that was billed to the plan pool (not extra usage). */
export function rowPlanCost(row: UsageRow): number {
  return Math.max(0, row.usageCost - row.extraUsageCost);
}

export type UsageModelInfo = Pick<ComposerModel, "icon" | "iconSvg"> & {
  name: string;
  company?: string;
};

/* Non-model line items keep their own faces. */
const SYNTHETIC_MODELS: Record<string, UsageModelInfo> = {
  Compact: { name: "Compaction", icon: IconArchiveFilled },
  Index: { name: "Memory index", icon: IconDatabaseFilled },
};

/**
 * Resolve a usage row's raw model key to its display name + glyph. Retired
 * tiers and since-removed catalog slugs still label sensibly instead of
 * vanishing from history.
 */
export function useUsageModelLookup(): (key: string) => UsageModelInfo {
  const models = useComposerModels();
  return useMemo(() => {
    const byKey = new Map(models.map((model) => [model.key, model]));
    return (key: string) => {
      const synthetic = SYNTHETIC_MODELS[key];
      if (synthetic) return synthetic;
      const model = byKey.get(key);
      if (model) {
        return {
          name: model.name,
          company: model.company,
          icon: model.icon,
          iconSvg: model.iconSvg,
        };
      }
      return { name: isCustomModelKey(key) ? key.split("/")[1] : key };
    };
  }, [models]);
}

const INTERVAL_MS: Record<string, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
  year: 365 * 86_400_000,
};

export type PeriodWindow = {
  start: number;
  /** The next reset from Autumn, when it reported one. */
  resetAt: number | null;
};

/**
 * The current usage period, reconstructed from Autumn's next reset and the
 * feature's billing interval (best-effort — a month is assumed when the
 * interval isn't reported).
 */
export function readPeriodWindow(
  customer: CustomerLike,
  now: number,
): PeriodWindow {
  const usage = readUsageSummary(customer);
  const paid = usage.planId !== null;
  const features = customer?.features as
    | Record<string, { interval?: string | null } | undefined>
    | undefined;
  const feature = paid ? features?.usage : features?.messages;
  const periodMs = INTERVAL_MS[feature?.interval ?? ""] ?? INTERVAL_MS.month;
  const resetAt = usage.nextResetAt;
  return {
    start: resetAt ? resetAt - periodMs : now - periodMs,
    resetAt,
  };
}

/** Midnight starting the Monday of `ms`'s week, in the viewer's time zone. */
export function startOfWeek(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  const day = (date.getDay() + 6) % 7;
  return date.getTime() - day * 86_400_000;
}

/** "Jul 19, 2:34 PM" in the viewer's own time zone; year only when it differs. */
export function formatRowDate(ms: number, now = Date.now()): string {
  const date = new Date(ms);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}
