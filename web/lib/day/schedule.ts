/**
 * The student's week, block by block, and where the clock is in it.
 *
 * School days start at 6:00 with an hour to get ready and an hour and a half
 * of study, 7:00–8:30. Then it's time to leave: 8:30 on Monday, Tuesday and
 * Thursday; Wednesday and Friday start later, so coding and product work
 * fills the morning until 11:00 or 10:00. After school (home at 4:00, or
 * 3:15 on Wednesday and Friday) comes a snack and freshening up, then at
 * least three hours of homework, split around F45 and dinner, then an hour
 * of Instagram content (45 minutes on Monday), free time and sleep at 10:30.
 * Monday has the Codestarters meeting at 7:00 PM, so dinner is at 7:30.
 *
 * F45 is the Cupertino studio: the 5:30 class on Monday and the day's last
 * class every other day, which is 5:30 on Friday, 6:30 from Tuesday to
 * Thursday (dinner follows the class at 7:15) and 10:00 at the weekend.
 * The times are F45's own as of October 2026; Health reads the live
 * schedule (`lib/health/f45.ts`). Weekends are still seven hours of study,
 * in four sessions around the class (9:00–10:00, 11:00–1:00, 2:00–4:00 and
 * 4:30–6:30, with lunch and a snack between them), then a little coding and
 * product work, dinner, Instagram content and free time.
 *
 * Kept as a timetable so a change is one line: each row starts a block that
 * runs until the next row, and the last one runs until sleep. The device's
 * own clock says where "now" is, so nothing here needs the host.
 */

export type Kind = "routine" | "build" | "school" | "homework" | "workout" | "content" | "study" | "meal" | "free" | "sleep";

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

const MONDAY: Template = {
  rows: [
    ["06:00", "routine", "Get ready + breakfast"],
    ["07:00", "study", "Study"],
    ["08:30", "school", "School"],
    ["16:00", "routine", "Snack + freshen up"],
    ["16:30", "homework", "Homework"],
    ["17:30", "workout", "F45"],
    ["18:15", "homework", "Homework"],
    ["19:00", "build", "Codestarters meeting"],
    ["19:30", "meal", "Dinner"],
    ["20:00", "homework", "Homework"],
    ["21:15", "content", "Instagram content"],
    ["22:00", "free", "Free time"],
  ],
  sleep: "22:30",
};

const TUE_THU: Template = {
  rows: [
    ["06:00", "routine", "Get ready + breakfast"],
    ["07:00", "study", "Study"],
    ["08:30", "school", "School"],
    ["16:00", "routine", "Snack + freshen up"],
    ["16:30", "homework", "Homework"],
    ["18:30", "workout", "F45"],
    ["19:15", "meal", "Dinner"],
    ["19:45", "homework", "Homework"],
    ["20:45", "content", "Instagram content"],
    ["21:45", "free", "Free time"],
  ],
  sleep: "22:30",
};

/** Home at 3:15, so homework starts earlier and runs to 3¾ hours. */
const WEDNESDAY: Template = {
  rows: [
    ["06:00", "routine", "Get ready + breakfast"],
    ["07:00", "study", "Study"],
    ["08:30", "build", "Coding + product"],
    ["11:00", "school", "School"],
    ["15:15", "routine", "Snack + freshen up"],
    ["15:45", "homework", "Homework"],
    ["18:30", "workout", "F45"],
    ["19:15", "meal", "Dinner"],
    ["19:45", "homework", "Homework"],
    ["20:45", "content", "Instagram content"],
    ["21:45", "free", "Free time"],
  ],
  sleep: "22:30",
};

const FRIDAY: Template = {
  rows: [
    ["06:00", "routine", "Get ready + breakfast"],
    ["07:00", "study", "Study"],
    ["08:30", "build", "Coding + product"],
    ["10:00", "school", "School"],
    ["15:15", "routine", "Snack + freshen up"],
    ["15:45", "homework", "Homework"],
    ["17:30", "workout", "F45"],
    ["18:15", "homework", "Homework"],
    ["19:00", "meal", "Dinner"],
    ["19:30", "homework", "Homework"],
    ["20:00", "content", "Instagram content"],
    ["21:00", "free", "Free time"],
  ],
  sleep: "22:30",
};

/** Saturday's 10:00 class runs an hour. */
const SATURDAY: Template = {
  rows: [
    ["08:00", "routine", "Get ready + breakfast"],
    ["09:00", "study", "Study session 1"],
    ["10:00", "workout", "F45"],
    ["11:00", "study", "Study session 2"],
    ["13:00", "meal", "Lunch"],
    ["14:00", "study", "Study session 3"],
    ["16:00", "routine", "Snack + break"],
    ["16:30", "study", "Study session 4"],
    ["18:30", "build", "Coding + product"],
    ["19:00", "meal", "Dinner"],
    ["19:30", "content", "Instagram content"],
    ["21:00", "free", "Free time"],
  ],
  sleep: "22:30",
};

/** Sunday's is 45 minutes, so the study sessions match Saturday's and the quarter hour between gets home. */
const SUNDAY: Template = {
  rows: [
    ["08:00", "routine", "Get ready + breakfast"],
    ["09:00", "study", "Study session 1"],
    ["10:00", "workout", "F45"],
    ["10:45", "routine", "Head home"],
    ["11:00", "study", "Study session 2"],
    ["13:00", "meal", "Lunch"],
    ["14:00", "study", "Study session 3"],
    ["16:00", "routine", "Snack + break"],
    ["16:30", "study", "Study session 4"],
    ["18:30", "build", "Coding + product"],
    ["19:00", "meal", "Dinner"],
    ["19:30", "content", "Instagram content"],
    ["21:00", "free", "Free time"],
  ],
  sleep: "22:30",
};

/** Sunday first, the way `Date.getDay()` counts. */
const WEEK: readonly Template[] = [SUNDAY, MONDAY, TUE_THU, WEDNESDAY, TUE_THU, FRIDAY, SATURDAY];

export const KIND_LABEL: Record<Kind, string> = {
  build: "Coding + product",
  content: "Instagram content",
  school: "School",
  homework: "Homework",
  workout: "F45",
  study: "Study",
  meal: "Meals",
  routine: "Getting ready + breaks",
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

/** Minutes spent on each kind of block, most first, over one day or several. */
export function splitOf(...plans: DayPlan[]): { kind: Kind; minutes: number }[] {
  const by = new Map<Kind, number>();
  for (const b of plans.flatMap((p) => p.blocks)) by.set(b.kind, (by.get(b.kind) ?? 0) + b.end - b.start);
  return [...by].map(([kind, minutes]) => ({ kind, minutes })).sort((a, b) => b.minutes - a.minutes);
}

/** How long the night after `day` is: its bedtime to the next morning's wake-up. */
export function nightAfter(day: string): { sleep: number; wake: number; minutes: number } {
  const { sleep } = planFor(day);
  const { wake } = planFor(addDays(day, 1));
  return { sleep, wake, minutes: DAY_MINUTES - sleep + wake };
}

/** Half an hour of night drawn past the latest bedtime, so every day visibly ends in sleep. */
export const NIGHT_TAIL = 30;

/**
 * The stretch of the clock a timeline covers for these days: the earliest
 * wake-up, on the hour, to the latest bedtime plus a sliver of night. Days
 * drawn side by side share one, so the same hour sits at the same height.
 */
export function axisOf(plans: DayPlan[]): { start: number; end: number } {
  const start = Math.floor(Math.min(...plans.map((p) => p.wake)) / 60) * 60;
  return { start, end: Math.max(...plans.map((p) => p.sleep)) + NIGHT_TAIL };
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
  return joined(clock(start), clock(end));
}

/** The same span with whole hours bare, for narrow columns: "4:30 – 7 PM", "9 AM – 12 PM". */
export function brief(start: number, end: number): string {
  const bare = (t: string) => t.replace(":00 ", " ");
  return joined(bare(clock(start)), bare(clock(end)));
}

/** An hour on the timeline's edge: "6 AM", "12 PM". */
export function hourLabel(minutes: number): string {
  return clock(minutes).replace(":00 ", " ");
}

/** Two times as a span, saying AM or PM once when both share it. */
function joined(a: string, b: string): string {
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)} – ${b}` : `${a} – ${b}`;
}
