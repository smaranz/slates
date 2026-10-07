"use client";

import type { ChartSpec } from "@whirl/lib/chart-spec";

/* Turning a chart spec into what Recharts wants, plus the handful of house
   styling constants the plots share.

   Recharts takes one row per category with a key per series, which is the
   transpose of how the model writes a spec (a list of categories, then a
   list of values per series). */

export const PLOT_HEIGHT = 244;
/** Pies read as a disc, not a field — they get their own shorter box. */
export const PIE_HEIGHT = 200;
export const HBAR_ROW = 30;
export const HBAR_CHROME = 44;

/** The box a spec's plot will occupy, without loading the plot to find out.
 *  The lazy wrapper reserves exactly this, so a chart arriving from its own
 *  chunk never shifts the transcript under the reader. */
export function plotHeight(
  type: string | undefined,
  categoryCount: number,
): number {
  if (type === "pie") return PIE_HEIGHT;
  if (type === "hbar") return hbarHeight(categoryCount);
  return PLOT_HEIGHT;
}

/** The 2px of card tone that separates touching fills — stacked segments,
 *  adjacent slices — so the separation is negative space, not a border. */
export const MARK_GAP = 2;

export const AXIS_TICK = {
  fill: "var(--color-muted-foreground)",
  fontSize: 10,
} as const;

/** Shared by both axes: no drawn axis rule, no tick ticks, just the labels.
 *  The grid carries the structure. */
export const AXIS_PROPS = {
  axisLine: false,
  tickLine: false,
  tick: AXIS_TICK,
} as const;

export const GRID_PROPS = {
  stroke: "var(--border)",
  strokeWidth: 1,
} as const;

/** Recharts' own entrance. 600ms out, matching the rest of the app's pacing. */
export const ANIMATION_MS = 600;

/** The category label's key in a row. Prefixed so a series called "name"
 *  can't collide with it. */
export const CATEGORY_KEY = "__category";

export type ChartRow = Record<string, string | number | null>;

/** One row per category: { __category, [seriesName]: value }. */
export function toRows(spec: ChartSpec): ChartRow[] {
  return (spec.categories ?? []).map((category, index) => {
    const row: ChartRow = { [CATEGORY_KEY]: category };
    spec.series.forEach((series) => {
      const value = series.values?.[index];
      row[series.name] = value === undefined ? null : value;
    });
    return row;
  });
}

/** Pie wants one row per slice, since its slices are the categories. */
export function toSlices(spec: ChartSpec): { name: string; value: number }[] {
  const values = spec.series[0]?.values ?? [];
  return (spec.categories ?? []).map((category, index) => ({
    name: category,
    value: Math.max(values[index] ?? 0, 0),
  }));
}

/** Long category names are why anyone picks horizontal bars, so the label
 *  gutter scales with the card instead of being a fixed guess. */
export function hbarGutter(width: number): number {
  return Math.round(Math.min(Math.max(width * 0.32, 72), 168));
}

/** Horizontal bars grow downward with their categories rather than
 *  squashing them. */
export function hbarHeight(categoryCount: number): number {
  return Math.max(categoryCount * HBAR_ROW + HBAR_CHROME, 140);
}

/** Bars and areas encode magnitude by length, so their baseline has to be
 *  zero or the chart lies about ratios. Lines and dots read position, so
 *  they may zoom to the data — the axis is labeled either way. */
export function yDomain(spec: ChartSpec): [number | "auto", number | "auto"] {
  const zeroBased =
    spec.type === "bar" || spec.type === "hbar" || spec.type === "area";
  return zeroBased ? [0, "auto"] : ["auto", "auto"];
}

/** Series names in draw order. Stacks are drawn bottom-up, and only the
 *  last one drawn gets the rounded end — the ones under it butt into it. */
export function seriesNames(spec: ChartSpec): string[] {
  return spec.series.map((series) => series.name);
}
