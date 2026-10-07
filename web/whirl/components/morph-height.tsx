"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { motion } from "motion/react";

const HEIGHT_SPRING = { type: "spring", stiffness: 320, damping: 32 } as const;

/**
 * Where the capsule's height is heading, and where from.
 *
 * `to: null` hands the height back to the content (`auto`). `from` is set
 * only when the origin can't be read off the element — springing out of
 * `auto`, where the content is already sitting at its new size, so the
 * height being left behind has to go to motion as an explicit keyframe.
 */
type Morph = { from: number | null; to: number | null; spring: boolean };

/** Unclamped: the content's own height is the capsule's height. */
const REST: Morph = { from: null, to: null, spring: false };

/**
 * A wrapper that spring-animates to its content's natural height: swapping
 * the content (e.g. a modal's steps) resizes smoothly instead of snapping.
 *
 * At rest it holds no height of its own, so a fresh mount always paints at
 * natural height — it can never flash a stale size, and the first
 * measurement has nothing to animate. Only real changes after that spring.
 * Callers rendering different "documents" through one instance (a modal
 * reused across listings) should pass a `key` so each starts fresh.
 */
export function MorphHeight({
  children,
  selfSizing = false,
}: {
  children: React.ReactNode;
  /** Set while the content animates its own height (the composer's textarea
   *  grows on its own spring). Chasing that with a second, slower spring
   *  only ever runs behind it, and `overflow-hidden` clips whatever the
   *  content is already showing — a newline in the composer cut the controls
   *  row off and slid it back over ~250ms. So while this is set the capsule
   *  keeps out of the way and the content's own spring is the only one
   *  running. Swaps still morph: flipping this springs from the outgoing
   *  face's height to the incoming one, then hands the height back. */
  selfSizing?: boolean;
}) {
  const [morph, setMorph] = useState<Morph>(REST);

  /* The height the last measurement saw — springing out of `auto` starts
     from it. A ref, so tracking it costs no render. */
  const measured = useRef(0);
  const selfSizingRef = useRef(selfSizing);
  const swapping = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  /* Hand the mode to the observer, and flag that the next measurement is a
     different face rather than the same content having grown. Declared above
     the measuring effect so it always lands first in the same commit. */
  useLayoutEffect(() => {
    selfSizingRef.current = selfSizing;
    swapping.current = true;
  }, [selfSizing]);

  const sync = useCallback((swap: boolean) => {
    const node = contentRef.current;
    if (!node) return;
    const to = node.offsetHeight;
    const previous = measured.current;
    measured.current = to;

    setMorph((current) => {
      if (current.to === to) return current;

      /* Self-sizing content owns its height — but only once the capsule has
         actually handed it back. A clamp still in place (`to` set) means a
         swap is mid-settle, and the composer lives in that window: the
         incoming message bar is measured in the swap's own commit, but its
         real height isn't known until the composer's measurement pass — which
         runs after this one, being the parent — settles `textHeight` and the
         controls-row margin, and those then animate on their own spring.
         Holding that first measurement through all of it is how the pill
         ended up a controls row short of itself, cropping its own buttons. */
      const settling = current.to !== null;
      if (selfSizingRef.current && !swap) {
        if (!settling) return current;
        /* Content that is GROWING gets tracked exactly, not chased. A second
           spring running behind the content's own is a gap between the two,
           and that gap is precisely what `overflow-hidden` crops. Taking the
           height as-is ends the animation, which hands the capsule back to
           `auto` — the content owning its height, which is where a
           self-sizing face is supposed to end up anyway. */
        if (to > (current.to ?? 0)) return { from: null, to, spring: false };
        /* Shrinking can lag safely — nothing crops — so it stays smooth. */
        return { from: null, to, spring: true };
      }

      /* Already clamped, so motion reads the origin off the element and
         springs from wherever it currently is. */
      if (settling) return { from: null, to, spring: true };
      /* Unclamped, and the swap has already landed at its new size — the
         height being left behind goes in as the first keyframe. On the very
         first measurement there's no such height, and nothing worth
         animating: stay out of the way. */
      if (!(previous > 0)) return current;
      /* Pin the outgoing height on the element itself, right now. React will
         flush this update before paint, but motion doesn't pick the keyframe
         up until it runs its own effects — and the one frame in between is a
         frame painted at the incoming face's full height. That frame is the
         pop: the pill jumps to the new size, snaps back, then springs. One
         synchronous write, the same value motion is about to animate from,
         and there is nothing left to see. */
      if (containerRef.current) {
        containerRef.current.style.height = `${previous}px`;
      }
      return { from: previous, to, spring: true };
    });
  }, []);

  /* Every render, before paint. A React-driven height change (a face swap, a
     step change) is measured and clamped in the same commit that caused it,
     which is what keeps the wrong height off the screen. The observer below
     is left to cover what React can't see coming. */
  useLayoutEffect(() => {
    const swap = swapping.current;
    swapping.current = false;
    /* Don't even force the layout read while the content owns its height and
       the capsule is out of the way — this runs on every keystroke in the
       composer. A clamp still in place means a swap is settling, and that has
       to keep being measured. No dep array, so `morph` here is always the
       current one. */
    if (selfSizingRef.current && !swap && morph.to === null) return;
    sync(swap);
  });

  const observerRef = useRef<ResizeObserver | null>(null);
  const measureRef = useCallback(
    (node: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      contentRef.current = node;
      if (!node) return;
      /* Height changes React never rendered: a font landing, an image
         decoding, a textarea dragged by its grip. */
      const observer = new ResizeObserver(() => sync(false));
      observer.observe(node);
      observerRef.current = observer;
    },
    [sync],
  );

  return (
    <motion.div
      ref={containerRef}
      initial={false}
      animate={{
        height:
          morph.to === null
            ? "auto"
            : morph.from === null
              ? morph.to
              : [morph.from, morph.to],
      }}
      transition={morph.spring ? HEIGHT_SPRING : { duration: 0 }}
      onAnimationComplete={() => {
        /* The swap has landed — hand the height back so self-sizing content
           can grow on its own spring again. */
        if (selfSizing && morph.to !== null) setMorph(REST);
      }}
      className="overflow-hidden"
    >
      {/* `relative` anchors absolutely-exiting children during swaps. */}
      <div ref={measureRef} className="relative">
        {children}
      </div>
    </motion.div>
  );
}
