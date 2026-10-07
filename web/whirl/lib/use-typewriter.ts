"use client";

import { startTransition, useEffect, useState } from "react";

import { usePageVisible } from "./page-visibility";

/* Network chunks land in bursts; revealing them verbatim makes streamed
   text lurch. This meters the reveal (same curve as the main app): every
   tick shows an eighth of what's outstanding, clamped to 1..64 chars, so
   the tail types briskly after a big burst and settles to a gentle drip
   as it catches up.

   `animate` false renders the full text immediately — messages that were
   already complete when the thread opened never type themselves out. */

const TICK_MS = 28;
const MAX_STEP = 64;

/* Every tick re-renders the whole turn, and Streamdown re-lexes the entire
   message body to find its blocks — work that grows with the reply while the
   tick rate stayed flat, so a long answer spent more and more of each second
   re-reading what it had already written. Long replies tick less often and
   reveal proportionally more each time: the same characters per second, a
   fraction of the renders. Reading speed doesn't change; only the frame rate
   of the reveal does, and by the time it drops there is far too much text on
   screen for anyone to be watching a single character land. */
function cadenceFor(length: number): { tickMs: number; scale: number } {
  const tickMs = length < 6_000 ? TICK_MS : length < 20_000 ? 56 : 96;
  return { tickMs, scale: tickMs / TICK_MS };
}

export function useTypewriter(
  sourceText: string,
  animate: boolean,
  halted = false,
): { text: string; caughtUp: boolean } {
  const [visibleCount, setVisibleCount] = useState(() =>
    animate ? 0 : sourceText.length,
  );

  /* A reply arriving in a tab nobody is looking at gets handed over whole.
     Metering it out costs a re-render — and a full re-read of the message —
     every tick, for an animation with no audience, and the backlog it
     builds is exactly what makes a tab feel wrecked on the way back in.
     Catching up while hidden also means there's nothing left to replay when
     it returns: the text is simply there. */
  const visible = usePageVisible();
  if (!visible && visibleCount < sourceText.length) {
    setVisibleCount(sourceText.length);
  }

  /* A retried message starts a fresh, shorter stream — never point past
     the end of the new text. */
  const clamped = Math.min(visibleCount, sourceText.length);
  const caughtUp = clamped >= sourceText.length;
  const [haltedAt, setHaltedAt] = useState<number | null>(null);

  /* Capture the painted character count on the render that observes Stop.
     Later persisted chunks may still arrive while the backend winds down;
     they must never move this boundary. */
  if (halted && haltedAt === null) setHaltedAt(clamped);
  if (!halted && haltedAt !== null) setHaltedAt(null);

  useEffect(() => {
    if (!animate || halted || caughtUp || !visible) return;
    const { tickMs, scale } = cadenceFor(sourceText.length);
    const id = setInterval(() => {
      startTransition(() => {
        setVisibleCount((count) => {
          const current = Math.min(count, sourceText.length);
          const remaining = sourceText.length - current;
          if (remaining <= 0) return count;
          const step = Math.ceil((remaining * scale) / 8);
          return current + Math.min(MAX_STEP * scale, Math.max(1, step));
        });
      });
    }, tickMs);
    return () => clearInterval(id);
  }, [sourceText, animate, halted, caughtUp, visible]);

  if (!animate) return { text: sourceText, caughtUp: true };
  if (halted) {
    return {
      text: sourceText.slice(0, haltedAt ?? clamped),
      caughtUp: true,
    };
  }
  return { text: sourceText.slice(0, clamped), caughtUp };
}
