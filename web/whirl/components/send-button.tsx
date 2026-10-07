"use client";

import {
  IconArrowUp,
  IconLoader2,
  IconMicrophoneFilled,
  IconPlayerStopFilled,
  IconPlaylistAdd,
} from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";

import { pinRasterPath } from "@whirl/lib/motion";
import { SquishButton } from "./squish-button";

/* The composer's action button: one persistent pill that wears several
   faces — voice (microphone), send (arrow), sending (spinner), stop
   (square), queue (list-plus) — and morphs between them on a quick
   pop-through crossfade instead of a hard swap. The button itself never
   remounts, so the press physics and glaze stay continuous while the icon
   changes hands.

   An empty composer wears the microphone: with nothing to send, the button's
   job is to start listening. The first character typed hands it back. The
   same rule while a reply is running: empty means Stop, and the first
   character turns it into Queue — the draft goes when the reply settles. */

export type SendButtonState =
  | "voice"
  | "send"
  | "sending"
  | "compacting"
  | "stop"
  | "queue";

const LABELS: Record<SendButtonState, string> = {
  voice: "Start voice input",
  send: "Send message",
  sending: "Sending message",
  compacting: "Compacting context",
  stop: "Stop generating",
  queue: "Queue message",
};

const ICON_POP = {
  initial: { opacity: 0, scale: 0.4 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.4 },
  transition: {
    opacity: { duration: 0.12, ease: "linear" },
    scale: { type: "spring", stiffness: 600, damping: 32 },
  },
} as const;

export function SendButton({
  state,
  canSend,
  onSend,
  onStop,
  onQueue,
  onVoice,
}: {
  state: SendButtonState;
  canSend: boolean;
  onSend: () => void;
  onStop?: () => void;
  /** Only reached in the "queue" state. */
  onQueue?: () => void;
  /** Only reached in the "voice" state — see the composer for when it's worn. */
  onVoice?: () => void;
}) {
  return (
    <SquishButton
      aria-label={LABELS[state]}
      title={state === "queue" ? "Sends when the reply finishes" : undefined}
      disabled={
        state === "sending" ||
        state === "compacting" ||
        ((state === "send" || state === "queue") && !canSend)
      }
      onClick={
        state === "stop"
          ? onStop
          : state === "queue"
            ? onQueue
            : state === "voice"
              ? onVoice
              : onSend
      }
      className={`relative size-9 shrink-0 justify-center rounded-full p-0 transition-[background-color,scale,opacity] disabled:pointer-events-none ${
        /* While the send is in flight the spinner stays full-strength —
           the button is working, not unavailable. */
        state === "send" || state === "queue" ? "disabled:opacity-40" : ""
      }`}
    >
      <AnimatePresence initial={false}>
        <motion.span
          key={state}
          {...ICON_POP}
          transformTemplate={pinRasterPath}
          className="absolute inset-0 flex items-center justify-center"
        >
          {state === "stop" ? (
            <IconPlayerStopFilled size={15} />
          ) : state === "queue" ? (
            <IconPlaylistAdd size={18} stroke={2.25} />
          ) : state === "sending" || state === "compacting" ? (
            <IconLoader2 size={18} className="animate-spin" />
          ) : state === "voice" ? (
            <IconMicrophoneFilled size={17} />
          ) : (
            <IconArrowUp size={18} stroke={2.5} />
          )}
        </motion.span>
      </AnimatePresence>
    </SquishButton>
  );
}
