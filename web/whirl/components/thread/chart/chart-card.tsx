"use client";

import { useMemo, useRef, useState } from "react";
import {
  IconChartAreaLineFilled,
  IconChartHistogram,
  IconChartPieFilled,
  IconDownload,
  IconPlugConnected,
  IconRefresh,
  IconTable,
} from "@tabler/icons-react";
import { motion } from "motion/react";

import type { MessagePhase } from "@whirl/lib/messages";
import { formatFetchedAt, useChartBinding } from "@whirl/lib/chart-binding";
import { seriesColors } from "@whirl/lib/chart-palette";
import { downloadChartPng } from "@whirl/lib/chart-export";
import {
  formatChartValue,
  isRenderableChart,
  type ChartSpec,
} from "@whirl/lib/chart-spec";
import { rise } from "@whirl/lib/motion";
import { showToast } from "@whirl/lib/toasts";
import { ChartLegend, type LegendItem } from "./chart-legend";
import { ChartPlot } from "./chart-plot-lazy";
import { ChartTable } from "./chart-table";

/* The inline chart card. Everything it draws rides on the phase itself
   (lib/messages.ts) — no table behind it, same as the weather widget.

   The model writes a spec and never a pixel, which is the point: the
   palette, the light and dark steps, and the table twin are all ours, so
   every chart in every thread reads as one system. Recharts draws it.

   The card only ever exists with numbers in it. A spec arrives whole, in one
   tool result, so there is nothing to fill a skeleton with while it's being
   written — the wait is narrated by the activity line instead
   (lib/phase-activity.ts) and this card rises in once, finished.

   Its two faces — the chart and the numbers — swap outright. No crossfade and
   no height spring: the card lives inside the assistant message, which
   re-renders on every tick of the typewriter while a reply streams, and
   per-item entrance animations in a list churning at that rate read as
   flicker rather than motion. The only animation is Recharts' own, inside
   the plot. */

/** A pie's slices are its categories; every other form legends its series. */
function legendItems(spec: ChartSpec, colors: string[]): LegendItem[] {
  if (spec.type === "pie") {
    const values = spec.series[0]?.values ?? [];
    return (spec.categories ?? []).map((category, index) => ({
      key: `${category}-${index}`,
      label: category,
      color: colors[index],
      value:
        values[index] === null || values[index] === undefined
          ? undefined
          : formatChartValue(values[index] as number, spec),
    }));
  }
  return spec.series.map((series, index) => ({
    key: series.name,
    label: series.name,
    color: colors[index],
  }));
}

function CardButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-black/[0.04] hover:text-foreground disabled:cursor-default disabled:opacity-40 dark:hover:bg-white/[0.06]"
    >
      {children}
    </button>
  );
}

/* A spec that never finalized (rejected by the tool, or a turn that died
   mid-call) leaves nothing worth a card. The pending sweep clears the phase.

   Gating here rather than inside the card is what lets the card below freeze
   its spec on mount: it only ever exists with a chart already in hand, so
   there is no "wait for one to arrive" to run during a render. */
export function ChartCard({
  phase,
  animate,
  messageId,
  phaseIndex,
}: {
  phase: MessagePhase;
  /** Entrance animation — only for cards landing mid-stream. */
  animate: boolean;
  /** Where this phase lives — a live chart re-reads its source through it. */
  messageId?: string;
  phaseIndex?: number;
}) {
  if (!isRenderableChart(phase.chart)) return null;
  return (
    <ChartCardBody
      chart={phase.chart}
      animate={animate}
      messageId={messageId}
      phaseIndex={phaseIndex}
    />
  );
}

function ChartCardBody({
  chart,
  animate,
  messageId,
  phaseIndex,
}: {
  chart: ChartSpec;
  animate: boolean;
  messageId?: string;
  phaseIndex?: number;
}) {
  const [showTable, setShowTable] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  /* The spec, frozen at the identity it first arrived with.

     A chart spec is written once and never revised, but the phase object
     carrying it is a fresh one on every reactive update — and this card
     re-renders on every tick of the typewriter while the reply streams.
     Handing Recharts a new-but-identical `data` array that often makes it
     replay its entrance over and over, which is precisely the flicker this
     card had before. Captured by the state initializer, which runs once at
     mount and never again — the card can't mount without a chart, so there
     is nothing to wait for and nothing to latch mid-render. */
  const [snapshot] = useState(chart);

  /* A live chart re-reads its integration on open. The snapshot above is
     always what draws first, so this only ever swaps fresher numbers in — a
     failed refresh leaves yesterday's chart on screen with a note, which
     beats blanking a card because an integration hiccuped. */
  const binding = snapshot.binding;
  const { live, error, refreshing, refresh } = useChartBinding({
    messageId,
    phaseIndex,
    enabled: Boolean(binding),
  });
  const spec = useMemo(
    () =>
      live
        ? { ...snapshot, categories: live.categories, series: live.series }
        : snapshot,
    [snapshot, live],
  );

  /* Whether the plot animates in. A chart that arrives while you're watching
     draws itself; one you scrolled back to, or re-opened the thread on, is
     already there. Toggling back from the numbers redraws it, because that
     swap is something you asked for. */
  const [swept, setSwept] = useState(false);

  // A live refresh that came back empty would draw an empty card — keep
  // yesterday's frozen chart off screen rather than an axis with nothing on it.
  if (!isRenderableChart(spec)) return null;

  const colors = seriesColors(
    spec.type === "pie"
      ? (spec.categories ?? [])
      : spec.series.map((series) => series.name),
  );

  const draw = animate || swept;

  const onDownload = async () => {
    const card = cardRef.current;
    // Recharts' own canvas, by its class. Not just "svg" — the header's
    // icons are SVGs too, and they come first in the card.
    const plot = card?.querySelector<SVGSVGElement>("svg.recharts-surface");
    if (!card || !plot) return;
    setSaving(true);
    try {
      await downloadChartPng({ plot, card, spec, colors });
    } catch (error) {
      showToast(
        `Couldn't save that chart. ${
          error instanceof Error ? error.message : "Something went wrong."
        }`,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      ref={cardRef}
      {...(animate ? rise(0) : { initial: false })}
      className="mb-2 w-full max-w-xl rounded-2xl bg-well p-4 shadow-[inset_0_0_0_1px_var(--well-outline),inset_0_1px_0_0_var(--well-highlight)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="block truncate text-[13.5px]/5 font-medium">
            {spec.title}
          </span>
          {spec.subtitle && (
            <span className="mt-0.5 block truncate text-[12px]/4 text-muted-foreground">
              {spec.subtitle}
            </span>
          )}
        </div>
        <div className="-mr-1 -mt-1 flex shrink-0 items-center">
          {/* Saving reads the plot straight off the page, so it's offered
              only while the plot is the thing on screen. */}
          {!showTable && (
            <CardButton
              label="Download as a PNG"
              onClick={onDownload}
              disabled={saving}
            >
              <IconDownload size={15} stroke={2} />
            </CardButton>
          )}
          <CardButton
            label={showTable ? "Show the chart" : "Show the numbers"}
            onClick={() => {
              setShowTable((current) => !current);
              setSwept(true);
              setActive(null);
            }}
          >
            {/* Going back to the chart shows the chart's own silhouette, so
                the button always says where it leads. */}
            {showTable ? (
              spec.type === "pie" ? (
                <IconChartPieFilled size={15} />
              ) : spec.type === "line" || spec.type === "area" ? (
                <IconChartAreaLineFilled size={15} />
              ) : (
                <IconChartHistogram size={15} stroke={2} />
              )
            ) : (
              <IconTable size={15} stroke={2} />
            )}
          </CardButton>
        </div>
      </div>

      {/* The two faces swap outright — no crossfade, no presence wrapper, no
          height spring. This card sits inside a subtree that re-renders on
          every typewriter tick of the reply, and per-item entrance and exit
          animations in a list churning at that rate don't read as motion,
          they read as flicker. The only animation left is the sweep, which
          happens inside the SVG and so cannot touch layout at all. */}
      {showTable ? (
        <ChartTable spec={spec} />
      ) : (
        <>
          <ChartPlot
            spec={spec}
            colors={colors}
            activeSeries={active}
            draw={draw}
          />
          <ChartLegend
            items={legendItems(spec, colors)}
            active={active}
            onActiveChange={setActive}
          />
        </>
      )}

      {spec.source && (
        <p className="mt-3 text-[11px]/4 text-muted-foreground">
          {spec.source}
        </p>
      )}

      {binding && (
        <LiveFootnote
          integration={binding.integration}
          fetchedAt={live?.fetchedAt}
          error={error}
          refreshing={refreshing}
          onRefresh={refresh}
        />
      )}
    </motion.div>
  );
}

/* Where a live chart's numbers came from and how old they are. Sits outside
   the plot on purpose: a chart that refreshes itself is making a claim about
   currency, and the claim should be legible without reading the numbers. */
function LiveFootnote({
  integration,
  fetchedAt,
  error,
  refreshing,
  onRefresh,
}: {
  integration: string;
  fetchedAt?: number;
  error: string | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="mt-3 flex items-center gap-2">
      <IconPlugConnected
        size={12}
        stroke={2}
        className="shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 flex-1 truncate text-[11px]/4 text-muted-foreground">
        {error
          ? `Showing the last numbers — ${error}`
          : refreshing && !fetchedAt
            ? `Live from ${integration}`
            : fetchedAt
              ? `Live from ${integration} · updated ${formatFetchedAt(fetchedAt)}`
              : `Live from ${integration}`}
      </span>
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        aria-label="Refresh this chart's data"
        title="Refresh"
        className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-black/[0.04] hover:text-foreground disabled:cursor-default disabled:opacity-40 dark:hover:bg-white/[0.06]"
      >
        <IconRefresh
          size={12}
          stroke={2}
          className={refreshing ? "animate-spin" : undefined}
        />
      </button>
    </div>
  );
}
