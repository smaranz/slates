"use client";

import { logger } from "@whirl/lib/axiom/browser";
import { ANALYTICS_EVENTS, captureEvent } from "@whirl/lib/posthog";

type PerformanceOutcome = "complete" | "error" | "cancelled";

type PerformanceEvent = {
  operation: string;
  outcome: PerformanceOutcome;
  durationMs: number;
  properties?: Record<string, unknown>;
};

let activeNavigation:
  | {
      startedAt: number;
      type: "push" | "replace" | "traverse";
    }
  | undefined;

function routeTemplate(pathname: string) {
  return pathname.replace(
    /^\/(thread|share|doc|visual)\/[^/]+/,
    "/$1/:id",
  );
}

export function reportFrontendPerformance({
  operation,
  outcome,
  durationMs,
  properties,
}: PerformanceEvent) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;

  const fields = {
    ...properties,
    operation,
    outcome,
    duration_ms: Math.round(durationMs * 100) / 100,
    environment: process.env.NODE_ENV,
  };

  try {
    logger.info("frontend_performance", fields);
  } catch {
    // Observability is best-effort and must never affect the interaction.
  }
  captureEvent(ANALYTICS_EVENTS.frontendPerformance, fields);
}

export function startRoutePerformance(
  _url: string,
  type: "push" | "replace" | "traverse",
) {
  activeNavigation = { startedAt: performance.now(), type };
}

export function completeRoutePerformance(pathname: string) {
  const navigation = activeNavigation;
  if (!navigation) return;
  activeNavigation = undefined;

  reportFrontendPerformance({
    operation: "route_navigation",
    outcome: "complete",
    durationMs: performance.now() - navigation.startedAt,
    properties: {
      navigation_type: navigation.type,
      pathname: routeTemplate(pathname),
    },
  });
}
