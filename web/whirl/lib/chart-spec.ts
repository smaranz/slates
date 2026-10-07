/* The chart spec the model writes and the thread card draws. Mirrors
   ChartSpec in packages/backend/convex/inference/chart.ts — the backend
   validates and clamps every field before it reaches a phase, so the
   renderers can trust the shape (right lengths, finite numbers, ≤ 8 series)
   and only guard against genuinely old or half-written rows. */

export type ChartType = "line" | "area" | "bar" | "hbar" | "pie" | "scatter";

export type ChartValueFormat = "number" | "compact" | "percent" | "currency";

export type ChartPoint = { x: number; y: number };

export type ChartSeries = {
  name: string;
  /** Aligned to `categories`; null is a gap in the data, not a zero. */
  values?: (number | null)[];
  /** Scatter only — free (x, y) pairs with no shared category axis. */
  points?: ChartPoint[];
};

export type ChartSpec = {
  type: ChartType;
  title: string;
  subtitle?: string;
  categories?: string[];
  series: ChartSeries[];
  stacked?: boolean;
  xLabel?: string;
  yLabel?: string;
  format?: ChartValueFormat;
  currency?: string;
  source?: string;
  /** A live integration source. When present, `categories` and `series` are
   *  the snapshot taken when the chart was drawn, and the card re-reads the
   *  integration on open. Only the integration name is needed client-side —
   *  the mapping is applied server-side, where it was validated. */
  binding?: { integration: string };
};

/** Charts whose series stack into a whole rather than sitting side by side. */
export function isStacked(spec: ChartSpec): boolean {
  return (
    spec.stacked === true &&
    (spec.type === "area" || spec.type === "bar" || spec.type === "hbar")
  );
}

/** A spec that survived the backend's validation but arrived half-written
 *  (an old row, a truncated patch) shouldn't crash the thread — the card
 *  quietly renders nothing instead. */
export function isRenderableChart(spec: ChartSpec | undefined): spec is ChartSpec {
  if (!spec || !Array.isArray(spec.series) || spec.series.length === 0) {
    return false;
  }
  if (spec.type === "scatter") {
    return spec.series.some((series) => (series.points?.length ?? 0) > 0);
  }
  if (!spec.categories || spec.categories.length === 0) return false;
  return spec.series.some((series) => (series.values?.length ?? 0) > 0);
}

/* ---- Value formatting ------------------------------------------------ */

/* One formatter per (format, currency) pair, built lazily. Intl formatters
   are expensive to construct and a chart asks for dozens per render. */
const formatterCache = new Map<string, Intl.NumberFormat>();

function numberFormat(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify(options);
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(undefined, options);
    formatterCache.set(key, formatter);
  }
  return formatter;
}

/** Enough decimals to tell neighbouring values apart, without noise: whole
 *  numbers stay whole, fractions keep the two places people actually read. */
function fractionDigits(value: number): number {
  const magnitude = Math.abs(value);
  if (Number.isInteger(value)) return 0;
  if (magnitude >= 100) return 0;
  if (magnitude >= 1) return 1;
  return 2;
}

/** The value as the tooltip, legend, and table say it — full precision. */
export function formatChartValue(value: number, spec: ChartSpec): string {
  const format = spec.format ?? "number";
  const digits = fractionDigits(value);

  if (format === "percent") {
    return `${numberFormat({
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    }).format(value)}%`;
  }
  if (format === "currency" && spec.currency) {
    try {
      return numberFormat({
        style: "currency",
        currency: spec.currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
      }).format(value);
    } catch {
      /* An unknown currency code from the model — fall through to plain. */
    }
  }
  if (format === "compact") {
    return numberFormat({
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  }
  return numberFormat({
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value);
}

/** The value as an axis tick — always terse, because ticks repeat and a
 *  long one collides with its neighbour. */
export function formatChartTick(value: number, spec: ChartSpec): string {
  const format = spec.format ?? "number";
  if (format === "percent") {
    return `${numberFormat({ maximumFractionDigits: 1 }).format(value)}%`;
  }
  const compact = Math.abs(value) >= 10_000 || format === "compact";
  const body = numberFormat(
    compact
      ? { notation: "compact", maximumFractionDigits: 1 }
      : { maximumFractionDigits: fractionDigits(value) },
  ).format(value);

  if (format === "currency" && spec.currency) {
    try {
      const symbol = numberFormat({
        style: "currency",
        currency: spec.currency,
        maximumFractionDigits: 0,
      })
        .formatToParts(0)
        .find((part) => part.type === "currency")?.value;
      if (symbol) return value < 0 ? `-${symbol}${body.slice(1)}` : `${symbol}${body}`;
    } catch {
      /* Unknown code — the bare number is still honest. */
    }
  }
  return body;
}
