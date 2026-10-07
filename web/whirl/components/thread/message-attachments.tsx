"use client";

import { useState } from "react";

import { formatSize } from "@whirl/lib/attachments";
import type { MessageAttachment } from "@whirl/lib/messages";
import { ImageLightbox } from "@whirl/components/ui/image-lightbox";
import { fileGlyph, fileLabel } from "../composer-attachments";

/* Read-only chips for attachments already sent with a message — the
   composer tray's chips minus the remove button and progress. Images show
   as thumbs (click for a large view), everything else as a flat file
   chip. */

function ImageThumb({ attachment }: { attachment: MessageAttachment }) {
  const [open, setOpen] = useState(false);
  if (!attachment.url) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={attachment.name}
        aria-label={`View ${attachment.name}`}
        className="block cursor-zoom-in"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- Convex storage URL */}
        <img
          src={attachment.url}
          alt={attachment.name}
          className="h-24 w-auto min-w-16 max-w-56 rounded-[14px] object-cover ring-1 ring-black/[0.06] dark:ring-white/[0.08]"
        />
      </button>
      <ImageLightbox
        src={attachment.url}
        alt={attachment.name}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

export function MessageAttachments({
  attachments,
}: {
  attachments: MessageAttachment[];
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {attachments.map((attachment) =>
        attachment.type.startsWith("image/") && attachment.url ? (
          <ImageThumb key={attachment.id} attachment={attachment} />
        ) : (
          <div
            key={attachment.id}
            className="flex w-52 items-center gap-2.5 rounded-2xl bg-black/[0.05] px-3 py-2 dark:bg-white/[0.06]"
          >
            {fileGlyph(
              attachment.name,
              attachment.type,
              "shrink-0 text-muted-foreground",
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px]/4.5 font-medium">
                {attachment.name}
              </div>
              <div className="mt-0.5 truncate text-[11.5px]/[14px] text-muted-foreground tabular-nums">
                {fileLabel(attachment.name, attachment.type)} ·{" "}
                {formatSize(attachment.size)}
              </div>
            </div>
          </div>
        ),
      )}
    </div>
  );
}
