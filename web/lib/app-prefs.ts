"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

import type { Mode } from "./mode";

/**
 * Preferences that belong to Slates as a whole rather than to one app: which
 * apps the launcher shows, which libraries the UI shelf carries, and how often
 * AI Usage re-reads everything.
 *
 * They live in one place because the settings screen writes them while the
 * apps read them, and the two are never on screen together — so a plain
 * storage-backed store, the same shape as the tutor model's, is all it takes.
 */

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * One raw stored string. The snapshot must be stable between renders, so the
 * store hands back the string and each hook parses it in a memo.
 */
function useStored(key: string): [string | null, (value: string | null) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    // The prerender has no storage, so it always sees the defaults.
    () => null,
  );

  const set = useCallback(
    (value: string | null) => {
      try {
        if (value === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, value);
      } catch {
        /* storage blocked — the choice lasts until reload */
      }
      listeners.forEach((fn) => fn());
    },
    [key],
  );

  return [raw, set];
}

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/* ── which apps the launcher shows ─────────────────────────────────────── */

export const APPS: { mode: Mode; title: string; blurb: string }[] = [
  { mode: "school", title: "School", blurb: "Assignment board, grades, tutor, and messages" },
  { mode: "counselor", title: "Counselor", blurb: "College list, applications, and essays" },
  { mode: "ui", title: "UI", blurb: "Component registries, read as code" },
  { mode: "usage", title: "AI Usage", blurb: "Every coding tool, every account" },
];

export function useHiddenApps() {
  const [raw, set] = useStored("slates.apps.hidden.v1");
  const hidden = useMemo(() => parseList(raw) as Mode[], [raw]);

  const setVisible = useCallback(
    (mode: Mode, visible: boolean) => {
      const next = visible ? hidden.filter((m) => m !== mode) : [...new Set([...hidden, mode])];
      // A launcher with no doors is a dead end, so the last app stays.
      if (APPS.every((a) => next.includes(a.mode))) return;
      set(next.length ? JSON.stringify(next) : null);
    },
    [hidden, set],
  );

  return [hidden, setVisible] as const;
}

/* ── which libraries the UI shelf carries ──────────────────────────────── */

export function useHiddenRegistries() {
  const [raw, set] = useStored("slates.ui.hiddenRegistries.v1");
  const hidden = useMemo(() => parseList(raw), [raw]);

  const setShown = useCallback(
    (id: string, shown: boolean) => {
      const next = shown ? hidden.filter((r) => r !== id) : [...new Set([...hidden, id])];
      set(next.length ? JSON.stringify(next) : null);
    },
    [hidden, set],
  );

  return [hidden, setShown] as const;
}

/* ── how often AI Usage refreshes ──────────────────────────────────────── */

/** Minutes between full refreshes; 0 is off. */
export const REFRESH_CHOICES = [0, 1, 3, 5, 15] as const;
export const DEFAULT_REFRESH_MINUTES = 3;

export function useUsageRefreshMinutes() {
  const [raw, set] = useStored("slates.usage.refreshMinutes.v1");
  const minutes = useMemo(() => {
    const n = raw === null ? NaN : Number(raw);
    return (REFRESH_CHOICES as readonly number[]).includes(n) ? n : DEFAULT_REFRESH_MINUTES;
  }, [raw]);

  const setMinutes = useCallback((n: number) => set(String(n)), [set]);
  return [minutes, setMinutes] as const;
}
