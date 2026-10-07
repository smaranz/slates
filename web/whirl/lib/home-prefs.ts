"use client";

import { useSyncExternalStore } from "react";

/* Home-screen prefs. Unlike lib/chat-prefs.ts, these are read by a view
   (home) that stays mounted behind the settings face — flipping the
   toggle has to reach the other face live, so the value rides a tiny
   external store instead of per-hook state. */

const KEY = "home-suggestions";
const CHANGE_EVENT = "whirl:home-suggestions";

let cached: boolean | null = null;

function read(): boolean {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === null ? true : stored === "1";
  } catch {
    return true;
  }
}

function snapshot(): boolean {
  if (cached === null) cached = read();
  return cached;
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    cached = read();
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Conversation starters under the home composer. */
export function useShowSuggestionsPref() {
  const value = useSyncExternalStore(subscribe, snapshot, () => true);

  const set = (next: boolean) => {
    cached = next;
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      // private mode etc. — the cached value still applies for this visit
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };

  return [value, set] as const;
}
