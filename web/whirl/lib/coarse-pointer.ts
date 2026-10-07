"use client";

import { useSyncExternalStore } from "react";

/* Touch-first detection for behavior forks (not layout — breakpoints stay
   in CSS). `hover: none` + `pointer: coarse` reads as "a phone or tablet
   without a mouse attached", and the media query stays live, so plugging
   in a mouse flips it without a reload. */

const QUERY = "(hover: none) and (pointer: coarse)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** True on touch-first devices; false during SSR and on pointer machines. */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
