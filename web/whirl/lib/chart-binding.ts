"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConvex } from "@whirl/backend/react";
import { api } from "@whirl/backend/convex/_generated/api";
import type { Id } from "@whirl/backend/convex/_generated/dataModel";

import type { ChartSeries } from "./chart-spec";

/* Refreshing a live chart.
 *
 * The card always has something to draw — the snapshot taken when the chart
 * was made is on the phase — so this is a quiet upgrade, never a loading
 * state over an empty card. If the refresh fails, the snapshot stays and the
 * footer says it's stale. That ordering matters: a chart that blanks itself
 * because an integration hiccuped is worse than one showing yesterday's
 * numbers with a note.
 *
 * The mapping from response to series is applied server-side, with the same
 * code that validated it when the chart was authored, so nothing here has to
 * know the shape of the integration's data. */

export type LiveChartData = {
  categories: string[];
  series: ChartSeries[];
  fetchedAt: number;
};

export type ChartBindingState = {
  /** Fresh values, or null while the snapshot is all there is. */
  live: LiveChartData | null;
  /** The refresh failed; the snapshot on screen is stale. */
  error: string | null;
  refreshing: boolean;
  refresh: () => void;
};

export function useChartBinding({
  messageId,
  phaseIndex,
  enabled,
}: {
  messageId?: string;
  phaseIndex?: number;
  /** The chart actually has a binding. */
  enabled: boolean;
}): ChartBindingState {
  const convex = useConvex();
  const [live, setLive] = useState<LiveChartData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const canRun =
    enabled && Boolean(messageId) && typeof phaseIndex === "number";

  const run = useCallback(
    async (force: boolean) => {
      if (!canRun) return;
      setRefreshing(true);
      try {
        const result = await convex.action(api.artifactData.runChartBinding, {
          messageId: messageId as Id<"messages">,
          phaseIndex: phaseIndex as number,
          ...(force ? { force: true } : {}),
        });
        if (!aliveRef.current) return;
        if (result.ok) {
          setLive({
            categories: result.categories,
            series: result.series,
            fetchedAt: result.fetchedAt,
          });
          setError(null);
        } else {
          setError(result.error);
        }
      } catch {
        if (aliveRef.current) {
          setError("Couldn't reach Whirl to refresh this.");
        }
      } finally {
        if (aliveRef.current) setRefreshing(false);
      }
    },
    [canRun, convex, messageId, phaseIndex],
  );

  /* One read when the chart comes into existence on screen. Inside the
     server's cache window this costs nothing, which is what makes it safe to
     do on every mount of every live chart in a thread. */
  useEffect(() => {
    if (!canRun) return;
    void run(false);
  }, [canRun, run]);

  const refresh = useCallback(() => {
    /* An explicit refresh means now, not "within the last minute" — so it
       bypasses the cache, while still spending from the same budget. */
    void run(true);
  }, [run]);

  return { live, error, refreshing, refresh };
}

/** "just now" / "4 minutes ago" / "2 hours ago" — enough to judge staleness. */
export function formatFetchedAt(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
