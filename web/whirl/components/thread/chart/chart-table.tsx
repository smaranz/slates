"use client";

import { formatChartValue, type ChartSpec } from "@whirl/lib/chart-spec";

/* The chart's table twin. Every chart has one, because a value that's only
   reachable by hovering a colored mark isn't reachable at all — not by
   keyboard, not by a screen reader, and not by anyone who can't separate two
   of the hues. The card header toggles between the two views. */

function HeaderCell({
  children,
  numeric = false,
}: {
  children: React.ReactNode;
  numeric?: boolean;
}) {
  return (
    <th
      scope="col"
      className={`px-2 py-1.5 font-medium text-muted-foreground ${
        numeric ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

export function ChartTable({ spec }: { spec: ChartSpec }) {
  const cellClass =
    "px-2 py-1.5 text-right tabular-nums border-t border-black/[0.06] dark:border-white/[0.06]";

  return (
    <div className="mt-3 max-h-80 overflow-auto">
      <table className="w-full text-[12.5px]/4">
        {spec.type === "scatter" ? (
          <>
            <thead>
              <tr>
                <HeaderCell>{spec.series.length > 1 ? "Series" : ""}</HeaderCell>
                <HeaderCell numeric>{spec.xLabel ?? "x"}</HeaderCell>
                <HeaderCell numeric>{spec.yLabel ?? "y"}</HeaderCell>
              </tr>
            </thead>
            <tbody>
              {spec.series.flatMap((series) =>
                (series.points ?? []).map((point, index) => (
                  <tr key={`${series.name}-${index}`}>
                    <th
                      scope="row"
                      className="max-w-40 truncate border-t border-black/[0.06] px-2 py-1.5 text-left font-normal text-muted-foreground dark:border-white/[0.06]"
                    >
                      {index === 0 && spec.series.length > 1 ? series.name : ""}
                    </th>
                    <td className={cellClass}>
                      {formatChartValue(point.x, spec)}
                    </td>
                    <td className={cellClass}>
                      {formatChartValue(point.y, spec)}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </>
        ) : (
          <>
            <thead>
              <tr>
                <HeaderCell>{spec.xLabel ?? ""}</HeaderCell>
                {spec.series.map((series) => (
                  <HeaderCell key={series.name} numeric>
                    {series.name}
                  </HeaderCell>
                ))}
              </tr>
            </thead>
            <tbody>
              {(spec.categories ?? []).map((category, index) => (
                <tr key={category + index}>
                  <th
                    scope="row"
                    className="max-w-40 truncate border-t border-black/[0.06] px-2 py-1.5 text-left font-normal dark:border-white/[0.06]"
                  >
                    {category}
                  </th>
                  {spec.series.map((series) => {
                    const value = series.values?.[index];
                    return (
                      <td key={series.name} className={cellClass}>
                        {value === null || value === undefined
                          ? "—"
                          : formatChartValue(value, spec)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </>
        )}
      </table>
    </div>
  );
}
