"use client";

import type { LiveHtmlArtifact } from "@whirl/lib/live-artifacts";
import { HtmlFrameView } from "./html-frame-view";
import { ReactFrameView } from "./react-frame-view";

/**
 * One entry point for rendering an artifact body, so the cards and the side
 * panel don't each have to know which runtime an artifact was written for.
 *
 * The two frames are genuinely different animals — one wraps markup in a
 * srcdoc, the other compiles a module and posts it into a CSP'd route — but
 * everything upstream only cares that an artifact renders.
 */
export function ArtifactFrameView({
  artifact,
  htmlId,
  title,
  fill = false,
  maxHeight,
  mountDelayMs = 0,
  onErrorChange,
}: {
  artifact: LiveHtmlArtifact;
  /** Needed by react artifacts to run their declared data bindings. */
  htmlId?: string;
  title?: string;
  fill?: boolean;
  maxHeight?: number;
  mountDelayMs?: number;
  onErrorChange?: (error: string | null) => void;
}) {
  if (artifact.runtime === "react") {
    return (
      <ReactFrameView
        htmlId={htmlId}
        code={artifact.content}
        title={title}
        streaming={artifact.status === "streaming"}
        fill={fill}
        {...(maxHeight !== undefined ? { maxHeight } : {})}
        mountDelayMs={mountDelayMs}
        onErrorChange={onErrorChange}
      />
    );
  }

  return (
    <HtmlFrameView
      html={artifact.content}
      title={title}
      fill={fill}
      {...(maxHeight !== undefined ? { maxHeight } : {})}
      mountDelayMs={mountDelayMs}
    />
  );
}
