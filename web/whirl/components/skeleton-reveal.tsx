"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@whirl/lib/utils";

/* Transitions.dev skeleton loader and reveal — the t-skel rules live in
   globals.css; this owns the class choreography. While `revealed` is false
   the skeleton layer pulses; flipping it true cross-fades + un-blurs the
   content into the same slot. Flipping it back false snaps straight to the
   skeleton (is-resetting kills the transitions for one frame) so a replayed
   load never animates in reverse.

   Both layers are absolutely stacked, so give the wrap its size via
   `className` (e.g. a fixed height, w-full). */
export function SkeletonReveal({
  revealed,
  skeleton,
  className,
  children,
}: {
  revealed: boolean;
  skeleton: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  /* Content that's already there at mount (a fresh thread's pending send,
     a cache-primed list) paints instantly — the cross-fade is only for
     loads that actually finish while we're watching. */
  const [shown, setShown] = useState(revealed);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (revealed) {
      /* One frame late so freshly-mounted content starts from the hidden
         styles and actually transitions instead of popping in. */
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    setResetting(true);
    setShown(false);
  }, [revealed]);

  /* Commit the snapped-back state, then re-arm the transitions. */
  useLayoutEffect(() => {
    if (!resetting) return;
    if (ref.current) void ref.current.offsetWidth;
    setResetting(false);
  }, [resetting]);

  return (
    <div
      ref={ref}
      className={cn(
        "t-skel",
        shown && "is-revealed",
        resetting && "is-resetting",
        className,
      )}
    >
      <div className="t-skel-skeleton is-pulsing" aria-hidden>
        {skeleton}
      </div>
      <div className="t-skel-content">{children}</div>
    </div>
  );
}
