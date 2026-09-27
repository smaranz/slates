"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

import type { Update } from "./types";

/* ── what counts as new ────────────────────────────────────────────────── */

const SEEN_KEY = "slates.updates.seenAt.v1";

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

function readSeen(): string | null {
  try {
    return window.localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

/** When you last looked, and a way to move that forward to the newest post you've now seen. */
export function useUpdatesSeen(): [number, (upTo: number) => void] {
  const raw = useSyncExternalStore(subscribe, readSeen, () => null);
  const seenAt = useMemo(() => {
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : FIRST_RUN;
  }, [raw]);

  const markSeen = useCallback((upTo: number) => {
    try {
      if (upTo <= (Number(window.localStorage.getItem(SEEN_KEY)) || 0)) return;
      window.localStorage.setItem(SEEN_KEY, String(upTo));
    } catch {
      /* storage blocked — the badge comes back next load */
    }
    listeners.forEach((fn) => fn());
  }, []);

  return [seenAt, markSeen];
}

export function unseenCount(updates: Update[] | undefined, seenAt: number): number {
  return (updates ?? []).filter((u) => u.at > seenAt).length;
}

/* ── where a post came from ────────────────────────────────────────────── */

/** A class by its id; a group, or anything else, by its name. */
export function sourceKey(u: Update): string {
  return u.courseId ? `c:${u.courseId}` : `r:${u.realm}`;
}

export interface UpdateSource {
  key: string;
  courseId: string;
  realm: string;
  count: number;
}

/** Everywhere that has posted, the most recent first. */
export function sourcesOf(updates: Update[]): UpdateSource[] {
  const out = new Map<string, UpdateSource>();
  for (const u of [...updates].sort((a, b) => b.at - a.at)) {
    const key = sourceKey(u);
    const hit = out.get(key);
    if (hit) hit.count++;
    else out.set(key, { key, courseId: u.courseId, realm: u.realm, count: 1 });
  }
  return [...out.values()];
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

/* ── opening Updates on one class ──────────────────────────────────────── */

let pendingFilter: string | null = null;

/** Set before switching to Updates, so it opens on that class. */
export function filterUpdatesNext(key: string) {
  pendingFilter = key;
}

export function takeUpdatesFilter(): string | null {
  const key = pendingFilter;
  pendingFilter = null;
  return key;
}
