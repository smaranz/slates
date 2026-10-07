"use client";

import { useEffect, useState } from "react";

/* The accent lives in localStorage under "accent" and is applied as a
   data-accent attribute on <html> — app/accents.css maps each name onto
   the --primary family. A blocking inline script in the root layout
   applies it before first paint; this hook is for switching afterwards.
   Graphite is the stock monochrome ink and simply clears the attribute. */

export type Accent =
  | "graphite"
  | "cherry"
  | "tangerine"
  | "honey"
  | "meadow"
  | "lagoon"
  | "ocean"
  | "grape"
  | "flamingo";

export const DEFAULT_ACCENT: Accent = "graphite";

/* Swatches mirror each accent's light/dark --primary in app/accents.css —
   keep the two files in step. */
export const ACCENT_OPTIONS: {
  value: Accent;
  label: string;
  swatch: { light: string; dark: string };
}[] = [
  {
    value: "graphite",
    label: "Graphite",
    swatch: { light: "oklch(0.17 0 0)", dark: "oklch(0.9 0 0)" },
  },
  {
    value: "cherry",
    label: "Cherry",
    swatch: { light: "oklch(0.55 0.19 25)", dark: "oklch(0.78 0.14 25)" },
  },
  {
    value: "tangerine",
    label: "Tangerine",
    swatch: { light: "oklch(0.6 0.16 55)", dark: "oklch(0.8 0.14 60)" },
  },
  {
    value: "honey",
    label: "Honey",
    swatch: { light: "oklch(0.75 0.13 85)", dark: "oklch(0.85 0.13 90)" },
  },
  {
    value: "meadow",
    label: "Meadow",
    swatch: { light: "oklch(0.55 0.12 150)", dark: "oklch(0.8 0.13 150)" },
  },
  {
    value: "lagoon",
    label: "Lagoon",
    swatch: { light: "oklch(0.55 0.1 195)", dark: "oklch(0.8 0.11 195)" },
  },
  {
    value: "ocean",
    label: "Ocean",
    swatch: { light: "oklch(0.55 0.15 250)", dark: "oklch(0.78 0.12 250)" },
  },
  {
    value: "grape",
    label: "Grape",
    swatch: { light: "oklch(0.53 0.17 295)", dark: "oklch(0.78 0.13 295)" },
  },
  {
    value: "flamingo",
    label: "Flamingo",
    swatch: { light: "oklch(0.59 0.18 355)", dark: "oklch(0.8 0.13 350)" },
  },
];

const ACCENTS = ACCENT_OPTIONS.map((option) => option.value);

export function accentLabel(accent: Accent): string {
  return ACCENT_OPTIONS.find((option) => option.value === accent)!.label;
}

function readAccent(): Accent {
  try {
    const stored = localStorage.getItem("accent");
    return ACCENTS.includes(stored as Accent)
      ? (stored as Accent)
      : DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}

function applyAccent(accent: Accent) {
  const el = document.documentElement;
  if (accent === DEFAULT_ACCENT) el.removeAttribute("data-accent");
  else el.setAttribute("data-accent", accent);
}

export function useAccent() {
  const [accent, setAccentState] = useState<Accent>(DEFAULT_ACCENT);

  useEffect(() => {
    setAccentState(readAccent());
  }, []);

  const setAccent = (next: Accent) => {
    setAccentState(next);
    try {
      localStorage.setItem("accent", next);
    } catch {
      // private mode etc. — the attribute still applies for this visit
    }
    applyAccent(next);
  };

  return { accent, setAccent };
}
