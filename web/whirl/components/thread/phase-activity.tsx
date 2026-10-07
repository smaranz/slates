"use client";

import { memo, useEffect, useState } from "react";
import {
  IconBrain,
  IconBuildingStore,
  IconCalculator,
  IconChartHistogram,
  IconChevronDown,
  IconChevronRight,
  IconCloud,
  IconHistory,
  IconMessageQuestion,
  IconPhotoFilled,
  IconPlugConnected,
  IconSchool,
  IconSearch,
  IconStack2,
  IconWorld,
} from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";

import { IntegrationIcon } from "@whirl/components/integration-logo";
import { useIntegrationActivity } from "@whirl/lib/integration-activity";
import type {
  MessagePhase,
  MessageStatus,
} from "@whirl/lib/messages";
import { EASE_OUT, SHED_BLUR } from "@whirl/lib/motion";
import {
  compactPhases,
  currentPhase,
  integrationCompletedLabel,
  integrationPhaseAction,
  samePhases,
} from "@whirl/lib/phase-activity";
import { claimScrollIntent } from "@whirl/lib/scroll-intent";
import {
  phaseNarrationTarget,
  useSteadyPhaseNarration,
} from "@whirl/lib/use-phase-narration";
import {
  PhaseIcon,
  PhaseLabel,
  WhirlActivityIcon,
} from "./phase-motion";
import {
  PhaseDetailContent,
  PhaseRow,
  phaseDisclosure,
} from "./phase-row";

function ActivityGlyph({
  kind,
  size,
}: {
  kind: string | undefined;
  size: number;
}) {
  switch (kind) {
    case "thought":
      return <IconBrain size={size} stroke={2} />;
    case "search":
      return <IconSearch size={size} stroke={2} />;
    case "fetch":
      return <IconWorld size={size} stroke={2} />;
    case "calc":
      return <IconCalculator size={size} stroke={2} />;
    case "mcp":
      return <IconPlugConnected size={size} stroke={2} />;
    case "skill":
      return <IconSchool size={size} stroke={2} />;
    case "history":
      return <IconHistory size={size} stroke={2} />;
    case "integrationSuggestion":
      return <IconBuildingStore size={size} stroke={2} />;
    case "question":
      return <IconMessageQuestion size={size} stroke={2} />;
    case "weather":
      return <IconCloud size={size} stroke={2} />;
    case "chart":
      return <IconChartHistogram size={size} stroke={2} />;
    case "image":
      return <IconPhotoFilled size={size} />;
    default:
      return null;
  }
}

const GLYPH_KINDS = new Set([
  "thought",
  "search",
  "fetch",
  "calc",
  "mcp",
  "skill",
  "history",
  "integrationSuggestion",
  "question",
  "weather",
  "chart",
  "image",
]);

/** The assistant turn's one activity surface. Before prose arrives it stays
 * mounted as the large current-phase indicator. Once the reply becomes
 * visible, one action settles in place; only multi-step work collapses into
 * the "Did N things" disclosure. */
export const PhaseActivity = memo(function PhaseActivity({
  phases,
  status,
  thinking,
  active,
  settled,
  animate,
}: {
  phases: MessagePhase[];
  status: MessageStatus | undefined;
  thinking: boolean;
  /** The response has not started and no richer card owns the progress UI. */
  active: boolean;
  /** Visible prose (or a terminal turn) has arrived. */
  settled: boolean;
  /** This mount caught a live turn, so its first appearance may ease in. */
  animate: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const compact = compactPhases(phases);
  const latest = currentPhase(phases);
  const narration = useSteadyPhaseNarration(
    phaseNarrationTarget({
      phase: latest,
      status,
      thinking,
      active,
      settled,
      phaseCount: compact.length,
    }),
    animate,
  );
  const final = narration.mode === "final";
  /* The assistant message renders the live indicator through one
     persistent element that hands off between compact runs — a stack left
     expanded by the previous run must not pre-open the next one. */
  useEffect(() => {
    if (!final) setExpanded(false);
  }, [final]);
  const single = final && compact.length === 1 ? compact[0] : undefined;
  const grouped = final && compact.length > 1;
  const current = narration.mode === "live" ? narration.phase : single;
  const mcp = current?.kind === "mcp" ? current : undefined;
  const integration = useIntegrationActivity(mcp?.server, mcp?.tool);
  const singleExpandable = single
    ? phaseDisclosure(single).expandable
    : false;
  const expandable = grouped || singleExpandable;
  const narratedStatus =
    narration.mode === "live" ? narration.status : status;
  const narratedThinking =
    narration.mode === "live" ? narration.thinking : thinking;
  const actionLabel = integrationPhaseAction(
    current,
    narratedStatus,
    narratedThinking,
    integration.action,
  );
  const label = grouped
    ? `Did ${compact.length} thing${compact.length === 1 ? "" : "s"}`
    : single
      ? integrationCompletedLabel(single, integration.completed)
    : actionLabel;
  const brandedIcon = grouped ? undefined : integration.iconSvg;
  const activityKind =
    single?.kind ??
    current?.kind ??
    (narratedStatus === "searching" ? "search" : undefined);
  const glyphSize = final ? 15 : 17;
  const whirl =
    !final && !brandedIcon && !GLYPH_KINDS.has(activityKind ?? "");
  const visible = narration.mode !== "hidden";

  const iconKey = grouped
    ? "complete"
    : brandedIcon
      ? `integration-${mcp?.server ?? ""}`
      : whirl
        ? "whirl"
        : `phase-${current?.kind ?? narratedStatus ?? "waiting"}`;

  return (
    <>
      {/* The no-tools handoff is atomic: when prose arrives this row unmounts
          immediately, so it cannot hold space above or overlap the first line.
          Actual completed phases stay mounted and morph into their summary. */}
      {visible && (
        <motion.div
          key="phase-activity"
          initial={
            animate ? { opacity: 0, y: -4, filter: "blur(4px)" } : false
          }
          animate={{
            opacity: 1,
            y: 0,
            filter: "blur(0px)",
            transitionEnd: SHED_BLUR,
          }}
          exit={{ opacity: 0, y: -4, filter: "blur(4px)" }}
          transition={{
            opacity: { duration: 0.22, ease: EASE_OUT },
            filter: { duration: 0.24, ease: EASE_OUT },
            y: { type: "spring", stiffness: 460, damping: 34 },
          }}
          className="mb-2 flex w-full min-w-0 flex-col items-start"
        >
          <button
            type="button"
            disabled={!expandable}
            onClick={(event) => {
              claimScrollIntent(event.currentTarget);
              setExpanded((currentValue) => !currentValue);
            }}
            aria-expanded={expandable ? expanded : undefined}
            title={
              single?.kind === "mcp" && single.server && single.tool
                ? `${single.server} · ${single.tool}`
                : undefined
            }
            className={`-mx-1 flex max-w-full items-center rounded-md px-1 py-0.5 text-left ${
              final ? "gap-1.5" : "gap-2"
            } ${
              expandable
                ? "cursor-pointer transition-colors duration-150 hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
                : "cursor-default"
            }`}
          >
            <PhaseIcon iconKey={iconKey}>
              {brandedIcon ? (
                <IntegrationIcon iconSvg={brandedIcon} size={glyphSize} />
              ) : whirl ? (
                <WhirlActivityIcon />
              ) : grouped ? (
                <IconStack2 size={glyphSize} stroke={2} />
              ) : null}
              {!brandedIcon && !whirl && !grouped && (
                <ActivityGlyph kind={activityKind} size={glyphSize} />
              )}
            </PhaseIcon>
            {label && (
              <PhaseLabel
                text={label}
                shimmer={!final}
                ellipsis={!final}
                className={`max-w-[min(34rem,calc(100vw-5rem))] font-medium ${
                  final
                    ? "text-[13px]/5 text-muted-foreground"
                    : "text-[15px]/6"
                }`}
              />
            )}
            {grouped && (
              <motion.span
                aria-hidden
                animate={{ rotate: expanded ? 90 : 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 34 }}
                className="flex size-4 shrink-0 items-center justify-center text-muted-foreground"
              >
                <IconChevronRight size={14} stroke={2.4} />
              </motion.span>
            )}
            {singleExpandable && (
              <IconChevronDown
                size={14}
                className={`shrink-0 text-muted-foreground transition-transform duration-200 ${
                  expanded ? "rotate-180" : ""
                }`}
              />
            )}
          </button>
          <AnimatePresence initial={false}>
            {expandable && expanded && (
              <motion.div
                key="activity-details"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{
                  height: { type: "spring", stiffness: 620, damping: 48 },
                  opacity: { duration: 0.18, ease: EASE_OUT },
                }}
                className="overflow-hidden"
              >
                <div className="mt-1 ml-2.5 flex flex-col border-l border-border py-0.5 pl-3">
                  {grouped
                    ? compact.map((phase, index) => (
                        <PhaseRow key={`${phase.kind}-${index}`} phase={phase} />
                      ))
                    : single && <PhaseDetailContent phase={single} />}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </>
  );
},
/* Same reason as the cards: the settled disclosures above a streaming tail
   have nothing to say about the prose arriving under them. */
(previous, next) =>
  previous.status === next.status &&
  previous.thinking === next.thinking &&
  previous.active === next.active &&
  previous.settled === next.settled &&
  previous.animate === next.animate &&
  samePhases(previous.phases, next.phases));
