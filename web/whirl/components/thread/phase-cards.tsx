"use client";

import { memo } from "react";

import type { MessagePhase } from "@whirl/lib/messages";
import { samePhases } from "@whirl/lib/phase-activity";
import { IntegrationSuggestionCard } from "@whirl/components/integrations/integration-suggestion-card";
import { DocumentCard } from "./artifacts/document-card";
import { ChartCard } from "./chart/chart-card";
import { HtmlCard } from "./artifacts/html-card";
import { AgentPhaseCard } from "./agent-phase-card";
import { GeneratingImageFrame, MorphingImage } from "./generated-image";
import { QuestionCard } from "./question-card";
import { WeatherWidget } from "./weather/weather-widget";

/* The rich phase blocks — weather widgets, charts, document cards, HTML
   artifacts, painted images — rendered between the activity chips and the prose.
   Chip-sized phase kinds stay in phase-chips.tsx; this file owns
   everything that takes up real estate. */

/** An image phase earns a card while painting or once pictures landed;
 * failed and legacy paints stay a quiet chip (phase-chips.tsx defers to
 * this so the two never double up). */
export function isImageCardPhase(phase: MessagePhase): boolean {
  return (
    phase.kind === "image" &&
    (phase.pending === true || (phase.images ?? []).length > 0)
  );
}

export const PhaseCards = memo(function PhaseCards({
  phases,
  animate,
  order = 0,
  messageTerminal = false,
  messageId,
  phaseIndex,
}: {
  phases: MessagePhase[];
  /** Entrance animations — only for cards landing mid-stream. */
  animate: boolean;
  /** The message these phases belong to, and where the first one sits in it.
   *  A live chart re-reads its integration through that address. */
  messageId?: string;
  phaseIndex?: number;
  /** Thread position of these phases (message createdAt + phase index),
   *  so visual cards for one artifact can agree on who is furthest along. */
  order?: number;
  /** The message has settled (complete/stopped/error) — nothing more is
   *  coming, so cards must not stay in a working state. */
  messageTerminal?: boolean;
}) {
  const cards = phases
    .map((phase, index) => {
      switch (phase.kind) {
        case "weather":
          return phase.pending ? null : (
            <WeatherWidget key={index} phase={phase} animate={animate} />
          );
        case "chart":
          /* Still drawing: the activity line above is narrating it
             (lib/phase-activity.ts), so nothing goes here until the spec
             lands and the card can draw the whole chart at once. */
          return phase.pending ? null : (
            <ChartCard
              key={index}
              phase={phase}
              animate={animate}
              messageId={messageId}
              phaseIndex={
                phaseIndex === undefined ? undefined : phaseIndex + index
              }
            />
          );
        case "document":
          return (
            <DocumentCard
              key={index}
              phase={phase}
              messageTerminal={messageTerminal}
            />
          );
        case "html":
          return (
            <HtmlCard
              key={index}
              phase={phase}
              order={order + index / 1_000_000}
              messageTerminal={messageTerminal}
            />
          );
        case "integrationSuggestion":
          return phase.pending ? null : (
            <IntegrationSuggestionCard
              key={index}
              phase={phase}
              animate={animate}
            />
          );
        case "question":
          return phase.pending ? null : (
            <QuestionCard key={index} phase={phase} />
          );
        case "image": {
          if (!isImageCardPhase(phase)) return null;
          const images = phase.images ?? [];
          return (
            <div key={index} className="mb-2 flex min-w-0 flex-wrap gap-1.5">
              {images.length === 0 ? (
                <GeneratingImageFrame label="Painting an image" />
              ) : (
                images.map((url, imageIndex) => (
                  <MorphingImage
                    key={url}
                    src={url}
                    alt={
                      phase.prompt ?? `Painted image ${imageIndex + 1}`
                    }
                  />
                ))
              )}
            </div>
          );
        }
        case "approval":
        case "file":
        case "voice":
        case "handoff":
        case "notice":
        case "learned":
          // The agent layer's own cards (Slates).
          return <AgentPhaseCard key={index} phase={phase} />;
        default:
          return null;
      }
    })
    .filter(Boolean);

  if (cards.length === 0) return null;
  return <>{cards}</>;
},
/* A reply grows a character and the whole turn re-renders — including every
   chart and artifact card already sitting above the tail. Nothing here
   depends on the prose, so nothing here needs to move. */
(previous, next) =>
  previous.animate === next.animate &&
  previous.order === next.order &&
  previous.messageTerminal === next.messageTerminal &&
  previous.messageId === next.messageId &&
  previous.phaseIndex === next.phaseIndex &&
  samePhases(previous.phases, next.phases));
