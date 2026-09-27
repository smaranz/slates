import type { Schedule } from "./types";

/** Routine timing: local wall-clock times, so "7:00" stays 7:00 across daylight saving. */

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MIN_INTERVAL = 5;

export function parseDays(input: unknown): number[] | null {
  if (input === undefined || input === null || input === "daily" || input === "every day") return [0, 1, 2, 3, 4, 5, 6];
  if (input === "weekdays") return [1, 2, 3, 4, 5];
  if (input === "weekends") return [0, 6];
  const list = Array.isArray(input) ? input : typeof input === "string" ? input.split(/[\s,]+/) : [];
  const days = list
    .map((day) => (typeof day === "number" ? day : DAY_NAMES.indexOf(String(day).trim().toLowerCase().slice(0, 3))))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  return days.length ? [...new Set(days)].sort() : null;
}

export function parseTime(input: unknown): string | null {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(String(input ?? "").trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function normalizeSchedule(input: { days?: unknown; time?: unknown; everyMinutes?: unknown }): Schedule {
  const every = Number(input.everyMinutes);
  if (Number.isFinite(every) && every > 0) return { kind: "every", minutes: Math.max(MIN_INTERVAL, Math.round(every)) };
  const time = parseTime(input.time ?? "08:00");
  if (!time) throw new Error(`"${String(input.time)}" isn't a time — use something like 07:30 or 7:30 pm.`);
  const days = parseDays(input.days);
  if (!days) throw new Error(`"${String(input.days)}" isn't a set of days — use daily, weekdays, weekends, or names like mon,wed,fri.`);
  return { kind: "days", days, time };
}

/** The first run strictly after `after`. */
export function nextRunAfter(schedule: Schedule, after: number): number {
  if (schedule.kind === "every") return after + Math.max(MIN_INTERVAL, schedule.minutes) * 60_000;
  const [hour, minute] = schedule.time.split(":").map(Number) as [number, number];
  const from = new Date(after);
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset, hour, minute, 0, 0);
    if (candidate.getTime() > after && schedule.days.includes(candidate.getDay())) return candidate.getTime();
  }
  return after + 24 * 60 * 60_000;
}

function clock(time: string): string {
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  const suffix = hour < 12 ? "am" : "pm";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return minute ? `${h12}:${String(minute).padStart(2, "0")} ${suffix}` : `${h12} ${suffix}`;
}

export function describeSchedule(schedule: Schedule): string {
  if (schedule.kind === "every") {
    return schedule.minutes % 60 === 0 ? `Every ${schedule.minutes / 60 === 1 ? "hour" : `${schedule.minutes / 60} hours`}` : `Every ${schedule.minutes} min`;
  }
  const days = schedule.days.join(",");
  const when = days === "0,1,2,3,4,5,6" ? "Every day" : days === "1,2,3,4,5" ? "Weekdays" : days === "0,6" ? "Weekends"
    : schedule.days.map((day) => DAY_NAMES[day]![0]!.toUpperCase() + DAY_NAMES[day]!.slice(1)).join(", ");
  return `${when} at ${clock(schedule.time)}`;
}
