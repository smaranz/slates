"use client";

import { IconArrowUpRight, IconDownload } from "@tabler/icons-react";

import {
  downloadHtmlArtifact,
  downloadReactArtifactSource,
  openHtmlArtifactInNewTab,
} from "@whirl/lib/html-export";
import { visualUrl } from "@whirl/lib/share";
import { CopyLinkButton } from "./artifact-shell";

/**
 * The panel's export controls: copy the shareable {site}/visual/{id} link,
 * open the page in a new tab, or download it.
 *
 * Two things change what's on offer. A React artifact downloads as its source
 * module rather than a standalone page (see downloadReactArtifactSource for
 * why). And an artifact that reads live integration data isn't shareable at
 * all, so the link and the new-tab affordances come off entirely — offering a
 * link that resolves to "not available" is worse than not offering one.
 */
export function HtmlExportButtons({
  title,
  html,
  shortId,
  runtime = "html",
  shareable = true,
}: {
  title: string;
  html: string;
  shortId?: string;
  runtime?: "html" | "react";
  shareable?: boolean;
}) {
  const isReact = runtime === "react";

  return (
    <>
      {shareable && shortId ? (
        <CopyLinkButton url={visualUrl(shortId)} label="Copy share link" />
      ) : null}
      {shareable && !isReact ? (
        <button
          type="button"
          aria-label="Open in a new tab"
          title="Open in new tab"
          onClick={() => openHtmlArtifactInNewTab(title, html, shortId)}
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.06]"
        >
          <IconArrowUpRight size={15} stroke={2} />
        </button>
      ) : null}
      <button
        type="button"
        title={isReact ? "Download source" : "Download HTML"}
        onClick={() =>
          isReact
            ? downloadReactArtifactSource(title, html)
            : downloadHtmlArtifact(title, html)
        }
        className="flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-full bg-primary pr-2.5 pl-2 text-primary-foreground transition-[background-color,scale] duration-150 hover:bg-(--primary-hover) active:scale-[0.97]"
      >
        <IconDownload size={14} stroke={2} />
        <span className="text-[12px]/4 font-medium">Download</span>
      </button>
    </>
  );
}
