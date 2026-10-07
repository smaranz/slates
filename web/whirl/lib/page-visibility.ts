"use client";

import { useSyncExternalStore } from "react";

/* Whether this tab is on screen. One listener for the whole app — the store
   is module-level, so a hundred subscribers cost one `visibilitychange`
   handler between them. */

const listeners = new Set<() => void>();
let bound = false;

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!bound) {
    bound = true;
    document.addEventListener("visibilitychange", emit);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0 || !bound) return;
    bound = false;
    document.removeEventListener("visibilitychange", emit);
  };
}

/** True while the tab is visible. Always true during SSR. */
export function usePageVisible(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => !document.hidden,
    () => true,
  );
}
