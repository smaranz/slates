/* The chart series palette. The hexes live in globals.css as --series-1..8
   (light and dark steps); this module only hands out slots.

   Two rules from the palette's validation carry into every chart:

   1. Slots are assigned in order and never cycled. There is no ninth hue —
      the tool caps series at 8 and tells the model to fold the rest into
      "Other", which takes the muted grey below instead of a color.
   2. Three light-mode slots sit under 3:1 against white, so color can never
      be the only thing naming a series. Every chart ships a legend with text
      labels, and hover puts the value in words — that's the relief rule. */

export const CHART_SERIES_SLOTS = 8;

/** The CSS variable for a series slot, wrapping around only as a last resort
 *  (the tool's cap means it shouldn't come up). */
export function seriesColor(index: number): string {
  return `var(--series-${(index % CHART_SERIES_SLOTS) + 1})`;
}

/** The neutral for aggregated remainders — an "Other" bucket is not a series
 *  with an identity, so it doesn't get a hue. */
export const OTHER_COLOR = "var(--color-muted-foreground)";

/** True when a series is a rolled-up remainder rather than a real entity. */
export function isOtherSeries(name: string): boolean {
  return /^(other|others|rest|remaining)$/i.test(name.trim());
}

/** Slot colors for a whole chart, with remainders demoted to grey. */
export function seriesColors(names: string[]): string[] {
  let slot = 0;
  return names.map((name) =>
    isOtherSeries(name) ? OTHER_COLOR : seriesColor(slot++),
  );
}
