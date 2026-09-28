"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

import type { Update } from "./types";

/* ── what counts as new ────────────────────────────────────────────────── */

/**
 * Everything up to `baseline` has been seen, and so have the posts in `ids`
 * after it. Posts are read one class at a time on its page, which adds their
 * ids — so reading Spanish's posts doesn't also clear History's.
 */
export interface Seen {
  baseline: number;
  ids: string[];
}

const SEEN_KEY = "slates.updates.seen.v2";
/** Just a timestamp: what the first version kept. */
const OLD_KEY = "slates.updates.seenAt.v1";
const MAX_IDS = 400;

/**
 * Until Updates has been opened once, only the last week counts as new, so the
 * badge doesn't open on every post since spring. Fixed for the session, since
 * the store snapshot below must not change between renders.
 */
const FIRST_RUN = Date.now() - 7 * 86_400_000;

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readRaw(): string | null {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    if (raw !== null) return raw;
    const old = Number(window.localStorage.getItem(OLD_KEY));
    return old ? JSON.stringify({ baseline: old, ids: [] }) : null;
  } catch {
    return null;
  }
}

export function parseSeen(raw: string | null): Seen {
  try {
    const value = raw ? (JSON.parse(raw) as Partial<Seen>) : null;
    return {
      baseline: typeof value?.baseline === "number" && Number.isFinite(value.baseline) ? value.baseline : FIRST_RUN,
      ids: Array.isArray(value?.ids) ? value.ids.filter((id): id is string => typeof id === "string") : [],
    };
  } catch {
    return { baseline: FIRST_RUN, ids: [] };
  }
}

function write(update: (seen: Seen) => Seen) {
  try {
    const next = update(parseSeen(readRaw()));
    window.localStorage.setItem(SEEN_KEY, JSON.stringify({ baseline: next.baseline, ids: next.ids.slice(-MAX_IDS) }));
  } catch {
    /* storage blocked — the badge comes back next load */
  }
  listeners.forEach((fn) => fn());
}

export function isUnseen(u: Update, seen: Seen): boolean {
  return u.at > seen.baseline && !seen.ids.includes(u.id);
}

export function unseenCount(updates: Update[] | undefined, seen: Seen): number {
  return (updates ?? []).filter((u) => isUnseen(u, seen)).length;
}

export function useUpdatesSeen() {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  const seen = useMemo(() => parseSeen(raw), [raw]);

  /** Read these, and only these. */
  const markSeen = useCallback((posts: Update[]) => {
    write((prev) => {
      const fresh = posts.filter((u) => isUnseen(u, prev)).map((u) => u.id);
      return fresh.length ? { ...prev, ids: [...prev.ids, ...fresh] } : prev;
    });
  }, []);

  return { seen, markSeen };
}

/* ── when ──────────────────────────────────────────────────────────────── */

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function dayLabel(at: number, now = new Date()): string {
  const day = new Date(at);
  const days = Math.round((startOfDay(now) - startOfDay(day)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return day.toLocaleDateString(undefined, { weekday: "long" });
  return day.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(day.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

/** Posts under one heading per day, newest first. */
export function byDay(updates: Update[], now = new Date()): { label: string; items: Update[] }[] {
  const out: { label: string; items: Update[] }[] = [];
  for (const u of [...updates].sort((a, b) => b.at - a.at)) {
    const label = dayLabel(u.at, now);
    const group = out[out.length - 1];
    if (group?.label === label) group.items.push(u);
    else out.push({ label, items: [u] });
  }
  return out;
}
