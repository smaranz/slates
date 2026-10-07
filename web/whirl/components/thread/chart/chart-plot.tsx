"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  formatChartTick,
  formatChartValue,
  isStacked,
  type ChartSpec,
} from "@whirl/lib/chart-spec";
import {
  ANIMATION_MS,
  AXIS_PROPS,
  CATEGORY_KEY,
  GRID_PROPS,
  hbarGutter,
  hbarHeight,
  MARK_GAP,
  PIE_HEIGHT,
  PLOT_HEIGHT,
  toRows,
  toSlices,
  yDomain,
} from "./chart-data";
import { ChartTooltip } from "./chart-tooltip";

/* Every chart form, on Recharts. Recharts owns the maths — scales, ticks,
   stacking, hit testing, the entrance — and this file owns how it looks:
   hairline solid gridlines, recessive 10px axis labels, thin marks, and the
   2px of card tone that separates touching fills.

   The one thing worth knowing before editing: `data` must keep a stable
   identity across renders. This card sits inside the assistant message,
   which re-renders on every tick of the typewriter while a reply streams,
   and Recharts replays its entrance whenever the data it was handed looks
   new. The spec is frozen upstream (see chart-card.tsx) so the memo below
   actually holds. */

const BAR_RADIUS = 4;

/** A stack's rounded end belongs to the segment on top and nowhere else;
 *  the ones underneath butt into it and stay square. */
function barRadius(
  isLast: boolean,
  horizontal: boolean,
  stacked: boolean,
): [number, number, number, number] {
  if (stacked && !isLast) return [0, 0, 0, 0];
  return horizontal
    ? [0, BAR_RADIUS, BAR_RADIUS, 0]
    : [BAR_RADIUS, BAR_RADIUS, 0, 0];
}

export function ChartPlot({
  spec,
  colors,
  activeSeries,
  draw,
}: {
  spec: ChartSpec;
  colors: string[];
  /** Series highlighted from the legend — the rest recede. */
  activeSeries: number | null;
  /** Play the entrance. False on a cold mount, so re-opening a thread
   *  paints its charts at rest rather than replaying every one. */
  draw: boolean;
}) {
  const rows = useMemo(() => toRows(spec), [spec]);
  const slices = useMemo(() => toSlices(spec), [spec]);
  const stacked = isStacked(spec);

  const dim = (index: number) =>
    activeSeries !== null && activeSeries !== index ? 0.25 : 1;

  const anim = {
    isAnimationActive: draw,
    animationDuration: ANIMATION_MS,
    animationEasing: "ease-out" as const,
  };

  const tick = (value: number) => formatChartTick(value, spec);
  const tooltip = <ChartTooltip spec={spec} />;

  /* Axis captions ride on the axes themselves so they end up inside the
     SVG, which is what the PNG export copies. */
  const xCaption = spec.xLabel ? (
    <Label value={spec.xLabel} position="insideBottom" offset={-4} fill="var(--color-muted-foreground)" fontSize={11} />
  ) : null;
  const yCaption = spec.yLabel ? (
    <Label value={spec.yLabel} angle={-90} position="insideLeft" fill="var(--color-muted-foreground)" fontSize={11} style={{ textAnchor: "middle" }} />
  ) : null;

  const margin = {
    top: 8,
    right: 8,
    bottom: spec.xLabel ? 16 : 0,
    left: spec.yLabel ? 8 : 0,
  };

  if (spec.type === "pie") {
    const total = slices.reduce((sum, slice) => sum + slice.value, 0);
    return (
      <div className="mt-3 w-full">
        <ResponsiveContainer width="100%" height={PIE_HEIGHT}>
          <PieChart>
            <Tooltip content={tooltip} />
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius={44}
              outerRadius={78}
              paddingAngle={1}
              /* Card tone carves the gaps: negative space, not a border. */
              stroke="var(--well)"
              strokeWidth={MARK_GAP}
              {...anim}
            >
              {slices.map((slice, index) => (
                <Cell
                  key={slice.name + index}
                  fill={colors[index]}
                  fillOpacity={dim(index)}
                />
              ))}
              {/* The hole earns its keep by holding the total. Positioned
                  off the viewBox Recharts hands the label, not percentages
                  of the canvas — the donut is centred in the plot area, not
                  in the SVG. Real SVG text, so the PNG export gets it. */}
              <Label
                position="center"
                content={(props: { viewBox?: unknown }) => {
                  const box = props.viewBox as
                    | { cx?: number; cy?: number }
                    | undefined;
                  const cx = box?.cx ?? 0;
                  const cy = box?.cy ?? 0;
                  return (
                    <>
                      <text
                        x={cx}
                        y={cy}
                        dy={-6}
                        textAnchor="middle"
                        className="fill-muted-foreground text-[11px]"
                      >
                        total
                      </text>
                      <text
                        x={cx}
                        y={cy}
                        dy={12}
                        textAnchor="middle"
                        className="fill-foreground text-[16px] font-semibold"
                      >
                        {formatChartValue(total, spec)}
                      </text>
                    </>
                  );
                }}
              />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (spec.type === "scatter") {
    const points = spec.series.map((series) => series.points ?? []);
    return (
      <div className="mt-3 w-full">
        <ResponsiveContainer width="100%" height={PLOT_HEIGHT}>
          <ScatterChart margin={{ ...margin, left: 0 }}>
            <CartesianGrid {...GRID_PROPS} vertical={false} />
            <XAxis
              {...AXIS_PROPS}
              type="number"
              dataKey="x"
              tickFormatter={tick}
            >
              {xCaption}
            </XAxis>
            <YAxis
              {...AXIS_PROPS}
              type="number"
              dataKey="y"
              width={44}
              tickFormatter={tick}
            >
              {yCaption}
            </YAxis>
            <Tooltip
              content={<ChartTooltip spec={spec} scatter />}
              cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
            />
            {spec.series.map((series, index) => (
              <Scatter
                key={series.name}
                name={series.name}
                data={points[index]}
                fill={colors[index]}
                fillOpacity={dim(index)}
                /* A surface ring, not a border — overlapping dots stay
                   countable without outlining each one. */
                stroke="var(--well)"
                strokeWidth={MARK_GAP}
                {...anim}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (spec.type === "hbar") {
    const gutter = hbarGutter(560);
    return (
      <div className="mt-3 w-full">
        <ResponsiveContainer
          width="100%"
          height={hbarHeight(spec.categories?.length ?? 0)}
        >
          <BarChart
            layout="vertical"
            data={rows}
            margin={margin}
            barCategoryGap="22%"
            barGap={MARK_GAP}
          >
            <CartesianGrid {...GRID_PROPS} horizontal={false} />
            <XAxis
              {...AXIS_PROPS}
              type="number"
              domain={yDomain(spec)}
              tickFormatter={tick}
            >
              {xCaption}
            </XAxis>
            <YAxis
              {...AXIS_PROPS}
              type="category"
              dataKey={CATEGORY_KEY}
              width={gutter}
              tick={{ ...AXIS_PROPS.tick, fontSize: 11 }}
            />
            <Tooltip content={tooltip} cursor={{ fill: "var(--border)" }} />
            {spec.series.map((series, index) => (
              <Bar
                key={series.name}
                dataKey={series.name}
                fill={colors[index]}
                fillOpacity={dim(index)}
                stackId={stacked ? "stack" : undefined}
                stroke={stacked ? "var(--well)" : undefined}
                strokeWidth={stacked ? MARK_GAP : undefined}
                radius={barRadius(
                  index === spec.series.length - 1,
                  true,
                  stacked,
                )}
                {...anim}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const axes = (
    <>
      <CartesianGrid {...GRID_PROPS} vertical={false} />
      <XAxis {...AXIS_PROPS} dataKey={CATEGORY_KEY} interval="preserveStartEnd">
        {xCaption}
      </XAxis>
      <YAxis {...AXIS_PROPS} width={44} domain={yDomain(spec)} tickFormatter={tick}>
        {yCaption}
      </YAxis>
    </>
  );

  if (spec.type === "bar") {
    return (
      <div className="mt-3 w-full">
        <ResponsiveContainer width="100%" height={PLOT_HEIGHT}>
          <BarChart
            data={rows}
            margin={margin}
            barCategoryGap="22%"
            barGap={MARK_GAP}
          >
            {axes}
            <Tooltip content={tooltip} cursor={{ fill: "var(--border)" }} />
            {spec.series.map((series, index) => (
              <Bar
                key={series.name}
                dataKey={series.name}
                fill={colors[index]}
                fillOpacity={dim(index)}
                stackId={stacked ? "stack" : undefined}
                stroke={stacked ? "var(--well)" : undefined}
                strokeWidth={stacked ? MARK_GAP : undefined}
                radius={barRadius(
                  index === spec.series.length - 1,
                  false,
                  stacked,
                )}
                {...anim}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (spec.type === "area") {
    return (
      <div className="mt-3 w-full">
        <ResponsiveContainer width="100%" height={PLOT_HEIGHT}>
          <AreaChart data={rows} margin={margin}>
            {axes}
            <Tooltip
              content={tooltip}
              cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
            />
            {spec.series.map((series, index) => (
              <Area
                key={series.name}
                type="linear"
                dataKey={series.name}
                stackId={stacked ? "stack" : undefined}
                fill={colors[index]}
                /* A stack's bands are solid and separated by card tone; a
                   plain area is a wash under its own line. */
                fillOpacity={(stacked ? 0.9 : 0.14) * dim(index)}
                stroke={stacked ? "var(--well)" : colors[index]}
                strokeWidth={stacked ? MARK_GAP : 2}
                strokeOpacity={dim(index)}
                connectNulls={false}
                {...anim}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div className="mt-3 w-full">
      <ResponsiveContainer width="100%" height={PLOT_HEIGHT}>
        <LineChart data={rows} margin={margin}>
          {axes}
          <Tooltip
            content={tooltip}
            cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
          />
          {spec.series.map((series, index) => (
            <Line
              key={series.name}
              type="linear"
              dataKey={series.name}
              stroke={colors[index]}
              strokeOpacity={dim(index)}
              strokeWidth={2}
              dot={false}
              activeDot={{
                r: 3.5,
                stroke: "var(--well)",
                strokeWidth: MARK_GAP,
              }}
              connectNulls={false}
              {...anim}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
