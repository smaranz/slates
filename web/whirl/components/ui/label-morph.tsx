"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { SHED_BLUR } from "@whirl/lib/motion";

const VERB_INTERVAL_MS = 3000;

function pick(verbs: string[], avoid?: string) {
  if (verbs.length <= 1) return verbs[0] ?? "";
  let next = verbs[Math.floor(Math.random() * verbs.length)];
  if (next === avoid) {
    next = verbs[(verbs.indexOf(next) + 1) % verbs.length];
  }
  return next;
}

/**
 * A verb from the pool that reshuffles every couple of seconds — and jumps
 * to a fresh pick the moment the pool itself changes, so the switch reads
 * immediately.
 */
export function useRotatingVerb(verbs: string[]) {
  const [verb, setVerb] = useState(() => pick(verbs));
  /* What the interval last picked, so the next tick can avoid repeating it
     without re-arming the interval on every change. Every write goes
     through `show` below — mirroring state during render instead would
     move on renders React never commits. */
  const verbRef = useRef(verb);
  const mounted = useRef(false);

  useEffect(() => {
    const show = (next: string) => {
      verbRef.current = next;
      setVerb(next);
    };
    if (mounted.current) show(pick(verbs));
    mounted.current = true;

    const id = setInterval(
      () => show(pick(verbs, verbRef.current)),
      VERB_INTERVAL_MS,
    );
    return () => clearInterval(id);
  }, [verbs]);

  return verb;
}

/**
 * A text slot that animates *every* change of its `text` — a y+blur swap,
 * so a rotating verb settling into a finalized label flows instead of
 * cutting. `shimmer` runs the looping sheen while work is in flight.
 */
export function LabelMorph({
  text,
  shimmer = false,
  ellipsis = false,
  className = "text-[13.5px]/5",
}: {
  text: string;
  shimmer?: boolean;
  /** Trailing "…" rendered aria-hidden so screen readers skip it. */
  ellipsis?: boolean;
  className?: string;
}) {
  return (
    <span className={`relative inline-flex ${className}`}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={text}
          initial={{ opacity: 0, y: 8, filter: "blur(5px)" }}
          animate={{
            opacity: 1,
            y: 0,
            filter: "blur(0px)",
            transitionEnd: SHED_BLUR,
          }}
          exit={{ opacity: 0, y: -8, filter: "blur(5px)" }}
          transition={{
            opacity: { duration: 0.26, ease: [0.22, 0.61, 0.36, 1] },
            filter: { duration: 0.26, ease: [0.22, 0.61, 0.36, 1] },
            y: { type: "spring", stiffness: 520, damping: 34 },
          }}
          className={`inline-block whitespace-nowrap ${
            shimmer ? "text-shimmer" : ""
          }`}
        >
          {text}
          {ellipsis && <span aria-hidden>…</span>}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
