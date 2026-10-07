"use client";

import { formatChartValue, type ChartSpec } from "@whirl/lib/chart-spec";

/* The hover readout, as a Recharts tooltip. It enhances the chart, it never
   gates it — every value here is also reachable through the table view (the
   toggle in the card header), which is what keyboard and screen-reader
   users get. */

type Entry = {
  name?: string | number;
  value?: number | string | (number | string)[];
  dataKey?: string | number;
  color?: string;
  payload?: Record<string, unknown>;
};

export function ChartTooltip({
  active,
  payload,
  label,
  spec,
  /** Scatter labels its axes rather than its series, having only x and y. */
  scatter = false,
}: {
  active?: boolean;
  payload?: Entry[];
  label?: string | number;
  spec: ChartSpec;
  scatter?: boolean;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const rows = scatter
    ? [
        {
          key: "x",
          label: spec.xLabel ?? "x",
          color: payload[0]?.color,
          value: Number(payload[0]?.payload?.x ?? 0),
        },
        {
          key: "y",
          label: spec.yLabel ?? "y",
          color: payload[0]?.color,
          value: Number(payload[0]?.payload?.y ?? 0),
        },
      ]
    : payload
        .filter((entry) => entry.value !== null && entry.value !== undefined)
        .map((entry, index) => ({
          key: `${entry.dataKey ?? index}`,
          label: String(entry.name ?? entry.dataKey ?? ""),
          color: entry.color,
          value: Number(entry.value),
        }));

  if (rows.length === 0) return null;

  const title = scatter
    ? String(payload[0]?.name ?? spec.series[0]?.name ?? "")
    : String(label ?? "");

  return (
    <div className="pointer-events-none rounded-xl bg-popover px-2.5 py-2 text-[12px]/4 shadow-[0_0_0_1px_var(--border)]">
      {title && (
        <div className="mb-1 max-w-45 truncate font-medium">{title}</div>
      )}
      <ul className="space-y-0.5">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: row.color }}
            />
            <span className="max-w-28 truncate text-muted-foreground">
              {row.label}
            </span>
            <span className="ml-auto shrink-0 tabular-nums">
              {formatChartValue(row.value, spec)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
