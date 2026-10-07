"use client";

import { useRef } from "react";
import { motion } from "motion/react";

import { pinRasterPath } from "@whirl/lib/motion";

/* Same hot spring as the composer family — the knob snaps between stops
   instead of gliding. */
const SNAP_SPRING = {
  type: "spring",
  stiffness: 900,
  damping: 55,
  mass: 0.5,
} as const;

/* Track geometry, borrowed from ToggleSwitch so the two read as one
   family: 18px-tall pill, 14px knob, 2px inset. */
const TRACK_WIDTH = 80;
const TRACK_PAD = 2;
const KNOB = 14;
const USABLE = TRACK_WIDTH - TRACK_PAD * 2 - KNOB;

/* A discrete slider for menu rows — a toggle switch that grew stops.
   Value is an index into `count` evenly spaced stops; drags and clicks
   snap to the nearest stop, arrows nudge, Home/End jump. The fill rides
   the same primary as a checked ToggleSwitch and swallows the dots it
   passes. */
export function SteppedSlider({
  index,
  count,
  onIndexChange,
  disabled = false,
  "aria-label": ariaLabel,
  getValueText,
}: {
  index: number;
  count: number;
  onIndexChange: (index: number) => void;
  disabled?: boolean;
  "aria-label": string;
  getValueText?: (index: number) => string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const last = Math.max(1, count - 1);
  const clamped = Math.min(last, Math.max(0, index));
  const knobX = (clamped / last) * USABLE;

  const pick = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const along = (clientX - rect.left - TRACK_PAD - KNOB / 2) / USABLE;
    const next = Math.round(Math.min(1, Math.max(0, along)) * last);
    if (next !== clamped) onIndexChange(next);
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={last}
      aria-valuenow={clamped}
      aria-valuetext={getValueText?.(clamped)}
      aria-disabled={disabled || undefined}
      /* No focus() on pointer down — see GradientSlider: programmatic
         focus makes Chrome wrap every click in the focus ring. */
      onPointerDown={(event) => {
        if (disabled) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        pick(event.clientX);
      }}
      onPointerMove={(event) => {
        if (disabled) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          pick(event.clientX);
      }}
      onKeyDown={(event) => {
        if (disabled) return;
        const delta =
          event.key === "ArrowRight" || event.key === "ArrowUp"
            ? 1
            : event.key === "ArrowLeft" || event.key === "ArrowDown"
              ? -1
              : null;
        const target =
          delta !== null
            ? clamped + delta
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? last
                : null;
        if (target === null) return;
        event.preventDefault();
        onIndexChange(Math.min(last, Math.max(0, target)));
      }}
      style={{ width: TRACK_WIDTH }}
      className={`relative h-4.5 shrink-0 touch-none overflow-hidden rounded-full bg-black/[0.15] outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-white/[0.2] ${
        disabled ? "" : "cursor-pointer"
      }`}
    >
      {/* Stop dots — the fill covers the ones already passed. */}
      {Array.from({ length: count }, (_, stop) => (
        <span
          key={stop}
          aria-hidden
          style={{
            left: TRACK_PAD + KNOB / 2 + (stop / last) * USABLE,
          }}
          className="absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/[0.2] dark:bg-white/[0.25]"
        />
      ))}
      <motion.span
        aria-hidden
        initial={false}
        animate={{ width: TRACK_PAD + knobX + KNOB + TRACK_PAD }}
        transition={SNAP_SPRING}
        className="absolute inset-y-0 left-0 rounded-full bg-primary"
      />
      <motion.span
        aria-hidden
        initial={false}
        animate={{ x: knobX }}
        transition={SNAP_SPRING}
        transformTemplate={pinRasterPath}
        className="absolute top-0.5 left-0.5 block size-3.5 rounded-full bg-surface ring-1 ring-black/[0.06] dark:ring-white/[0.08]"
      />
    </div>
  );
}
