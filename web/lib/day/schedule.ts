/**
 * The student's week, block by block, and where the clock is in it.
 *
 * School days start at 6:00 with an hour to get ready, then coding and
 * product work until it's time to leave: 8:30 on Monday, Tuesday and
 * Thursday, 11:00 on Wednesday, 10:00 on Friday. After school (home at 4:00,
 * or 3:15 on Wednesday and Friday) every day has the same shape: a snack and
 * freshening up, coding and product work until dinner at 7:00, Instagram
 * content after dinner, free time, sleep at 10:30. Weekends are for studying,
 * building and content.
 *
 * Kept as a timetable so a change is one line: each row starts a block that
 * runs until the next row, and the last one runs until sleep. The device's
 * own clock says where "now" is, so nothing here needs the host.
 */

export type Kind = "routine" | "build" | "school" | "content" | "study" | "meal" | "free" | "sleep";

export interface Block {
  /** Minutes after midnight; past 1,440 for the part of a night that runs into tomorrow. */
  start: number;
  end: number;
  kind: Kind;
  title: string;
}

export interface DayPlan {
  /** YYYY-MM-DD in the device's own time zone. */
  day: string;
  wake: number;
  sleep: number;
  /** Leaving for school and getting home again, on a school day. */
  school: { leave: number; home: number } | null;
  /** Back to back, from waking up to going to sleep. */
  blocks: Block[];
}

type Row = readonly [start: string, kind: Exclude<Kind, "sleep">, title: string];

interface Template {
  rows: readonly Row[];
  sleep: string;
}

const MON_TUE_THU: Template = {
  rows: [
    ["06:00", "routine", "Get ready + breakfast"],
    ["07:00", "build", "Coding + product"],
    ["08:30", "school", "School"],
    ["16:00", "routine", "Snack + freshen up"],
    ["16:30", "build", "Coding + product"],
    ["19:00", "meal", "Dinner"],
    ["19:30", "content", "Instagram content"],
    ["21:00", "free", "Free time"],
  ],
  sleep: "22:30",
};

const WEDNESDAY: Template = {
  rows: [
    ["06:00", "routine", "Get ready + breakfast"],
    ["07:00", "build", "Coding + product"],
    ["11:00", "school", "School"],
    ["15:15", "routine", "Snack + freshen up"],
    ["15:45", "build", "Coding + product"],
    ["19:00", "meal", "Dinner"],
    ["19:30", "content", "Instagram content"],
    ["21:00", "free", "Free time"],
  ],
  sleep: "22:30",
};

const FRIDAY: Template = {
  rows: [
    ["06:00", "routine", "Get ready + breakfast"],
    ["07:00", "build", "Coding + product"],
    ["10:00", "school", "School"],
    ["15:15", "routine", "Snack + freshen up"],
    ["15:45", "build", "Coding + product"],
    ["19:00", "meal", "Dinner"],
    ["19:30", "content", "Instagram content"],
    ["21:00", "free", "Free time"],
  ],
  sleep: "22:30",
};

const WEEKEND: Template = {
  rows: [
    ["08:00", "routine", "Get ready + breakfast"],
    ["09:00", "study", "Study"],
    ["12:00", "meal", "Lunch"],
    ["13:00", "build", "Coding + product"],
    ["16:00", "routine", "Snack + break"],
    ["16:30", "content", "Instagram content"],
    ["19:00", "meal", "Dinner"],
    ["19:30", "free", "Free time"],
  ],
  sleep: "22:30",
};

/** Sunday first, the way `Date.getDay()` counts. */
const WEEK: readonly Template[] = [WEEKEND, MON_TUE_THU, MON_TUE_THU, WEDNESDAY, MON_TUE_THU, FRIDAY, WEEKEND];

export const KIND_LABEL: Record<Kind, string> = {
  build: "Coding + product",
  content: "Instagram content",
  school: "School",
  study: "Study",
  meal: "Meals",
  routine: "Getting ready + snacks",
  free: "Free time",
  sleep: "Sleep",
};

export const DAY_MINUTES = 24 * 60;

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

/* ── days ──────────────────────────────────────────────────────────────── */

const pad = (n: number) => String(n).padStart(2, "0");

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Noon on the day, so adding days never trips over a daylight-saving change. */
export function dayDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d!, 12);
}

export function addDays(day: string, n: number): string {
  const date = dayDate(day);
  date.setDate(date.getDate() + n);
  return dayKey(date);
}

/** The day and the minute of it that a timestamp falls on, by the device's clock. */
export function clockAt(ms: number): { day: string; minutes: number } {
  const date = new Date(ms);
  return { day: dayKey(date), minutes: date.getHours() * 60 + date.getMinutes() };
}

/* ── plans ─────────────────────────────────────────────────────────────── */

export function planFor(day: string): DayPlan {
  const template = WEEK[dayDate(day).getDay()]!;
  const sleep = minutesOf(template.sleep);
  const blocks = template.rows.map(([start, kind, title], i): Block => {
    const next = template.rows[i + 1];
    return { start: minutesOf(start), end: next ? minutesOf(next[0]) : sleep, kind, title };
  });
  const school = blocks.find((b) => b.kind === "school");
  return { day, wake: blocks[0]!.start, sleep, school: school ? { leave: school.start, home: school.end } : null, blocks };
}

/** Minutes spent on each kind of block, most first. */
export function splitOf(plan: DayPlan): { kind: Kind; minutes: number }[] {
  const by = new Map<Kind, number>();
  for (const b of plan.blocks) by.set(b.kind, (by.get(b.kind) ?? 0) + b.end - b.start);
  return [...by].map(([kind, minutes]) => ({ kind, minutes })).sort((a, b) => b.minutes - a.minutes);
}

/* ── now ───────────────────────────────────────────────────────────────── */

export interface Moment {
  block: Block;
  /** What follows: the next block, the night, or tomorrow's first block (its times past 1,440). */
  next: Block;
  /** 0 to 1 through the block. */
  progress: number;
  /** Minutes until the block ends. */
  left: number;
}

const night = (plan: DayPlan, tomorrow: DayPlan): Block => ({ start: plan.sleep, end: DAY_MINUTES + tomorrow.wake, kind: "sleep", title: "Sleep" });

/** Where `minutes` after midnight on `day` falls: in one of the day's blocks, or asleep. */
export function momentAt(day: string, minutes: number): Moment {
  const plan = planFor(day);
  let block: Block;
  let next: Block;
  if (minutes < plan.wake) {
    // Last night, counted from today's midnight.
    const last = night(planFor(addDays(day, -1)), plan);
    block = { ...last, start: last.start - DAY_MINUTES, end: last.end - DAY_MINUTES };
    next = plan.blocks[0]!;
  } else if (minutes >= plan.sleep) {
    const tomorrow = planFor(addDays(day, 1));
    const first = tomorrow.blocks[0]!;
    block = night(plan, tomorrow);
    next = { ...first, start: first.start + DAY_MINUTES, end: first.end + DAY_MINUTES };
  } else {
    const i = plan.blocks.findIndex((b) => minutes < b.end);
    block = plan.blocks[i]!;
    next = plan.blocks[i + 1] ?? night(plan, planFor(addDays(day, 1)));
  }
  const length = block.end - block.start;
  return { block, next, progress: Math.min(1, Math.max(0, (minutes - block.start) / length)), left: block.end - minutes };
}

/* ── words ─────────────────────────────────────────────────────────────── */

/** 990 as "4:30 PM"; times past midnight wrap round. */
export function clock(minutes: number): string {
  const m = ((Math.round(minutes) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const h = Math.floor(m / 60);
  return `${((h + 11) % 12) + 1}:${pad(m % 60)} ${h < 12 ? "AM" : "PM"}`;
}

/** "4:30 – 7:00 PM", or "11:00 AM – 3:15 PM" across noon. */
export function span(start: number, end: number): string {
  const a = clock(start);
  const b = clock(end);
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)} – ${b}` : `${a} – ${b}`;
}
