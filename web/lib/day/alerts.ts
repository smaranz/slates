/**
 * When the Schedule speaks up on the Mac: as each block starts (and at
 * bedtime), and louder a quarter of an hour before F45, so there's time to
 * leave. Worked out from the same timetable the room draws, by the device's
 * clock; `components/day/ScheduleAlerts.tsx` sounds them.
 */

import { addDays, clock, clockAt, dayDate, planFor, span } from "./schedule";

export interface ScheduleAlert {
  /** When it goes off. */
  at: number;
  /** "next" as a block starts, "f45" ahead of a class. */
  kind: "next" | "f45";
  title: string;
  body: string;
}

/** How long before F45 the loud alert goes off, in minutes. */
export const F45_LEAD = 15;

/**
 * An alert found later than this is dropped rather than sounded: the Mac was
 * asleep or the app was closed when it was due, and a pile of stale chimes on
 * waking helps nobody.
 */
export const ALERT_GRACE_MS = 2 * 60_000;

/** A minute of a day by the device's clock, as a timestamp. */
export function timeOf(day: string, minutes: number): number {
  const noon = dayDate(day);
  return new Date(noon.getFullYear(), noon.getMonth(), noon.getDate(), 0, minutes).getTime();
}

function alertsOf(day: string): ScheduleAlert[] {
  const plan = planFor(day);
  const alerts = plan.blocks.flatMap((block, i): ScheduleAlert[] => {
    const next = plan.blocks[i + 1];
    const starts: ScheduleAlert = { at: timeOf(day, block.start), kind: "next", title: block.title, body: `${span(block.start, block.end)}, then ${next ? next.title : "sleep"}` };
    if (block.kind !== "workout") return [starts];
    const warning: ScheduleAlert = {
      at: timeOf(day, block.start - F45_LEAD),
      kind: "f45",
      title: `F45 in ${F45_LEAD} minutes`,
      body: `Class ${span(block.start, block.end)} at F45 Cupertino. Time to head out.`,
    };
    return [warning, starts];
  });
  alerts.push({ at: timeOf(day, plan.sleep), kind: "next", title: "Sleep", body: `Lights out. Up at ${clock(planFor(addDays(day, 1)).wake)}.` });
  return alerts;
}

/** The alerts due after `from` and up to `to`, oldest first. */
export function alertsBetween(from: number, to: number): ScheduleAlert[] {
  if (to <= from) return [];
  const last = clockAt(to).day;
  const alerts: ScheduleAlert[] = [];
  for (let day = clockAt(from).day; day <= last; day = addDays(day, 1)) alerts.push(...alertsOf(day));
  return alerts.filter((a) => a.at > from && a.at <= to).sort((a, b) => a.at - b.at);
}

/**
 * What a check at `now` should sound: whatever came due since the last check,
 * or since the last alert sounded if that's later, and never more than the
 * grace back.
 */
export function alertsDue(lastCheck: number, lastSounded: number, now: number): ScheduleAlert[] {
  return alertsBetween(Math.max(lastCheck, lastSounded, now - ALERT_GRACE_MS), now);
}
