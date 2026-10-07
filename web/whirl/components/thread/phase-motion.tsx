"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { TextMorph } from "torph/react";

import { EASE_OUT } from "@whirl/lib/motion";

const PHASE_SHIMMER_DURATION_MS = 720;

/** Torph mutates one mounted label across activity changes. The shimmer stays
 * on that root, so changing its words never restarts the animation clock. */
export function PhaseLabel({
  text,
  shimmer = false,
  ellipsis = false,
  className = "",
}: {
  text: string;
  shimmer?: boolean;
  ellipsis?: boolean;
  className?: string;
}) {
  const slotRef = useRef<HTMLSpanElement>(null);

  /* Torph adds and removes character spans while it morphs. Attach each new
     glyph to the same document-timeline position before the next paint, rather
     than letting a fresh CSS animation restart from the beginning. */
  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (
      !slot ||
      !shimmer ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const animations = new Map<
      HTMLElement,
      { animation: Animation; geometry: string }
    >();
    const synchronizeCurrentGlyphs = () => {
      const root = slot.querySelector<HTMLElement>("[torph-root]");
      if (!root) return;
      const width = root.offsetWidth;
      if (width <= 0) return;

      const timelinePosition =
        performance.now() % PHASE_SHIMMER_DURATION_MS;
      const currentGlyphs = new Set(
        root.querySelectorAll<HTMLElement>("[torph-item]"),
      );

      /* Read every offset first, THEN write. Interleaved, each glyph's
         `offsetLeft` had to flush the style written for the glyph before
         it — one forced layout per character, on a label that re-morphs
         through here for every phase update while a reply streams. Two
         clean passes cost one layout total. */
      const measured: { glyph: HTMLElement; offset: number }[] = [];
      for (const glyph of currentGlyphs) {
        const offset = glyph.offsetLeft;
        const geometry = `${width}:${offset}`;
        if (animations.get(glyph)?.geometry === geometry) continue;
        measured.push({ glyph, offset });
      }

      for (const { glyph, offset } of measured) {
        animations.get(glyph)?.animation.cancel();

        /* Reconstruct the root's 250%-wide text gradient inside every
           character, offsetting it by that character's position so the
           pieces read as one uninterrupted band. */
        glyph.style.backgroundSize = `${width * 2.5}px 100%`;
        const animation = glyph.animate(
          [
            { backgroundPosition: `${-1.5 * width - offset}px 0` },
            { backgroundPosition: `${-offset}px 0` },
          ],
          {
            duration: PHASE_SHIMMER_DURATION_MS,
            iterations: Infinity,
            easing: "linear",
          },
        );
        animation.currentTime = timelinePosition;
        animations.set(glyph, { animation, geometry: `${width}:${offset}` });
      }

      for (const [glyph, entry] of animations) {
        if (currentGlyphs.has(glyph)) continue;
        entry.animation.cancel();
        animations.delete(glyph);
      }
    };

    synchronizeCurrentGlyphs();
    let disposed = false;
    let frame = 0;
    const scheduleSynchronization = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(synchronizeCurrentGlyphs);
    };
    queueMicrotask(() => {
      if (!disposed) scheduleSynchronization();
    });

    const observer = new MutationObserver(() => {
      scheduleSynchronization();
    });
    observer.observe(slot, { childList: true, subtree: true });
    slot.addEventListener("transitionend", scheduleSynchronization);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      slot.removeEventListener("transitionend", scheduleSynchronization);
      for (const entry of animations.values()) entry.animation.cancel();
    };
  }, [shimmer]);

  return (
    <span
      ref={slotRef}
      className={`relative inline-flex min-w-0 shrink-0 overflow-hidden ${className}`}
    >
      <TextMorph
        as="span"
        duration={280}
        ease="cubic-bezier(0.22, 1, 0.36, 1)"
        scale={false}
        className={`inline-block max-w-full whitespace-normal break-words ${shimmer ? "text-shimmer" : ""}`}
      >
        {text}
      </TextMorph>
      {ellipsis && (
        <span
          aria-hidden
          className={shimmer ? "text-muted-foreground/50" : undefined}
        >
          …
        </span>
      )}
    </span>
  );
}

/** Fixed-size icon stage: phase glyphs and integration marks cross through
 * the same coordinates, so neither late branding nor a new tool moves text. */
export function PhaseIcon({
  iconKey,
  children,
}: {
  iconKey: string;
  children: ReactNode;
}) {
  return (
    <span
      aria-hidden
      className="relative flex size-5 shrink-0 items-center justify-center text-muted-foreground"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={iconKey}
          initial={{ opacity: 0, scale: 0.72, rotate: -16 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          exit={{ opacity: 0, scale: 0.72, rotate: 16 }}
          transition={{ duration: 0.1, ease: EASE_OUT }}
          className="absolute inset-0 flex items-center justify-center"
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** The supplied animated mark is the spinner itself; its opacity stays steady
 * while the neighboring label carries the traveling shimmer. */
export function WhirlActivityIcon() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/whirl/whirl-animate.svg"
      alt=""
      draggable={false}
      className="size-[26px] max-w-none dark:invert"
    />
  );
}
