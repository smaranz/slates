"use client";

import { useRef } from "react";

/* A flat slider over an arbitrary gradient track — the personalization
   pickers' workhorse. Value is normalized 0–1; the track paints whatever
   background it's handed and the thumb wears the color the current value
   lands on. Drags ride pointer capture on the track (thumb included, no
   thumb-hunting), arrows nudge, Home/End jump. */
export function GradientSlider({
  value,
  onChange,
  trackBackground,
  thumbColor,
  step = 0.02,
  "aria-label": ariaLabel,
}: {
  value: number;
  onChange: (value: number) => void;
  trackBackground: string;
  thumbColor: string;
  step?: number;
  "aria-label": string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  /* The thumb (20px) stays flush inside the track ends, so the usable
     range is inset half a thumb on each side — pick() maps against the
     same inset the thumb's left calc() uses. */
  const pick = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const usable = rect.width - 20;
    if (usable <= 0) return;
    onChange(Math.min(1, Math.max(0, (clientX - rect.left - 10) / usable)));
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      /* No focus() here: preventDefault + programmatic focus makes Chrome
         match :focus-visible, wrapping every click in the accent focus
         ring. Pointer users get the value straight from the drag;
         keyboard users tab in and keep the ring. */
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        pick(event.clientX);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          pick(event.clientX);
      }}
      onKeyDown={(event) => {
        const delta =
          event.key === "ArrowRight" || event.key === "ArrowUp"
            ? step
            : event.key === "ArrowLeft" || event.key === "ArrowDown"
              ? -step
              : event.key === "Home"
                ? -1
                : event.key === "End"
                  ? 1
                  : null;
        if (delta === null) return;
        event.preventDefault();
        onChange(Math.min(1, Math.max(0, value + delta)));
      }}
      style={{ background: trackBackground }}
      className="relative h-4 w-full cursor-pointer touch-none rounded-full shadow-[inset_0_0_0_1px_var(--well-outline)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        aria-hidden
        style={{
          left: `calc(10px + ${value} * (100% - 20px))`,
          background: thumbColor,
        }}
        className="absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface shadow-[0_0_0_1px_var(--well-outline)]"
      />
    </div>
  );
}
