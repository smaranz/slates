"use client";

import type { CSSProperties } from "react";

import { ACCENT_OPTIONS, type Accent } from "@whirl/lib/accent";
import { cn } from "@whirl/lib/utils";

/* A row of paint dabs, one per accent, each tinted for whichever mode is
   active via a pair of inline swatch vars. The picked one earns an orbit
   ring in its own color; the rest keep a hairline inset so the pale ones
   don't dissolve into the card. */
export function AccentPicker({
  value,
  onChange,
  "aria-label": ariaLabel,
}: {
  value: Accent;
  onChange: (value: Accent) => void;
  "aria-label"?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex flex-wrap gap-3"
    >
      {ACCENT_OPTIONS.map(({ value: option, label, swatch }) => {
        const selected = value === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            onClick={() => onChange(option)}
            style={
              {
                "--swatch-light": swatch.light,
                "--swatch-dark": swatch.dark,
              } as CSSProperties
            }
            className={cn(
              "size-8 cursor-pointer rounded-full bg-(--swatch-light) transition-[scale,box-shadow] duration-150 hover:scale-110 active:scale-95 dark:bg-(--swatch-dark)",
              selected
                ? "ring-2 ring-(--swatch-light) ring-offset-2 ring-offset-surface dark:ring-(--swatch-dark)"
                : "shadow-[inset_0_0_0_1px_rgb(0_0_0_/_0.08)] dark:shadow-[inset_0_0_0_1px_rgb(255_255_255_/_0.1)]",
            )}
          />
        );
      })}
    </div>
  );
}
