"use client";

import type { CanvasTint } from "@whirl/lib/tint";
import { GradientSlider } from "../gradient-slider";

/* The canvas tint's own little color picker: a hue rainbow and a strength
   ramp, both live — every drag repaints the sidebar and surface tokens on
   the spot, so the app itself is the preview. */

/* Tracks run vivid on purpose — the pastel wash the tint actually applies
   is far too faint to steer by, and read as white bars. The sliders are
   the control, the app is the preview. */
const HUE_TRACK = `linear-gradient(90deg, ${Array.from(
  { length: 13 },
  (_, i) => `oklch(0.68 0.19 ${i * 30})`,
).join(", ")})`;

export function TintPicker({
  tint,
  onChange,
}: {
  tint: CanvasTint;
  onChange: (tint: CanvasTint) => void;
}) {
  const hue = Math.round(tint.hue);
  const strengthTrack = `linear-gradient(90deg, oklch(0.95 0.02 ${hue}), oklch(0.6 0.21 ${hue}))`;
  const strengthThumb = `oklch(${(0.95 - tint.strength * 0.35).toFixed(3)} ${(
    0.02 +
    tint.strength * 0.19
  ).toFixed(3)} ${hue})`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="w-16 shrink-0 text-[13px]/[18px] text-muted-foreground">
          Color
        </span>
        <GradientSlider
          value={tint.hue / 360}
          onChange={(value) => onChange({ ...tint, hue: Math.round(value * 360) % 360 })}
          trackBackground={HUE_TRACK}
          thumbColor={`oklch(0.68 0.19 ${hue})`}
          step={10 / 360}
          aria-label="Background color hue"
        />
      </div>
      <div className="flex items-center gap-3">
        <span className="w-16 shrink-0 text-[13px]/[18px] text-muted-foreground">
          Strength
        </span>
        <GradientSlider
          value={tint.strength}
          onChange={(value) => onChange({ ...tint, strength: value })}
          trackBackground={strengthTrack}
          thumbColor={strengthThumb}
          step={0.05}
          aria-label="Background tint strength"
        />
      </div>
    </div>
  );
}
