"use client";

import { useEffect, useState } from "react";
import { IconGhost2, IconGhost2Filled } from "@tabler/icons-react";
import { useConvexAuth } from "@whirl/backend/react";
import { useMutation } from "@whirl/backend/react";
import { api } from "@whirl/backend/convex/_generated/api";
import { AnimatePresence, motion } from "motion/react";

import { useIncognitoActions, useIncognitoState } from "@whirl/lib/incognito";
import { pinRasterPath } from "@whirl/lib/motion";
import { ConfirmDialog } from "./confirm-dialog";

/* The ghost button floating in the home face's top-right corner — the
   same perch the thread toolbar uses once a thread opens, so the corner
   always holds exactly one cluster. Icon only: the ghost says it all.
   Off, it wears the toolbar pills' translucent well; on, it fills with
   primary ink so the mode reads at a glance. */

const BUTTON_BASE =
  "flex size-8 cursor-pointer items-center justify-center rounded-full transition-colors duration-150";

const IDLE_CLASS = `${BUTTON_BASE} bg-(--well-translucent) text-muted-foreground shadow-[inset_0_0_0_1px_var(--well-outline),inset_0_1px_0_0_var(--well-highlight)] backdrop-blur-xl hover:text-foreground`;

const ACTIVE_CLASS = `${BUTTON_BASE} bg-primary text-primary-foreground hover:bg-primary-hover`;

export function IncognitoToggle() {
  const { enabled, threadId } = useIncognitoState();
  const { enter, leave } = useIncognitoActions();
  const [confirming, setConfirming] = useState(false);

  /* Leaving mid-chat deletes it — that deserves a beat of hesitation.
     With nothing sent yet there's nothing to lose, so just slip out. */
  const requestExit = () => {
    if (threadId) setConfirming(true);
    else leave();
  };

  return (
    <>
      <motion.button
        type="button"
        onClick={() => (enabled ? requestExit() : enter())}
        whileTap={{ scale: 0.96 }}
        aria-pressed={enabled}
        aria-label={enabled ? "Leave incognito mode" : "Go incognito"}
        title={enabled ? "Leave incognito" : "Go incognito"}
        className={enabled ? ACTIVE_CLASS : IDLE_CLASS}
      >
        {/* Crossfade in place — both ghosts share the fixed box, and
            waiting out the exit would make the toggle feel laggy. */}
        <span className="relative size-[18px]">
          <AnimatePresence initial={false}>
            <motion.span
              key={enabled ? "on" : "off"}
              initial={{ opacity: 0, scale: 0.6, rotate: -12 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, scale: 0.6, rotate: 12 }}
              transition={{ type: "spring", stiffness: 520, damping: 28 }}
              transformTemplate={pinRasterPath}
              className="absolute inset-0 flex items-center justify-center"
            >
              {enabled ? (
                <IconGhost2Filled size={18} />
              ) : (
                <IconGhost2 size={18} stroke={2} />
              )}
            </motion.span>
          </AnimatePresence>
        </span>
      </motion.button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Leave incognito?"
        message="This chat was never saved — leaving deletes it for good."
        confirmLabel="Leave & delete"
        destructive
        onConfirm={leave}
      />
    </>
  );
}

/* Belt and braces: a hard refresh mid-incognito drops the store but not
   the flagged thread row. This sweeps all of the user's incognito threads
   once auth lands, so nothing ephemeral survives to a second session. */
export function IncognitoJanitor() {
  const { isAuthenticated } = useConvexAuth();
  const purge = useMutation(api.threads.purgeIncognito);
  useEffect(() => {
    if (!isAuthenticated) return;
    void purge({}).catch(() => {
      /* Offline or flaky — the next load tries again. */
    });
  }, [isAuthenticated, purge]);
  return null;
}
