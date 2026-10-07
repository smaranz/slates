"use client";

import { AnimatePresence, motion } from "motion/react";

import { pinRasterPath } from "@whirl/lib/motion";
import { MASK_TEXT } from "@whirl/lib/replay-guard";

/* Title treatment for generating threads: while the backend is naming the
   thread, the interim title (the user's prompt) shimmers; when the real
   title lands it rolls up into place as plain text. */
export function ThreadTitle({
  title,
  generating,
}: {
  title: string;
  generating: boolean;
}) {
  return (
    /* h matches the rows' 16px line box; old and new titles roll through
       it like a ticker (popLayout lifts the leaver out of flow). */
    <span className={`relative block h-4 overflow-hidden ${MASK_TEXT}`}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={title}
          initial={{ y: 16 }}
          animate={{ y: 0 }}
          exit={{ y: -16 }}
          transition={{ type: "spring", stiffness: 600, damping: 45 }}
          transformTemplate={pinRasterPath}
          /* The shimmer band reads --foreground; remap it to the chrome's
             soft ink so the sweep never flashes full black/white in the
             sidebar. */
          className={`block truncate ${
            generating
              ? "text-shimmer [--foreground:var(--foreground-soft)]"
              : ""
          }`}
        >
          {title}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
