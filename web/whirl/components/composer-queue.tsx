"use client";

import { IconX } from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";

import type { MessageAttachment } from "@whirl/lib/messages";
import { MASK_TEXT } from "@whirl/lib/replay-guard";

/* The stack of messages waiting behind the running reply, worn by the
   composer pill above the text — where the next thing to go out belongs.
   Each row is one queued message: its place in line, one line of its
   words, and an × to take it back. Rows grow in and shrink out on the
   pill's own height spring, so the capsule reshapes with them instead of
   jumping. */

export type QueuedTurn = {
  id: string;
  content: string;
  attachments?: MessageAttachment[];
};

/* Same spring the composer's text box and tray morph on. */
const ROW_SPRING = {
  type: "spring",
  stiffness: 1100,
  damping: 60,
  mass: 0.45,
} as const;

const ROW = {
  initial: { height: 0, opacity: 0 },
  animate: { height: "auto", opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: {
    height: ROW_SPRING,
    opacity: { duration: 0.15, ease: "linear" },
  },
} as const;

/* A message that is only files shows what it carries. */
function rowLabel(item: QueuedTurn) {
  if (item.content.length > 0) return item.content;
  const files = item.attachments ?? [];
  if (files.length === 1) return files[0].name;
  return `${files.length} files`;
}

export function ComposerQueue({
  items,
  onRemove,
}: {
  items: QueuedTurn[];
  /** Absent — fixtures, read-only hosts — hides the ×. */
  onRemove?: (item: QueuedTurn) => void;
}) {
  return (
    /* Masked like the transcript: queued words are chat content. Keyed
       on place + words rather than id so the optimistic row and the
       server's echo are one node — an id swap would replay the grow-in. */
    <div className={`flex flex-col px-1 pt-1 ${MASK_TEXT}`}>
      <AnimatePresence initial={false}>
        {items.map((item, index) => (
          <motion.div
            key={`${index}:${item.content}`}
            {...ROW}
            className="overflow-hidden"
          >
            <div className="flex h-8 items-center gap-2 rounded-xl pr-1 pl-2 text-[13.5px]/4 text-muted-foreground">
              <span
                aria-label={`Queued, ${index + 1} of ${items.length}`}
                className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-black/[0.06] text-[10.5px]/none font-semibold tabular-nums dark:bg-white/[0.09]"
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate">{rowLabel(item)}</span>
              {onRemove && (
                <button
                  type="button"
                  aria-label="Remove from queue"
                  title="Remove from queue"
                  onClick={() => onRemove(item)}
                  className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors duration-150 hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.06]"
                >
                  <IconX size={14} />
                </button>
              )}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
