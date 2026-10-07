"use client";

import { useMemo, useState } from "react";
import {
  IconBrowser,
  IconChartBubble,
  IconFileCode,
  IconFileFilled,
  IconPaperclip,
  IconPhotoFilled,
  IconStack2,
} from "@tabler/icons-react";
import { useQuery } from "@whirl/backend/react";
import { api } from "@whirl/backend/convex/_generated/api";
import type { Id } from "@whirl/backend/convex/_generated/dataModel";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@whirl/components/ui/dropdown-menu";
import { ImageLightbox } from "@whirl/components/ui/image-lightbox";
import { openDocumentPanel, openHtmlPanel } from "@whirl/lib/artifact-panel";
import { useThreadMessages } from "@whirl/lib/messages";
import { TOOLBAR_PILL_CLASS } from "./toolbar-pill";

/* The thread files menu: everything this conversation has produced or
   received — documents, visualizations, uploaded attachments — one hop
   away once the cards have scrolled out of view. Documents and pages open
   in the artifact side panel (same as their inline cards); image
   attachments open in the shared lightbox, other files in a new tab.
   Renders nothing while the thread has no files. */

type ThreadArtifacts = {
  documents: Array<{
    id: string;
    title: string;
    format: "markdown" | "code";
    fileName: string | null;
    language: string | null;
    updatedAt: number;
  }>;
  visualizations: Array<{
    id: string;
    title: string;
    kind: "inline" | "full";
    shortId: string | null;
    updatedAt: number;
  }>;
};

const ITEM = "gap-2 px-2 py-1.5";

export function ThreadFilesMenu({ threadId }: { threadId: string }) {
  /* Content and visibility split so the close animation can finish before
     anything unmounts. */
  const [lightbox, setLightbox] = useState<{
    src: string;
    alt: string;
  } | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const artifacts = useQuery(api.threads.getThreadArtifacts, {
    threadId: threadId as Id<"threads">,
  }) as ThreadArtifacts | undefined;
  /* Shares the live thread's subscription — no extra wire traffic. */
  const messages = useThreadMessages(threadId);

  const attachments = useMemo(() => {
    const out: Array<{ id: string; name: string; type: string; url: string }> =
      [];
    for (const message of messages ?? []) {
      for (const attachment of message.attachments ?? []) {
        if (attachment.url) {
          out.push({
            id: attachment.id,
            name: attachment.name,
            type: attachment.type,
            url: attachment.url,
          });
        }
      }
    }
    return out;
  }, [messages]);

  const openAttachment = (attachment: {
    name: string;
    type: string;
    url: string;
  }) => {
    if (attachment.type.startsWith("image/")) {
      setLightbox({ src: attachment.url, alt: attachment.name });
      setLightboxOpen(true);
    } else {
      window.open(attachment.url, "_blank", "noopener,noreferrer");
    }
  };

  const documents = artifacts?.documents ?? [];
  const visualizations = artifacts?.visualizations ?? [];
  const count = documents.length + visualizations.length + attachments.length;
  if (count === 0) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Files in this conversation"
          className={TOOLBAR_PILL_CLASS}
        >
          <IconStack2 size={15} stroke={2} />
          Files
          <span className="text-[11.5px]/4 text-muted-foreground/70">
            {count}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6} className="w-64 p-1">
          {visualizations.length > 0 && (
            <DropdownMenuGroup>
              <DropdownMenuLabel>Visualizations</DropdownMenuLabel>
              {visualizations.map((visual) => (
                <DropdownMenuItem
                  key={visual.id}
                  className={ITEM}
                  onClick={() => openHtmlPanel(visual.id)}
                >
                  {visual.kind === "full" ? (
                    <IconBrowser size={15} className="text-muted-foreground" />
                  ) : (
                    <IconChartBubble
                      size={15}
                      className="text-muted-foreground"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {visual.title}
                  </span>
                  <span className="text-[11px]/3 text-muted-foreground">
                    {visual.kind === "full" ? "Page" : "Chart"}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          )}
          {documents.length > 0 && (
            <DropdownMenuGroup>
              <DropdownMenuLabel>Documents</DropdownMenuLabel>
              {documents.map((document) => (
                <DropdownMenuItem
                  key={document.id}
                  className={ITEM}
                  onClick={() => openDocumentPanel(document.id)}
                >
                  {document.format === "code" ? (
                    <IconFileCode size={15} className="text-muted-foreground" />
                  ) : (
                    <IconFileFilled
                      size={15}
                      className="text-muted-foreground"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {document.format === "code" && document.fileName
                      ? document.fileName
                      : document.title}
                  </span>
                  {document.format === "code" ? (
                    <span className="text-[11px]/3 text-muted-foreground">
                      Code
                    </span>
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          )}
          {attachments.length > 0 && (
            <DropdownMenuGroup>
              <DropdownMenuLabel>Attachments</DropdownMenuLabel>
              {attachments.map((attachment) => (
                <DropdownMenuItem
                  key={attachment.id}
                  className={ITEM}
                  onClick={() => openAttachment(attachment)}
                >
                  {attachment.type.startsWith("image/") ? (
                    <IconPhotoFilled
                      size={15}
                      className="text-muted-foreground"
                    />
                  ) : (
                    <IconPaperclip size={15} className="text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {attachment.name}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {lightbox && (
        <ImageLightbox
          src={lightbox.src}
          alt={lightbox.alt}
          open={lightboxOpen}
          onOpenChange={setLightboxOpen}
        />
      )}
    </>
  );
}
