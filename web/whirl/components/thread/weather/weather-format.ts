// Open-Meteo returns times already in the location's local zone (timezone=auto)
// as offset-free ISO strings like "2026-06-22T14:00". We must NOT parse those
// through `new Date()` for display, since that would re-interpret them in the
// viewer's timezone. Instead we read the fields straight out of the string.

/** "2026-06-22T14:00" -> "2 PM" (or "14:00" style isn't used; we keep am/pm). */
export function formatHour(localIso: string): string {
  const hourStr = localIso.slice(11, 13);
  const hour = Number(hourStr);
  if (Number.isNaN(hour)) return "";
  const period = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display} ${period}`;
}

/** "2026-06-22T18:42" -> "6:42 PM". Used for sunrise/sunset. */
export function formatClock(localIso: string): string {
  const hour = Number(localIso.slice(11, 13));
  const minute = localIso.slice(14, 16);
  if (Number.isNaN(hour)) return "";
  const period = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${minute} ${period}`;
}

/**
 * "2026-06-22" -> "Mon". Computed in UTC from the parsed Y/M/D so the weekday
 * never shifts with the viewer's timezone.
 */
export function formatWeekday(localDate: string): string {
  const [year, month, day] = localDate.split("-").map(Number);
  if (!year || !month || !day) return "";
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    timeZone: "UTC",
  }).format(date);
}

/** Whether a local date string is today in the location's zone (best effort). */
export function isToday(localDate: string, timezone: string): boolean {
  try {
    const todayThere = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    return todayThere === localDate;
  } catch {
    return false;
  }
}

export function roundTemp(value: number): number {
  return Math.round(value);
}
