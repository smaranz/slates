"use client";

import { useEffect, useState } from "react";

/* The canvas tint lives in localStorage under "canvas-tint" and is applied
   as inline --tint-* custom properties on <html> plus a data-tinted
   attribute — app/tint.css routes them into the background tokens per
   mode. A blocking inline script in the root layout applies it before
   first paint (its math mirrors tintTokens below — keep them in step);
   this hook is for switching afterwards. */

export type CanvasTint = {
  enabled: boolean;
  /** 0–360 */
  hue: number;
  /** 0–1, whisper → vivid */
  strength: number;
};

export const DEFAULT_TINT: CanvasTint = {
  enabled: false,
  hue: 265,
  strength: 0.5,
};

const KEY = "canvas-tint";

/* Both modes' worth of tinted background tokens. Lightness stays pinned to
   the stock neutral ladder (globals.css) so elevation reads the same; only
   chroma rides the strength slider, with the surface taking roughly a
   third of the rail's dose — the sidebar wears the color, the panel just
   remembers it. */
export function tintTokens(hue: number, strength: number): [string, string][] {
  const h = Math.round(((hue % 360) + 360) % 360);
  const railC = 0.02 + 0.06 * strength;
  const darkC = 0.012 + 0.038 * strength;
  const o = (l: number, c: number) => `oklch(${l} ${c.toFixed(4)} ${h})`;
  return [
    ["--tint-bg-l", o(0.964, railC)],
    ["--tint-well-l", o(0.964, railC * 0.55)],
    ["--tint-surface-l", o(0.99, railC * 0.35)],
    ["--tint-bg-d", o(0.244, darkC)],
    ["--tint-surface-d", o(0.209, darkC * 0.6)],
    ["--tint-well-d", o(0.256, darkC * 0.7)],
    ["--tint-popover-d", o(0.269, darkC * 0.6)],
  ];
}

function readTint(): CanvasTint {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_TINT;
    const parsed = JSON.parse(raw) as Partial<CanvasTint> | null;
    if (
      typeof parsed?.hue !== "number" ||
      !Number.isFinite(parsed.hue) ||
      typeof parsed?.strength !== "number" ||
      !Number.isFinite(parsed.strength)
    )
      return DEFAULT_TINT;
    return {
      enabled: parsed.enabled === true,
      hue: ((parsed.hue % 360) + 360) % 360,
      strength: Math.min(1, Math.max(0, parsed.strength)),
    };
  } catch {
    return DEFAULT_TINT;
  }
}

function applyTint(tint: CanvasTint) {
  const el = document.documentElement;
  if (!tint.enabled) {
    el.removeAttribute("data-tinted");
    for (const [name] of tintTokens(0, 0)) el.style.removeProperty(name);
    return;
  }
  for (const [name, value] of tintTokens(tint.hue, tint.strength))
    el.style.setProperty(name, value);
  el.setAttribute("data-tinted", "");
}

export function useCanvasTint() {
  const [tint, setTintState] = useState<CanvasTint>(DEFAULT_TINT);

  useEffect(() => {
    setTintState(readTint());
  }, []);

  const setTint = (next: CanvasTint) => {
    setTintState(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // private mode etc. — the tint still applies for this visit
    }
    applyTint(next);
  };

  return { tint, setTint };
}
