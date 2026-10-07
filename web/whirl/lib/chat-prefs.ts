"use client";

import { useSyncExternalStore } from "react";

/* Chat behavior toggles, sharing the main app's localStorage keys so a
   flip here carries over there (and vice versa) — the keys are the
   contract. The thread view reads these while settings sits on the other
   shell face, so each pref rides a tiny external store (same shape as
   lib/home-prefs.ts): a flip in settings reaches the chat live, and the
   storage listener carries it across tabs. */

function makeBoolPref(key: string, fallback: boolean) {
  const changeEvent = `whirl:${key}`;
  let cached: boolean | null = null;

  const read = () => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? fallback : stored === "1";
    } catch {
      return fallback;
    }
  };

  const snapshot = () => {
    if (cached === null) cached = read();
    return cached;
  };

  const subscribe = (onChange: () => void) => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      cached = read();
      onChange();
    };
    window.addEventListener(changeEvent, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(changeEvent, onChange);
      window.removeEventListener("storage", onStorage);
    };
  };

  const set = (next: boolean) => {
    cached = next;
    try {
      localStorage.setItem(key, next ? "1" : "0");
    } catch {
      // private mode etc. — the cached value still applies for this visit
    }
    window.dispatchEvent(new Event(changeEvent));
  };

  return function useBoolPref() {
    const value = useSyncExternalStore(subscribe, snapshot, () => fallback);
    return [value, set] as const;
  };
}

/** Follow new messages as they stream in. */
export const useAutoScrollPref = makeBoolPref("chat-auto-scroll", true);

/** Output tokens + response time under each reply. */
export const useShowStatsPref = makeBoolPref("show-stats", false);

/** Offer to turn long pastes into a .md attachment. */
export const useAskBeforeBigPastePref = makeBoolPref(
  "ask-before-big-paste",
  true,
);
