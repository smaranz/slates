"use client";

import { useEffect, useState } from "react";
import {
  IconAlertTriangleFilled,
  IconArrowUpRight,
  IconBrowser,
  IconChartBubble,
  IconLayoutDashboard,
  IconPlugConnected,
  IconWand,
  type Icon,
} from "@tabler/icons-react";

import { autoOpenStreamingHtml, openHtmlPanel } from "@whirl/lib/artifact-panel";
import { openHtmlArtifactInNewTab } from "@whirl/lib/html-export";
import { useIsLatestVisualCard } from "@whirl/lib/latest-visual";
import {
  readsLiveData,
  useLiveHtmlArtifact,
  type LiveHtmlArtifact,
} from "@whirl/lib/live-artifacts";
import type { MessagePhase } from "@whirl/lib/messages";
import { useReportArtifactWorking } from "./artifact-activity";
import {
  ARTIFACT_SETTLE_MS,
  ArtifactCardShell,
  ArtifactIconBadge,
  ArtifactWorkingBody,
} from "./artifact-card-shell";
import { deriveHtmlCardState, htmlWorkingLook } from "./artifact-card-state";
import { ArtifactDataSources } from "./artifact-data-sources";
import { ArtifactFrameView } from "./artifact-frame-view";

/**
 * The inline chat card for an HTML artifact. Inline visualizations render
 * right in the conversation (sandboxed iframe); full pages are an openable
 * row into the side panel, and auto-open while streaming so the user
 * watches the page land.
 *
 * Edits mutate the artifact row in place, so every card pointing at one
 * artifact holds the same latest content — only the furthest-along card
 * (see lib/latest-visual) renders the actual visual; superseded ones
 * collapse into compact rows so follow-ups don't repeat the visual.
 */
export function HtmlCard({
  phase,
  order = 0,
  messageTerminal = false,
}: {
  phase: MessagePhase;
  /** Thread position, for the latest-visual-card election. */
  order?: number;
  /** The message settled — the card must not stay in a working state. */
  messageTerminal?: boolean;
}) {
  const live = useLiveHtmlArtifact(phase.htmlId);
  const state = deriveHtmlCardState(phase, live, messageTerminal);
  const working = state === "working";
  const { icon, verbs } = htmlWorkingLook(phase, live);
  const mode = phase.mode ?? live?.kind;
  const isEdit = (phase.op ?? "create") === "edit";
  /* Only completed inline cards compete for who shows the visual — full
     pages are rows into the panel and never register. */
  const latest = useIsLatestVisualCard(
    mode === "inline" && state === "complete" ? phase.htmlId : undefined,
    order,
  );
  useReportArtifactWorking(working);

  /* A full page streaming in opens its panel once, so the wait happens
     somewhere the result will actually appear. */
  useEffect(() => {
    if (working && mode === "full" && !isEdit && phase.htmlId) {
      autoOpenStreamingHtml(phase.htmlId);
    }
  }, [working, mode, isEdit, phase.htmlId]);

  if (state === "hidden") return null;

  const title = phase.title?.trim() || live?.title?.trim() || "Visualization";
  const wide = state === "complete" && mode === "inline" && latest;

  return (
    <ArtifactCardShell className={wide ? "w-full" : "w-95 max-w-full"}>
      {state === "working" ? (
        <ArtifactWorkingBody
          icon={icon}
          verbs={verbs}
          title={mode === "full" ? title : undefined}
        />
      ) : state === "failed" ? (
        <FailedBody live={live} />
      ) : live?.dataLocked ? (
        <DataLockedRow title={title} />
      ) : mode === "inline" ? (
        latest ? (
          <InlineBody live={live} title={title} htmlId={phase.htmlId} />
        ) : (
          <CollapsedVisualRow
            phase={phase}
            live={live}
            title={title}
            isEdit={isEdit}
          />
        )
      ) : (
        <FullPageRow phase={phase} live={live} title={title} isEdit={isEdit} />
      )}
    </ArtifactCardShell>
  );
}

/* An inline visualization: title bar + the sandboxed iframe. */
function InlineBody({
  live,
  title,
  htmlId,
}: {
  live: LiveHtmlArtifact | null | undefined;
  title: string;
  htmlId?: string;
}) {
  /* A react artifact that fails to compile or throws on mount reports it up
     here, so the failure reads as a message in the card's own chrome rather
     than an empty frame. */
  const [frameError, setFrameError] = useState<string | null>(null);

  if (!live?.content) return null;

  const bound = readsLiveData(live);

  return (
    <>
      <div className="flex h-10 items-center gap-2 border-b border-black/[0.05] px-3 dark:border-white/[0.05]">
        <IconChartBubble
          size={15}
          stroke={2}
          className="shrink-0 text-muted-foreground"
        />
        <span className="min-w-0 flex-1 truncate text-[12.5px]/4 font-medium">
          {title}
        </span>
        {!bound ? (
          <OpenInNewTabButton live={live} title={title} size={6} />
        ) : null}
      </div>
      {/* The iframe waits out the card's entrance choreography — painting
          under an animating ancestor is how it freezes as a ghost (see
          HtmlFrameView). */}
      <ArtifactFrameView
        artifact={live}
        htmlId={htmlId}
        title={title}
        mountDelayMs={ARTIFACT_SETTLE_MS}
        onErrorChange={setFrameError}
      />
      {frameError ? (
        <div className="border-t border-black/[0.05] px-3 py-2 text-[11.5px]/4 text-muted-foreground dark:border-white/[0.05]">
          {frameError}
        </div>
      ) : null}
      {bound ? (
        <div className="border-t border-black/[0.05] px-3 py-2 dark:border-white/[0.05]">
          <ArtifactDataSources bindings={live.bindings ?? []} />
        </div>
      ) : null}
    </>
  );
}

/* A superseded inline card: a later card in the thread shows this artifact's
   current state, so this one stays a quiet reference row instead of
   repeating the visual. */
function CollapsedVisualRow({
  phase,
  live,
  title,
  isEdit,
}: {
  phase: MessagePhase;
  live: LiveHtmlArtifact | null | undefined;
  title: string;
  isEdit: boolean;
}) {
  const subtitle = isEdit
    ? `Updated${phase.editCount ? ` · ${phase.editCount} change${phase.editCount === 1 ? "" : "s"}` : ""}`
    : "Earlier version";
  const RowIcon: Icon = isEdit ? IconWand : IconChartBubble;

  return (
    <div className="flex items-center gap-3 px-3.5 py-3">
      <ArtifactIconBadge icon={RowIcon} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13.5px]/5 font-medium">{title}</span>
        <span className="truncate text-[11.5px]/4 text-muted-foreground">
          {subtitle}
        </span>
      </span>
      <OpenInNewTabButton live={live} title={title} size={7} />
    </div>
  );
}

function OpenInNewTabButton({
  live,
  title,
  size,
}: {
  live: LiveHtmlArtifact | null | undefined;
  title: string;
  size: 6 | 7;
}) {
  /* An artifact that reads live data has no public page to open — it only
     means anything running as its owner. */
  if (!live?.content || readsLiveData(live)) return null;
  return (
    <button
      type="button"
      aria-label="Open visualization in a new tab"
      title="Open in new tab"
      onClick={() => openHtmlArtifactInNewTab(title, live.content, live.shortId)}
      className={`flex ${size === 6 ? "size-6" : "size-7"} shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.06]`}
    >
      <IconArrowUpRight size={14} stroke={2} />
    </button>
  );
}

function FullPageRow({
  phase,
  live,
  title,
  isEdit,
}: {
  phase: MessagePhase;
  live: LiveHtmlArtifact | null | undefined;
  title: string;
  isEdit: boolean;
}) {
  const isReact = live?.runtime === "react";
  const subtitle = isEdit
    ? `Updated${phase.editCount ? ` · ${phase.editCount} change${phase.editCount === 1 ? "" : "s"}` : ""}`
    : isReact
      ? "Interactive app"
      : "HTML page";

  return (
    <button
      type="button"
      onClick={() => {
        if (phase.htmlId) openHtmlPanel(phase.htmlId);
      }}
      className="group/html flex w-full cursor-pointer items-center gap-3 px-3.5 py-3 text-left transition-colors duration-150 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
    >
      <ArtifactIconBadge icon={isReact ? IconLayoutDashboard : IconBrowser} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13.5px]/5 font-medium">{title}</span>
        {readsLiveData(live) ? (
          <ArtifactDataSources bindings={live?.bindings ?? []} />
        ) : (
          <span className="truncate text-[11.5px]/4 text-muted-foreground">
            {subtitle}
          </span>
        )}
      </span>
      <span className="flex h-7 items-center gap-1 rounded-full bg-black/[0.04] px-2.5 text-[11.5px]/4 font-medium text-muted-foreground transition-colors duration-150 group-hover/html:bg-black/[0.07] dark:bg-white/[0.06] dark:group-hover/html:bg-white/[0.1]">
        Open
        <IconArrowUpRight size={13} stroke={2} />
      </span>
    </button>
  );
}

/* A shared transcript withholds any artifact built around its owner's live
   integration data. Saying so beats a card that renders nothing. */
function DataLockedRow({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3">
      <ArtifactIconBadge icon={IconPlugConnected} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13.5px]/5 font-medium">{title}</span>
        <span className="truncate text-[11.5px]/4 text-muted-foreground">
          Not shown here — it reads live data from connected apps
        </span>
      </span>
    </div>
  );
}

/* Only full pages surface build failures in the chat. */
function FailedBody({ live }: { live: LiveHtmlArtifact | null | undefined }) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3">
      <ArtifactIconBadge icon={IconAlertTriangleFilled} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13.5px]/5 font-medium">
          Couldn&apos;t build the page
        </span>
        <span className="truncate text-[11.5px]/4 text-muted-foreground">
          {live?.error?.trim() || "Something went wrong while generating it."}
        </span>
      </div>
    </div>
  );
}
