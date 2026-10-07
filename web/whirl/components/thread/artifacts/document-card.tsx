"use client";

import { useEffect } from "react";
import { IconArrowUpRight } from "@tabler/icons-react";

import {
  autoOpenStreamingDocument,
  openDocumentPanel,
} from "@whirl/lib/artifact-panel";
import { useLiveDocument } from "@whirl/lib/live-artifacts";
import type { MessagePhase } from "@whirl/lib/messages";
import { useReportArtifactWorking } from "./artifact-activity";
import {
  ArtifactCardShell,
  ArtifactIconBadge,
  ArtifactWorkingBody,
} from "./artifact-card-shell";
import {
  deriveDocumentCardState,
  documentWorkingLook,
} from "./artifact-card-state";
import { SvgPreviewBody, isSvgDocument } from "./svg-preview";

/**
 * The inline chat card for a markdown document whirl authored or revised.
 * One persistent shell whose interior hard-swaps working → complete:
 * while the model streams the body it rotates whimsical labels over an
 * indeterminate bar (and a fresh create auto-pops the side panel so the
 * user watches it being written); once the phase finalizes it becomes the
 * openable card.
 */
export function DocumentCard({
  phase,
  messageTerminal = false,
}: {
  phase: MessagePhase;
  /** The message settled — the card must not stay in a working state. */
  messageTerminal?: boolean;
}) {
  const op = phase.op ?? "create";
  const isEdit = op === "edit";
  const state = deriveDocumentCardState(phase, messageTerminal);
  const working = state === "working";
  /* Stays subscribed after the doc settles too — the row is then already
     in the Convex client cache when the panel opens, so "Open" paints the
     document instantly instead of showing a loading state. */
  const live = useLiveDocument(phase.documentId);
  const { icon, verbs } = documentWorkingLook(phase, live);
  useReportArtifactWorking(working);

  /* A freshly-created doc opens itself the first time it streams, so the
     user watches it fill in. Edits don't auto-open (the user may not be
     looking at that doc). */
  useEffect(() => {
    if (phase.pending && !isEdit && phase.documentId) {
      autoOpenStreamingDocument(phase.documentId);
    }
  }, [phase.pending, phase.documentId, isEdit]);

  if (state === "hidden") return null;

  const title =
    phase.title?.trim() || live?.title?.trim() || "Untitled document";
  const subtitle = isEdit
    ? `Updated${phase.editCount ? ` · ${phase.editCount} change${phase.editCount === 1 ? "" : "s"}` : ""}`
    : live?.format === "code"
      ? live.fileName?.trim() || "Code file"
      : "Document";

  /* A finished SVG file shows itself like an inline visualization — the
     drawing in the chat, the source one click away. Edits keep the quiet
     "Updated" row; the original create card already previews the latest
     content, since the live row mutates in place. */
  const svgPreview =
    !working && !isEdit && !!live?.content && isSvgDocument(live);

  return (
    <ArtifactCardShell className={svgPreview ? "w-full" : undefined}>
      {working ? (
        <ArtifactWorkingBody icon={icon} verbs={verbs} />
      ) : svgPreview ? (
        <SvgPreviewBody
          live={live!}
          title={title}
          onOpenSource={() => {
            if (phase.documentId) openDocumentPanel(phase.documentId);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            if (phase.documentId) openDocumentPanel(phase.documentId);
          }}
          className="group/doc flex w-full cursor-pointer items-center gap-3 px-3.5 py-3 text-left transition-colors duration-150 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
        >
          <ArtifactIconBadge icon={icon} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13.5px]/5 font-medium">
              {title}
            </span>
            <span className="truncate text-[11.5px]/4 text-muted-foreground">
              {subtitle}
            </span>
          </span>
          <span className="flex h-7 items-center gap-1 rounded-full bg-black/[0.04] px-2.5 text-[11.5px]/4 font-medium text-muted-foreground transition-colors duration-150 group-hover/doc:bg-black/[0.07] dark:bg-white/[0.06] dark:group-hover/doc:bg-white/[0.1]">
            Open
            <IconArrowUpRight size={13} stroke={2} />
          </span>
        </button>
      )}
    </ArtifactCardShell>
  );
}
