"use client";

import { useState } from "react";
import {
  IconBrowser,
  IconFile,
  IconTerminal2,
  IconBrain,
  IconCalculator,
  IconChartHistogram,
  IconChevronDown,
  IconHistory,
  IconPhotoFilled,
  IconPlugConnected,
  IconSchool,
  IconSearch,
  IconWorld,
} from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";

import { IntegrationIcon } from "@whirl/components/integration-logo";
import { useIntegrationActivity } from "@whirl/lib/integration-activity";
import type { MessagePhase } from "@whirl/lib/messages";
import { EASE_OUT } from "@whirl/lib/motion";
import { integrationCompletedLabel } from "@whirl/lib/phase-activity";
import { claimScrollIntent } from "@whirl/lib/scroll-intent";
import { PhaseIcon, PhaseLabel } from "./phase-motion";
import { PhaseSources } from "./phase-sources";
import { CalcBody } from "./calc-body";

function isSearchSource(item: unknown): item is import("@whirl/lib/messages").SearchSource {
  return Boolean(item && typeof item === "object" && "url" in item);
}

/* An agent's step, by what kind of thing it touched. */
function agentToolGlyph(label = "") {
  if (/command|ran /i.test(label)) return <IconTerminal2 size={15} stroke={2} />;
  if (/browser|page|opened/i.test(label)) return <IconBrowser size={15} stroke={2} />;
  if (/file|edited|read|deleted/i.test(label)) return <IconFile size={15} stroke={2} />;
  if (/searched the web/i.test(label)) return <IconSearch size={15} stroke={2} />;
  if (/skill/i.test(label)) return <IconSchool size={15} stroke={2} />;
  return <IconPlugConnected size={15} stroke={2} />;
}

function PhaseGlyph({ kind, label }: { kind: string; label?: string }) {
  switch (kind) {
    case "agentTool":
      return agentToolGlyph(label);
    case "thought":
      return <IconBrain size={15} stroke={2} />;
    case "search":
      return <IconSearch size={15} stroke={2} />;
    case "fetch":
      return <IconWorld size={15} stroke={2} />;
    case "calc":
      return <IconCalculator size={15} stroke={2} />;
    case "skill":
      return <IconSchool size={15} stroke={2} />;
    case "history":
      return <IconHistory size={15} stroke={2} />;
    case "chart":
      return <IconChartHistogram size={15} stroke={2} />;
    case "image":
      return <IconPhotoFilled size={15} />;
    default:
      return <IconPlugConnected size={15} stroke={2} />;
  }
}

export function phaseDisclosure(phase: MessagePhase) {
  const sources =
    phase.kind === "search" || phase.kind === "fetch"
      ? (phase.items ?? []).filter(isSearchSource)
      : [];
  const trace =
    phase.kind === "thought"
      ? phase.text?.trim()
      : phase.kind === "agentTool"
        ? phase.detail?.trim()
        : undefined;
  return {
    sources,
    trace,
    expandable:
      Boolean(trace) ||
      sources.length > 0 ||
      (phase.kind === "calc" &&
        (Boolean(phase.result || phase.error || phase.expression) ||
          Boolean(phase.items?.length))),
  };
}

export function PhaseDetailContent({ phase }: { phase: MessagePhase }) {
  const { sources, trace } = phaseDisclosure(phase);
  if (phase.kind === "calc") return <CalcBody phase={phase} />;
  return trace ? (
    <div className="py-1 text-[13px]/5.5 whitespace-pre-wrap text-muted-foreground">
      {trace}
    </div>
  ) : (
    <PhaseSources sources={sources} />
  );
}

export function PhaseRow({ phase }: { phase: MessagePhase }) {
  const [open, setOpen] = useState(false);
  const mcp = phase.kind === "mcp";
  const integration = useIntegrationActivity(
    mcp ? phase.server : undefined,
    mcp ? phase.tool : undefined,
  );
  const { expandable } = phaseDisclosure(phase);
  const brandedIcon = mcp ? integration.iconSvg : undefined;
  const label = integrationCompletedLabel(phase, integration.completed);

  return (
    <div className="min-w-0">
      <button
        type="button"
        disabled={!expandable}
        onClick={(event) => {
          claimScrollIntent(event.currentTarget);
          setOpen((current) => !current);
        }}
        aria-expanded={expandable ? open : undefined}
        title={
          mcp && phase.server && phase.tool
            ? `${phase.server} · ${phase.tool}`
            : undefined
        }
        className={`-mx-1 flex max-w-full items-center gap-2 rounded-md px-1 py-0.5 text-left ${
          expandable
            ? "cursor-pointer transition-colors duration-150 hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
            : "cursor-default"
        }`}
      >
        <PhaseIcon
          iconKey={
            brandedIcon
              ? `integration-${phase.server ?? ""}`
              : `phase-${phase.kind}`
          }
        >
          {brandedIcon ? (
            <IntegrationIcon iconSvg={brandedIcon} size={15} />
          ) : (
            <PhaseGlyph kind={phase.kind} label={phase.label} />
          )}
        </PhaseIcon>
        <PhaseLabel
          text={label}
          className="max-w-[min(32rem,calc(100vw-7rem))] text-[13px]/5 font-medium text-muted-foreground"
        />
        {expandable && (
          <IconChevronDown
            size={13}
            className={`shrink-0 text-muted-foreground transition-transform duration-200 ${
              open ? "rotate-180" : ""
            }`}
          />
        )}
      </button>
      <AnimatePresence initial={false}>
        {expandable && open && (
          <motion.div
            key="details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { type: "spring", stiffness: 650, damping: 50 },
              opacity: { duration: 0.18, ease: EASE_OUT },
            }}
            className="overflow-hidden"
          >
            <div className="mt-1 mb-1 ml-2.5 border-l border-border pl-3">
              <PhaseDetailContent phase={phase} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
