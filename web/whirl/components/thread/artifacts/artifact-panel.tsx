"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence } from "motion/react";
import { useMutation } from "@whirl/backend/react";
import type { Editor } from "@tiptap/react";
import type { TablerIcon } from "@tabler/icons-react";
import {
  IconBrowser,
  IconFileCode,
  IconFileFilled,
  IconLayoutDashboard,
  IconLoader2,
} from "@tabler/icons-react";
import { api } from "@whirl/backend/convex/_generated/api";
import type { Id } from "@whirl/backend/convex/_generated/dataModel";

/* The two editors are the heaviest thing this app can render — TipTap,
   ProseMirror and KaTeX between them — and this panel is mounted by the
   chat face on every page load, whether or not a document is ever opened.
   Statically imported they rode along on the home route's first paint.
   Split out, they load the moment a document artifact actually opens; the
   panel's own spinner (already the state a loading document sits in) covers
   the fetch. */
const MarkdownEditor = dynamic(
  () =>
    import("@whirl/components/editor/markdown-editor").then(
      (module) => module.MarkdownEditor,
    ),
  { loading: () => <PanelLoading /> },
);
const CodeDocumentEditor = dynamic(
  () =>
    import("@whirl/components/editor/code-document-editor").then(
      (module) => module.CodeDocumentEditor,
    ),
  { loading: () => <PanelLoading /> },
);
import { closeArtifactPanel, useArtifactPanel } from "@whirl/lib/artifact-panel";
import { formatSize } from "@whirl/lib/attachments";
import { addDocumentSelection } from "@whirl/lib/composer-ingest";
import {
  readsLiveData,
  useIsFixtureArtifacts,
  useLiveDocument,
  useLiveHtmlArtifact,
} from "@whirl/lib/live-artifacts";
import { documentUrl } from "@whirl/lib/share";
import {
  CloseButton,
  CopyLinkButton,
  FullscreenToggle,
  useArtifactShell,
  useMinMd,
} from "./artifact-shell";
import { DocumentDownloadMenu } from "./document-download-menu";
import { CodeDownloadButton } from "./code-download-button";
import { ArtifactDataSources } from "./artifact-data-sources";
import { ArtifactFrameView } from "./artifact-frame-view";
import { HtmlExportButtons } from "./html-export-buttons";

/* The artifact side panel: whirl-authored documents in a full TipTap
   markdown editor (mirroring the body live while it streams, editable with
   debounced save-back once complete), and full HTML pages in a sandboxed
   iframe with export controls. The resizable/fullscreen shell lives in
   artifact-shell.tsx; which artifact is open lives in lib/artifact-panel. */

export function ArtifactPanel() {
  const { target, fullscreen } = useArtifactPanel();
  const minMd = useMinMd();
  const Shell = useArtifactShell();
  /* Fullscreen only applies to the desktop embedded pane; the mobile
     overlay already covers everything. */
  const isFullscreen = minMd && fullscreen;

  return (
    <AnimatePresence initial={false}>
      {target?.kind === "document" ? (
        <Shell
          key={`doc:${target.documentId}`}
          onClose={closeArtifactPanel}
          fullscreen={isFullscreen}
        >
          <DocumentPanelBody
            documentId={target.documentId}
            fullscreen={isFullscreen}
          />
        </Shell>
      ) : target?.kind === "html" ? (
        <Shell
          key={`html:${target.htmlId}`}
          onClose={closeArtifactPanel}
          fullscreen={isFullscreen}
        >
          <HtmlPanelBody htmlId={target.htmlId} fullscreen={isFullscreen} />
        </Shell>
      ) : null}
    </AnimatePresence>
  );
}

function PanelIconBadge({ icon }: { icon: TablerIcon }) {
  const Glyph = icon;
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-black/[0.04] text-muted-foreground dark:bg-white/[0.06]">
      <Glyph size={16} />
    </span>
  );
}

function PanelNote({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-[13px]/5 text-muted-foreground">
      {text}
    </div>
  );
}

/* The cards keep their artifact rows subscribed, so this only shows on
   the cold paths (a deep link, a card that never mounted) — a quiet
   spinner, not a skeleton pretending to know the layout. */
function PanelLoading() {
  return (
    <div className="flex h-full items-center justify-center">
      <IconLoader2 size={18} className="animate-spin text-muted-foreground" />
    </div>
  );
}

const SAVE_DEBOUNCE_MS = 600;

/**
 * The panel contents for a whirl-authored document. Reads a live
 * `documents` row: while whirl is writing it the editor mirrors the body
 * as it fills in and stays read-only; once complete the user can edit it
 * (debounced save-back), and a later whirl revision swaps the text in with
 * a soft highlight sweep so the change is seen.
 */
function DocumentPanelBody({
  documentId,
  fullscreen,
}: {
  documentId: string;
  fullscreen: boolean;
}) {
  /* On /debug the doc comes from canned fixtures (no auth to save back). */
  const fixtures = useIsFixtureArtifacts();
  const doc = useLiveDocument(documentId);
  const updateContent = useMutation(api.documents.updateDocumentContent);
  const ensureShareId = useMutation(api.documents.ensureDocumentShareId);
  const [editor, setEditor] = useState<Editor | null>(null);

  const streaming = doc?.status === "streaming";
  const isCode = doc?.format === "code";

  /* New documents get their public share token at creation; rows from
     before tokens existed get one minted on first open, so the copy-link
     button shows up for old documents too. Best-effort. */
  useEffect(() => {
    if (fixtures || !doc || streaming || doc.shortId) return;
    void ensureShareId({
      documentId: documentId as Id<"documents">,
    }).catch(() => {});
  }, [fixtures, doc, streaming, documentId, ensureShareId]);

  /* The text the editor renders. Swapped on initial load, on every
     streaming tick, and on a whirl edit — but never on the user's own save
     echo, so a live query update can't yank text out from under someone
     mid-edit. */
  const [displayValue, setDisplayValue] = useState<string | null>(null);
  /* Tells the editor to flash the changed region on the *next* swap. On
     only for genuine whirl revisions — never during streaming or the swap
     that lands the final body. */
  const [highlightEdits, setHighlightEdits] = useState(false);
  const prevContentRef = useRef("");
  const lastLocalRef = useRef<string | null>(null);
  const wasStreamingRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const title = doc?.title?.trim() || "Document";
  const fileName = doc?.fileName?.trim() || `${title}.txt`;

  useEffect(() => {
    if (doc === undefined) return; // still loading
    const content = doc?.content ?? "";
    if (displayValue === null) {
      setDisplayValue(content);
      prevContentRef.current = content;
      wasStreamingRef.current = streaming;
      return;
    }
    const justFinishedStreaming = wasStreamingRef.current && !streaming;
    wasStreamingRef.current = streaming;
    if (content === prevContentRef.current) return;
    const isLocalEcho = content === lastLocalRef.current;
    prevContentRef.current = content;
    if (streaming) {
      /* Mirror the body as it streams in; no flash, follow the tail. */
      setHighlightEdits(false);
      setDisplayValue(content);
    } else if (!isLocalEcho) {
      /* Whirl revised the doc out from under us — show it and flash the
         changed region, unless this swap is just the stream settling. */
      setHighlightEdits(!justFinishedStreaming);
      setDisplayValue(content);
    }
  }, [doc, displayValue, streaming]);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const handleChange = (next: string) => {
    if (next === prevContentRef.current) return;
    lastLocalRef.current = next;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void updateContent({
        documentId: documentId as Id<"documents">,
        content: next,
      }).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
  };

  const handleCodeChange = (next: string) => {
    setDisplayValue(next);
    handleChange(next);
  };

  const handleAddSelection = (selectedText: string) => {
    addDocumentSelection({ documentId, title, selectedText });
  };

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-4">
        <PanelIconBadge icon={isCode ? IconFileCode : IconFileFilled} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13.5px]/4 font-medium">{title}</span>
          <span className="mt-0.5 flex items-center gap-1.5 truncate text-[11px]/3 text-muted-foreground">
            {streaming ? (
              <>
                <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-amber-500/80" />
                Writing…
              </>
            ) : (
              <>
                {isCode
                  ? `${fileName}${doc?.language ? ` · ${doc.language}` : ""}`
                  : "Document"}
                {displayValue !== null
                  ? ` · ${formatSize(new Blob([displayValue]).size)}`
                  : ""}
              </>
            )}
          </span>
        </span>
        {doc?.shortId && !fixtures ? (
          <CopyLinkButton
            url={documentUrl(doc.shortId)}
            label="Copy share link"
          />
        ) : null}
        {isCode && displayValue !== null ? (
          <CodeDownloadButton fileName={fileName} content={displayValue} />
        ) : (
          <DocumentDownloadMenu editor={editor} name={`${title}.md`} />
        )}
        <FullscreenToggle fullscreen={fullscreen} />
        <CloseButton onClose={closeArtifactPanel} label="Close document" />
      </header>
      <div className="relative min-h-0 flex-1">
        {doc === null ? (
          <PanelNote text="This document isn't available anymore." />
        ) : displayValue === null ? (
          <PanelLoading />
        ) : (
          /* Opacity-only ease-in — no transforms, so the text never takes
             a raster snap as the animation lands. */
          <div className="body-fade-in h-full">
            {isCode ? (
              <CodeDocumentEditor
                value={displayValue}
                onChange={handleCodeChange}
                editable={!streaming && !fixtures}
                stickToBottom={streaming}
                onAddSelectionToChat={
                  streaming || fixtures ? undefined : handleAddSelection
                }
              />
            ) : (
              <MarkdownEditor
                value={displayValue}
                onChange={handleChange}
                editable={!streaming && !fixtures}
                onEditorReady={setEditor}
                stickToBottom={streaming}
                highlightEdits={highlightEdits}
                onAddSelectionToChat={
                  streaming || fixtures ? undefined : handleAddSelection
                }
              />
            )}
          </div>
        )}
      </div>
    </>
  );
}

/** The panel contents for a whirl-built full page — HTML or React. */
function HtmlPanelBody({
  htmlId,
  fullscreen,
}: {
  htmlId: string;
  fullscreen: boolean;
}) {
  const live = useLiveHtmlArtifact(htmlId);
  const [frameError, setFrameError] = useState<string | null>(null);
  const building =
    live?.status === "pending" ||
    live?.status === "generating" ||
    live?.status === "streaming";
  const isReact = live?.runtime === "react";
  const bound = readsLiveData(live);
  const title = live?.title?.trim() || (isReact ? "App" : "Page");

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-4">
        <PanelIconBadge icon={isReact ? IconLayoutDashboard : IconBrowser} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13.5px]/4 font-medium">{title}</span>
          <span className="mt-0.5 flex items-center gap-1.5 truncate text-[11px]/3 text-muted-foreground">
            {building ? (
              <>
                <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-amber-500/80" />
                {isReact ? "Writing…" : "Building…"}
              </>
            ) : bound ? (
              <ArtifactDataSources bindings={live?.bindings ?? []} />
            ) : isReact ? (
              "Interactive app"
            ) : (
              "HTML page"
            )}
          </span>
        </span>
        {live?.content && live.status === "complete" && (
          <HtmlExportButtons
            title={title}
            html={live.content}
            shortId={live.shortId}
            runtime={live.runtime ?? "html"}
            shareable={!bound}
          />
        )}
        <FullscreenToggle fullscreen={fullscreen} />
        <CloseButton onClose={closeArtifactPanel} label="Close page" />
      </header>
      <div className="min-h-0 flex-1">
        {live === undefined ? (
          <PanelLoading />
        ) : live === null ? (
          <PanelNote text="This page isn't available anymore." />
        ) : live.status === "failed" ? (
          <PanelNote
            text={
              live.error?.trim() || "Something went wrong while building it."
            }
          />
        ) : building || !live.content ? (
          <div className="flex h-full items-center justify-center">
            <span className="text-shimmer text-[13.5px]/5 font-medium">
              {isReact ? "Writing the app…" : "Building the page…"}
            </span>
          </div>
        ) : (
          <div className="flex h-full flex-col">
            <div className="min-h-0 flex-1">
              <ArtifactFrameView
                artifact={live}
                htmlId={htmlId}
                title={title}
                fill
                onErrorChange={setFrameError}
              />
            </div>
            {frameError ? (
              <div className="shrink-0 border-t border-border px-4 py-2 text-[12px]/5 text-muted-foreground">
                {frameError}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </>
  );
}
