/* Whirl paused PostHog session replay around sensitive screens. Slates
   records nothing, so these are no-ops that keep the call sites honest. */

export function suppressReplay(): () => void {
  return () => {};
}

export function useSuppressReplay(_active: boolean) {}

/** Class names Whirl put on text replay should mask — harmless markers here. */
export const MASK_TEXT = "ph-mask ph-sensitive";
export const NO_CAPTURE = "ph-no-capture";
