"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  IconFile,
  IconFileCode,
  IconFileMusic,
  IconFileTypeDocx,
  IconFileTypePdf,
  IconFileTypePpt,
  IconFileTypeXls,
  IconFileZip,
  IconMovie,
  IconX,
  type Icon,
} from "@tabler/icons-react";

import {
  formatSize,
  getFileExtension,
  isTextAttachment,
} from "@whirl/lib/attachments";
import { EASE_OUT } from "@whirl/lib/motion";
import type { AttachmentDraft } from "@whirl/lib/use-attachments";

/* The composer's attachment tray — v1's chips redrawn flat for v2.
   Progress deliberately takes no layout space: file chips paint it as a
   background fill sweeping across the chip, images wear a hairline bar
   inside the thumb — and when an upload lands, the fill sweeps to 100%
   and evaporates in place. Chips never change size, so the pill never
   jumps when a bar retires. Red is reserved for failures. */

const CHIP_SPRING = {
  type: "spring",
  stiffness: 900,
  damping: 55,
  mass: 0.5,
} as const;

/* Sweep-to-done for the file chip's clipped background fill: on exit it
   finishes its run, then fades. Only safe where overflow is clipped —
   animating width on the image bar's inset-pinned track would push it
   past the thumb's edge. */
const FILL_EXIT = {
  width: "100%",
  opacity: 0,
  transition: {
    width: { duration: 0.15, ease: EASE_OUT },
    opacity: { delay: 0.15, duration: 0.3, ease: "linear" },
  },
} as const;

/* The image bar retires with a plain fade — by completion its fill is
   already at (or a frame from) 100%, so there's no run left to finish. */
const BAR_EXIT = {
  opacity: 0,
  transition: { delay: 0.1, duration: 0.3, ease: "linear" },
} as const;

export function ComposerAttachments({
  drafts,
  rejectionFor,
  onRemove,
}: {
  drafts: AttachmentDraft[];
  /** Model-relative validity, re-checked per render (a chip fine on Heavy
   *  may be rejected on Free). */
  rejectionFor: (draft: AttachmentDraft) => string | null;
  onRemove: (id: string) => void;
}) {
  return (
    /* pt/px clear the remove button's -1.5 overhang — the tray's reveal
       wrapper is overflow-hidden (it animates height), so anything poking
       past the padding gets shaved. */
    <div className="flex flex-wrap gap-2 px-2 pt-2 pb-2">
      <AnimatePresence mode="popLayout" initial={false}>
        {drafts.map((draft) => (
          <motion.div
            key={draft.id}
            layout
            initial={{ opacity: 0, scale: 0.9, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 6 }}
            transition={CHIP_SPRING}
          >
            <DraftChip
              draft={draft}
              rejection={rejectionFor(draft)}
              onRemove={() => onRemove(draft.id)}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function DraftChip({
  draft,
  rejection,
  onRemove,
}: {
  draft: AttachmentDraft;
  rejection: string | null;
  onRemove: () => void;
}) {
  const uploading = draft.status === "uploading";
  /* A document keeps the chip busy past 100% while the backend reads it, so
     the fill holds rather than snapping away and back. */
  const busy = uploading || draft.status === "reading";
  const error =
    draft.status === "error" ? (draft.error ?? "Upload failed.") : rejection;

  if (draft.previewUrl) {
    return (
      <div className="group/att relative w-fit" title={error ?? undefined}>
        {/* eslint-disable-next-line @next/next/no-img-element -- object URL preview */}
        <img
          src={draft.previewUrl}
          alt={draft.name}
          className={`h-14 w-auto min-w-14 max-w-40 rounded-[14px] object-cover ring-1 transition-opacity duration-200 ${
            error
              ? "ring-red-500/60"
              : "ring-black/[0.06] dark:ring-white/[0.08]"
          } ${uploading ? "opacity-70" : ""}`}
        />
        {/* Progress lives INSIDE the thumb, so its exit shifts nothing. */}
        <AnimatePresence initial={false}>
          {uploading && !error && (
            <motion.div
              key="bar"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={BAR_EXIT}
              className="absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded-full bg-black/30"
            >
              <motion.div
                className="h-full rounded-full bg-white"
                initial={false}
                animate={{
                  width: `${Math.max(6, Math.round(draft.progress * 100))}%`,
                }}
                transition={{ duration: 0.2, ease: EASE_OUT }}
              />
            </motion.div>
          )}
        </AnimatePresence>
        {error && (
          <div
            aria-hidden
            className="absolute inset-x-2 bottom-2 h-1 rounded-full bg-red-500/70"
          />
        )}
        <RemoveButton name={draft.name} onRemove={onRemove} />
      </div>
    );
  }

  return (
    <div className="group/att relative w-56">
      {/* Clipped underlay: the chip surface plus the progress fill that
          sweeps across it. The remove button overhangs the corner, so the
          clipping can't live on the chip itself. */}
      <div className="absolute inset-0 overflow-hidden rounded-2xl bg-black/[0.05] dark:bg-white/[0.06]">
        {error ? (
          <div className="absolute inset-0 bg-red-500/[0.06] dark:bg-red-500/[0.09]" />
        ) : (
          <AnimatePresence initial={false}>
            {busy && (
              <motion.div
                key="fill"
                className="absolute inset-y-0 left-0 bg-black/[0.05] dark:bg-white/[0.06]"
                initial={{ width: "0%", opacity: 1 }}
                animate={{
                  width: `${Math.max(6, Math.round(draft.progress * 100))}%`,
                }}
                exit={FILL_EXIT}
                transition={{ duration: 0.2, ease: EASE_OUT }}
              />
            )}
          </AnimatePresence>
        )}
      </div>
      <div className="relative flex items-center gap-2.5 px-3 py-2">
        {fileGlyph(
          draft.name,
          draft.type,
          `shrink-0 ${error ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`,
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px]/4.5 font-medium">
            {draft.name}
          </div>
          <div
            className={`mt-0.5 truncate text-[11.5px]/[14px] tabular-nums ${
              error
                ? "text-red-600 dark:text-red-400"
                : "text-muted-foreground"
            }`}
            title={error ?? undefined}
          >
            {error ??
              (uploading
                ? `Uploading · ${Math.round(draft.progress * 100)}%`
                : draft.status === "reading"
                  ? "Reading document…"
                  : fileSubtitle(draft))}
          </div>
        </div>
      </div>
      <RemoveButton name={draft.name} onRemove={onRemove} />
    </div>
  );
}

function RemoveButton({
  name,
  onRemove,
}: {
  name: string;
  onRemove: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Remove ${name}`}
      onClick={(event) => {
        event.stopPropagation();
        onRemove();
      }}
      className="absolute -top-1.5 -right-1.5 flex size-5 cursor-pointer items-center justify-center rounded-full bg-foreground text-background opacity-0 transition-opacity duration-150 group-hover/att:opacity-100 focus-visible:opacity-100"
    >
      <IconX size={11} stroke={2.5} />
    </button>
  );
}

/** "PDF · 2.3 MB"-style subtitle for a settled file chip. */
function fileSubtitle(draft: AttachmentDraft): string {
  return `${fileLabel(draft.name, draft.type)} · ${formatSize(draft.size)}`;
}

/* Monochrome cousin of v1's fileMeta — same icon picks, no color tints
   (the v2 palette stays zero-chroma; red is reserved for failures).
   Returns the element directly so no component is born mid-render.
   Exported for the thread view's sent-message chips. */
export function fileGlyph(name: string, type: string, className: string) {
  const ext = getFileExtension(name);
  const t = type.toLowerCase();
  const pick = (): Icon => {
    if (t === "application/pdf" || ext === "pdf") return IconFileTypePdf;
    if (["doc", "docx", "odt", "rtf"].includes(ext)) return IconFileTypeDocx;
    if (["xls", "xlsx", "ods"].includes(ext) || t.includes("spreadsheet"))
      return IconFileTypeXls;
    if (["ppt", "pptx", "odp"].includes(ext) || t.includes("presentation"))
      return IconFileTypePpt;
    if (t.startsWith("video/")) return IconMovie;
    if (t.startsWith("audio/")) return IconFileMusic;
    if (["zip", "rar", "7z", "tar", "gz"].includes(ext) || t.includes("zip"))
      return IconFileZip;
    if (isTextAttachment({ name, type })) return IconFileCode;
    return IconFile;
  };
  const IconComponent = pick();
  return <IconComponent size={20} stroke={1.8} className={className} />;
}

export function fileLabel(name: string, type: string): string {
  const ext = getFileExtension(name);
  const t = type.toLowerCase();
  if (t === "application/pdf" || ext === "pdf") return "PDF";
  if (["doc", "docx", "odt"].includes(ext)) return "Document";
  if (["xls", "xlsx", "ods"].includes(ext) || t.includes("spreadsheet"))
    return "Spreadsheet";
  if (["ppt", "pptx", "odp"].includes(ext) || t.includes("presentation"))
    return "Presentation";
  if (t.startsWith("video/")) return "Video";
  if (t.startsWith("audio/")) return "Audio";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "Archive";
  return ext ? ext.toUpperCase() : "File";
}
