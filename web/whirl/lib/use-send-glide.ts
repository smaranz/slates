"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { animate, type AnimationPlaybackControls } from "motion/react";

import type { ChatMessage } from "@whirl/lib/messages";
import { EASE_OUT } from "@whirl/lib/motion";

/* When a fresh user turn lands, the message scroller anchors it to the top
   of the viewport with an instant jump — the primitive scrolls inside a
   MutationObserver microtask and exposes no way to animate it. This hook
   turns the jump into a glide: it lets the jump happen, then (in its own
   microtask, queued behind the primitive's, still before paint) reads the
   landing spot off the viewport, rewinds to where the reader was, and
   drives scrollTop there on an eased tween.

   While the glide runs, the reply is usually already streaming, and every
   streamed chunk resizes the transcript — which makes the scroller
   re-assert its landing spot with an instant scrollTop write. Those writes
   must not end the glide (they're re-statements of where it's headed, not
   the reader taking over), so a mid-flight foreign write is adopted as the
   new target and the tween keeps going. Only real input on the viewport —
   a wheel flick, a touch, grabbing the scrollbar, a scroll key — hands
   control back to the reader and stops the glide where it is. */

const MIN_GLIDE_S = 0.35;
const MAX_GLIDE_S = 0.6;
/* Longer jumps take proportionally longer, inside the clamp above. */
const GLIDE_PX_PER_S = 1600;

/* Genuine reader input on the viewport — anything here cancels the glide.
   Scroll writes are deliberately absent: the glide itself and the
   scroller's re-anchors both move scrollTop without the reader's hand. */
const READER_INPUT_EVENTS = [
  "wheel",
  "touchstart",
  "pointerdown",
  "keydown",
] as const;

export function useSendGlide(
  messages: ChatMessage[] | undefined,
  viewport: RefObject<HTMLDivElement | null>,
) {
  let lastUserId: string | null = null;
  if (messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        lastUserId = messages[i].id;
        break;
      }
    }
  }

  /* Only a user turn that appears after the first loaded commit counts as
     a send — opening a thread stays an instant placement. The latch lives
     in the layout effect below rather than in render, because a render
     React discards would still move it, and a swallowed turn id is a send
     that never glides. */
  const seenRef = useRef<string | null | undefined>(undefined);

  /* Stops the running glide and detaches its listeners. */
  const glideRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    /* Still loading — latch nothing, or the loaded thread's last turn
       would read as a fresh send. */
    if (messages === undefined) return;
    if (seenRef.current === undefined) {
      seenRef.current = lastUserId;
      return;
    }
    if (lastUserId === seenRef.current) return;
    seenRef.current = lastUserId;

    const el = viewport.current;
    if (!el) return;

    glideRef.current?.();
    const startTop = el.scrollTop;

    queueMicrotask(() => {
      let targetTop = el.scrollTop;
      if (Math.abs(targetTop - startTop) < 2) return;
      el.scrollTop = startTop;
      /* Read back after every write — the browser quantizes scrollTop, and
         the foreign-write check below compares against what actually stuck. */
      let written = el.scrollTop;

      let controls: AnimationPlaybackControls | null = null;
      const detach = () => {
        for (const type of READER_INPUT_EVENTS)
          el.removeEventListener(type, stop);
        if (glideRef.current === stop) glideRef.current = null;
      };
      const stop = () => {
        detach();
        controls?.stop();
      };

      controls = animate(0, 1, {
        duration: Math.min(
          MAX_GLIDE_S,
          Math.max(
            MIN_GLIDE_S,
            Math.abs(targetTop - startTop) / GLIDE_PX_PER_S,
          ),
        ),
        ease: EASE_OUT,
        onUpdate: (progress) => {
          if (Math.abs(el.scrollTop - written) > 2) {
            /* The scroller re-asserted where this send lands (a re-anchor
               after streamed growth) — adopt it and keep gliding. */
            targetTop = el.scrollTop;
          }
          el.scrollTop = startTop + (targetTop - startTop) * progress;
          written = el.scrollTop;
        },
        onComplete: detach,
      });
      for (const type of READER_INPUT_EVENTS)
        el.addEventListener(type, stop, { passive: true });
      glideRef.current = stop;
    });
  });

  /* A glide mid-flight when the thread face unmounts would keep writing to
     a detached node — stop it with the component. */
  useEffect(() => () => glideRef.current?.(), []);
}
