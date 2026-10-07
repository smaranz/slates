"use client";

import { IconFileCode, IconVectorBezier2 } from "@tabler/icons-react";

import type { LiveDocument } from "@whirl/lib/live-artifacts";
import { ARTIFACT_SETTLE_MS } from "./artifact-card-shell";
import { HtmlFrameView } from "./html-frame-view";

/** A code document that's really a vector drawing — those earn an inline
 * preview instead of a plain openable row. */
export function isSvgDocument(live: LiveDocument | null | undefined): boolean {
  if (live?.format !== "code") return false;
  return (
    live.language === "svg" ||
    (live.fileName ?? "").toLowerCase().endsWith(".svg")
  );
}

/* The inline preview for an SVG document, shaped exactly like an inline
   visualization: title bar + the sandboxed frame sizing itself to the
   drawing. The frame reuses the HTML artifact pipeline, so any scripts in
   the markup run in the same opaque-origin sandbox — never rendered as a
   raw <svg> in the page. "Open" still leads to the source in the panel. */
export function SvgPreviewBody({
  live,
  title,
  onOpenSource,
}: {
  live: LiveDocument;
  title: string;
  onOpenSource: () => void;
}) {
  if (!live.content) return null;

  return (
    <>
      <div className="flex h-10 items-center gap-2 border-b border-black/[0.05] px-3 dark:border-white/[0.05]">
        <IconVectorBezier2
          size={15}
          stroke={2}
          className="shrink-0 text-muted-foreground"
        />
        <span className="min-w-0 flex-1 truncate text-[12.5px]/4 font-medium">
          {live.fileName?.trim() || title}
        </span>
        <button
          type="button"
          aria-label="Open the SVG source in the side panel"
          title="Open source"
          onClick={onOpenSource}
          className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.06]"
        >
          <IconFileCode size={14} stroke={2} />
        </button>
      </div>
      {/* Centered like an image, not left-hugging like prose. The wrapper
          div is what the frame agent measures for the card's height. */}
      <HtmlFrameView
        html={`<div style="display:flex;justify-content:center">${live.content}</div>`}
        title={title}
        mountDelayMs={ARTIFACT_SETTLE_MS}
      />
    </>
  );
}
