"use client";

import {
  IconAlertTriangleFilled,
  IconArrowUp,
  IconLoader2,
  IconMicrophoneFilled,
  IconX,
} from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";

import { pinRasterPath } from "@whirl/lib/motion";
import type { VoiceInput, VoiceStatus } from "@whirl/lib/use-voice-input";
import { SquishButton } from "./squish-button";
import { VoiceWaveform } from "./voice-waveform";

/* The composer wearing its listening face. Three states share one pill:
   asking for the mic, hearing you, and turning what it heard into words. They
   crossfade inside the composer's own MorphHeight, so the capsule springs
   between a tall permission prompt and a single listening row.

   Everything here is monochrome on purpose — a recording indicator is the one
   place a red dot would be conventional, and whirl doesn't do accent hues. */

/* Same crossfade the composer uses between its own faces. */
const SWAP = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.14, ease: "linear" },
} as const;

/* The permission prompt and the error share a shape: big glyph, a line, a
   button. Which of the three faces is on screen. */
type Face = "permission" | "listening" | "trouble";

function faceFor(status: VoiceStatus): Face {
  if (status === "denied" || status === "error") return "trouble";
  /* "opening" belongs here, not on the permission face: the mic is already
     granted and the device is just warming up. The waveform sits flat for the
     moment that takes, which reads as listening — because it is. */
  if (
    status === "opening" ||
    status === "recording" ||
    status === "processing"
  ) {
    return "listening";
  }
  return "permission";
}

function formatElapsed(ms: number) {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/* A round icon button in the pill's own idiom — same size and press physics
   as the send button, quieter by default. */
function RoundButton({
  label,
  onClick,
  disabled = false,
  variant = "quiet",
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "quiet" | "primary";
  children: React.ReactNode;
}) {
  if (variant === "primary") {
    return (
      <SquishButton
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        className="size-9 shrink-0 justify-center rounded-full p-0 transition-[background-color,scale,opacity] disabled:pointer-events-none disabled:opacity-40"
      >
        {children}
      </SquishButton>
    );
  }
  /* Deliberately the plus button's exact recipe, `raised` included: this one
     stands where the plus was standing a moment ago, so it should read as the
     same button having changed its mind. */
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="raised flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border bg-surface text-muted-foreground transition-[background-color,color,scale] duration-150 hover:text-foreground active:scale-95 disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function VoiceFace({ voice }: { voice: VoiceInput }) {
  const { status, error, elapsedMs, analyserRef, grant, stop, cancel } = voice;
  const face = faceFor(status);

  return (
    <div className="relative p-2">
      <AnimatePresence mode="popLayout" initial={false}>
        {face === "listening" ? (
          <motion.div
            key="listening"
            {...SWAP}
            transformTemplate={pinRasterPath}
            /* No extra padding: the row's own p-2 puts this X exactly where
               the plus button sits on the message bar, so the swap lands it
               on the same pixel instead of nudging it inward. */
            className="flex items-center gap-3"
          >
            <RoundButton label="Discard recording" onClick={cancel}>
              <IconX size={17} stroke={2.2} />
            </RoundButton>
            <VoiceWaveform
              analyserRef={analyserRef}
              paused={status === "processing"}
            />
            {status === "processing" ? (
              <div className="flex shrink-0 items-center gap-2 pr-1 text-sm text-muted-foreground">
                <IconLoader2 size={16} className="animate-spin" />
                <span>Transcribing…</span>
              </div>
            ) : (
              <>
                <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                  {formatElapsed(elapsedMs)}
                </span>
                <RoundButton
                  label="Finish recording"
                  onClick={stop}
                  /* Nothing to finish until the device is actually open. */
                  disabled={status === "opening"}
                  variant="primary"
                >
                  <IconArrowUp size={18} stroke={2.5} />
                </RoundButton>
              </>
            )}
          </motion.div>
        ) : face === "trouble" ? (
          <motion.div
            key="trouble"
            {...SWAP}
            transformTemplate={pinRasterPath}
            className="flex flex-col items-center gap-3 px-6 py-6 text-center"
          >
            <IconAlertTriangleFilled
              size={26}
              className="text-muted-foreground"
            />
            <p className="max-w-sm text-sm text-muted-foreground">
              {error ?? "Voice input didn't work. Try again?"}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={cancel}
                className="cursor-pointer rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm font-medium text-muted-foreground transition-[background-color,color,scale] duration-150 hover:text-foreground active:scale-[0.97]"
              >
                Close
              </button>
              {/* A browser-level block can't be undone from here, so retrying
                  would just fail again — that face only offers the way out. */}
              {status !== "denied" && (
                <SquishButton
                  onClick={grant}
                  className="rounded-full px-3.5 py-1.5"
                >
                  Try again
                </SquishButton>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="permission"
            {...SWAP}
            transformTemplate={pinRasterPath}
            className="relative flex flex-col items-center gap-3 px-6 py-6 text-center"
          >
            <button
              type="button"
              aria-label="Cancel voice input"
              onClick={cancel}
              className="absolute top-0 right-0 flex size-8 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-[background-color,color,scale] duration-150 hover:bg-accent hover:text-foreground active:scale-95"
            >
              <IconX size={16} stroke={2.2} />
            </button>
            {/* The one moment the microphone gets to be the whole composer. */}
            <motion.div
              animate={{ scale: status === "requesting" ? [1, 1.06, 1] : 1 }}
              transition={
                status === "requesting"
                  ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" }
                  : { type: "spring", stiffness: 400, damping: 26 }
              }
              transformTemplate={pinRasterPath}
              className="flex size-14 items-center justify-center rounded-full bg-accent text-foreground-soft"
            >
              <IconMicrophoneFilled size={26} />
            </motion.div>
            {/* Two audiences share this face. Someone who has never granted
                the mic is being asked to; someone who granted it long ago is
                only here for the moment it takes to warm up, and telling them
                to grant it again would be a lie. */}
            <div className="space-y-1">
              <p className="text-[15px] font-medium">
                {status === "requesting"
                  ? "Waiting on your browser"
                  : "Grant permission"}
              </p>
              <p className="text-sm text-muted-foreground">
                {status === "requesting"
                  ? "Allow microphone access to keep going."
                  : "Whirl needs your microphone to hear you."}
              </p>
            </div>
            {status !== "requesting" && (
              <SquishButton onClick={grant} className="rounded-full px-4 py-1.5">
                Allow microphone
              </SquishButton>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
