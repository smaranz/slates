"use client";

import { useEffect, useState } from "react";

/**
 * Today's date, as state rather than as a call during render.
 *
 * "14 days left" is derived from the clock, and the clock is an external
 * system — reading it while rendering gives an answer that silently changes
 * whenever React happens to re-render, and one that never changes when it
 * doesn't. Slates is a desktop app people leave open overnight, so a deadline
 * badge that still says "1 day left" the next morning is a real bug, not a
 * theoretical one.
 *
 * Re-reads hourly, which crosses midnight closely enough for a day counter.
 */

const HOUR = 60 * 60 * 1000;

/** Local calendar date as YYYY-MM-DD. */
function localDay(at: Date): string {
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

export function useToday(): string {
  // The server has no meaningful "today" for this student's timezone, so the
  // first render is deliberately empty and every comparison against it is
  // false — a badge appears a frame late rather than appearing wrong.
  const [today, setToday] = useState("");

  useEffect(() => {
    const read = () => setToday(localDay(new Date()));
    read();
    const timer = window.setInterval(read, HOUR);
    return () => window.clearInterval(timer);
  }, []);

  return today;
}

/** Whole days from `today` to a YYYY-MM-DD deadline. Null when either is unknown. */
export function daysUntil(deadline: string | null | undefined, today: string): number | null {
  if (!deadline || !today) return null;
  const to = new Date(`${deadline}T12:00:00`).getTime();
  const from = new Date(`${today}T12:00:00`).getTime();
  if (Number.isNaN(to) || Number.isNaN(from)) return null;
  return Math.round((to - from) / 86_400_000);
}
