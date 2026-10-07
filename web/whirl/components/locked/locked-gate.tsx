"use client";

import { IconLockFilled } from "@tabler/icons-react";
import { motion } from "motion/react";

import { Button } from "@whirl/components/ui/button";
import { requestUnlock } from "@whirl/lib/locked/lock-dialogs";
import { EASE_OUT, pinRasterPath, SHED_BLUR } from "@whirl/lib/motion";

/* What a locked thread shows a tab that hasn't got its key: nothing about
   the conversation, on purpose. No title, no first line, no message count —
   any of those would be the lock leaking through the door it's holding.

   Rising, not fading in from nowhere: the transcript's crossfade lands
   underneath this, and a still panel over a moving one reads as a stall. */

const RISE = {
  initial: { opacity: 0, y: 10, filter: "blur(6px)" },
  animate: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transitionEnd: SHED_BLUR,
  },
  transition: { duration: 0.28, ease: EASE_OUT },
  transformTemplate: pinRasterPath,
} as const;

export function LockedGate({ threadId }: { threadId: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <motion.div {...RISE} className="flex max-w-xs flex-col items-center text-center">
        <motion.span
          initial={{ scale: 0.75, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 400, damping: 24, delay: 0.04 }}
          className="text-foreground"
        >
          <IconLockFilled size={40} />
        </motion.span>
        <h2 className="mt-4 text-[16px] font-semibold tracking-tight">
          This chat is locked
        </h2>
        <p className="mt-1.5 text-[13px]/[1.55] text-muted-foreground">
          Enter your password to read this chat. Whirl does not keep a copy of
          your password.
        </p>
        <Button
          className="mt-5 h-10 w-full max-w-[13rem]"
          onClick={() => requestUnlock(threadId)}
        >
          Unlock
        </Button>
      </motion.div>
    </div>
  );
}
