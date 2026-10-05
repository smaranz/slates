import assert from "node:assert/strict";
import test from "node:test";

import { addDays, axisOf, brief, clock, clockAt, DAY_MINUTES, hourLabel, momentAt, nightAfter, NIGHT_TAIL, planFor, span, splitOf } from "./schedule";

// The week the student gave: school 8:30–4:00 Mon/Tue/Thu, 11:00–3:15 Wed,
// 10:00–3:15 Fri, up at 6:00 on school days, the evening split into coding
// and product work, then Instagram content, and seven hours of study on each
// weekend day.

const SUNDAY = "2026-10-04";
const MONDAY = "2026-10-05";
const TUESDAY = "2026-10-06";
const WEDNESDAY = "2026-10-07";
const THURSDAY = "2026-10-08";
const FRIDAY = "2026-10-09";
const SATURDAY = "2026-10-10";

const at = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
};

const rows = (day: string) => planFor(day).blocks.map((b) => `${clock(b.start)} ${b.title}`);

test("every day runs back to back from waking up to sleep", () => {
  for (let i = 0; i < 7; i++) {
    const plan = planFor(addDays(SUNDAY, i));
    assert.equal(plan.blocks[0]!.start, plan.wake);
    assert.equal(plan.blocks.at(-1)!.end, plan.sleep);
    plan.blocks.forEach((b, j) => {
      assert.ok(b.end > b.start, `${plan.day} ${b.title} has no length`);
      if (j) assert.equal(b.start, plan.blocks[j - 1]!.end, `${plan.day} has a gap or overlap before ${b.title}`);
    });
  }
});

test("school is when the student said: leave, then home", () => {
  for (const day of [MONDAY, TUESDAY, THURSDAY]) assert.deepEqual(planFor(day).school, { leave: at("08:30"), home: at("16:00") });
  assert.deepEqual(planFor(WEDNESDAY).school, { leave: at("11:00"), home: at("15:15") });
  assert.deepEqual(planFor(FRIDAY).school, { leave: at("10:00"), home: at("15:15") });
  assert.equal(planFor(SATURDAY).school, null);
  assert.equal(planFor(SUNDAY).school, null);
});

test("school days start at 6:00 and code until it's time to leave", () => {
  for (const day of [MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY]) {
    const plan = planFor(day);
    assert.equal(plan.wake, at("06:00"));
    const [ready, code] = plan.blocks;
    assert.deepEqual([ready!.start, ready!.end, ready!.kind], [at("06:00"), at("07:00"), "routine"]);
    assert.deepEqual([code!.start, code!.end, code!.kind], [at("07:00"), plan.school!.leave, "build"]);
  }
});

test("after school: a snack, coding until dinner at 7:00, Instagram until 9:00, sleep at 10:30", () => {
  assert.deepEqual(rows(MONDAY).slice(3), [
    "4:00 PM Snack + freshen up",
    "4:30 PM Coding + product",
    "7:00 PM Dinner",
    "7:30 PM Instagram content",
    "9:00 PM Free time",
  ]);
  // Home 45 minutes earlier on Wednesday and Friday; the time goes to coding.
  for (const day of [WEDNESDAY, FRIDAY]) {
    assert.deepEqual(rows(day).slice(3, 5), ["3:15 PM Snack + freshen up", "3:45 PM Coding + product"]);
    assert.deepEqual(rows(day).slice(5), ["7:00 PM Dinner", "7:30 PM Instagram content", "9:00 PM Free time"]);
  }
  for (let i = 0; i < 7; i++) assert.equal(planFor(addDays(SUNDAY, i)).sleep, at("22:30"));
});

test("each weekend day is seven hours of study in three sessions, then building and content", () => {
  for (const day of [SATURDAY, SUNDAY]) {
    const plan = planFor(day);
    assert.equal(plan.wake, at("08:00"));
    assert.equal(splitOf(plan).find((s) => s.kind === "study")!.minutes, 7 * 60);
    assert.deepEqual(rows(day), [
      "8:00 AM Get ready + breakfast",
      "9:00 AM Study session 1",
      "12:00 PM Lunch",
      "1:00 PM Study session 2",
      "3:30 PM Snack + break",
      "4:00 PM Study session 3",
      "5:30 PM Coding + product",
      "7:00 PM Dinner",
      "7:30 PM Instagram content",
      "9:00 PM Free time",
    ]);
  }
  // Seven hours is the most of anything on a weekend day.
  assert.equal(splitOf(planFor(SATURDAY))[0]!.kind, "study");
  // Weekdays have none: school is their studying.
  for (const day of [MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY]) assert.ok(!planFor(day).blocks.some((b) => b.kind === "study"));
});

test("the split adds up to the waking day", () => {
  const plan = planFor(MONDAY);
  const split = splitOf(plan);
  assert.equal(split.reduce((sum, s) => sum + s.minutes, 0), plan.sleep - plan.wake);
  assert.deepEqual(split[0], { kind: "school", minutes: 450 });
  assert.equal(split.find((s) => s.kind === "build")!.minutes, 240);
  assert.equal(split.find((s) => s.kind === "content")!.minutes, 90);
});

test("the split adds up over a week too", () => {
  const week = Array.from({ length: 7 }, (_, i) => planFor(addDays(SUNDAY, i)));
  const split = splitOf(...week);
  const awake = week.reduce((sum, p) => sum + p.sleep - p.wake, 0);
  assert.equal(split.reduce((sum, s) => sum + s.minutes, 0), awake);
  assert.equal(split.find((s) => s.kind === "study")!.minutes, 14 * 60);
  // 7:30 on Monday, Tuesday and Thursday, 4:15 on Wednesday, 5:15 on Friday.
  assert.equal(split.find((s) => s.kind === "school")!.minutes, 3 * 450 + 255 + 315);
  for (let i = 1; i < split.length; i++) assert.ok(split[i - 1]!.minutes >= split[i]!.minutes, "most first");
});

test("a night runs from bedtime to the next morning's wake-up", () => {
  assert.deepEqual(nightAfter(MONDAY), { sleep: at("22:30"), wake: at("06:00"), minutes: 7.5 * 60 });
  // Friday night and Saturday night run into a weekend morning.
  assert.equal(nightAfter(FRIDAY).minutes, 9.5 * 60);
  assert.equal(nightAfter(SATURDAY).minutes, 9.5 * 60);
  assert.equal(nightAfter(SUNDAY).minutes, 7.5 * 60);
});

test("days side by side share one clock, from the earliest wake-up to just past bedtime", () => {
  const week = Array.from({ length: 7 }, (_, i) => planFor(addDays(SUNDAY, i)));
  assert.deepEqual(axisOf(week), { start: at("06:00"), end: at("22:30") + NIGHT_TAIL });
  // A weekend day on its own starts at its own wake-up.
  assert.deepEqual(axisOf([planFor(SATURDAY)]), { start: at("08:00"), end: at("23:00") });
});

test("now is the block the clock is in, with how far through and what's next", () => {
  const m = momentAt(MONDAY, at("17:45"));
  assert.equal(m.block.title, "Coding + product");
  assert.equal(m.progress, 0.5);
  assert.equal(m.left, 75);
  assert.equal(m.next.title, "Dinner");
  // A boundary belongs to the block starting there.
  assert.equal(momentAt(MONDAY, at("19:00")).block.title, "Dinner");
  assert.equal(momentAt(MONDAY, at("21:30")).next.kind, "sleep");
});

test("before waking up it's still last night", () => {
  const m = momentAt(MONDAY, at("05:00"));
  assert.equal(m.block.kind, "sleep");
  assert.equal(m.block.start, at("22:30") - DAY_MINUTES);
  assert.equal(m.block.end, at("06:00"));
  assert.equal(m.left, 60);
  assert.equal(m.next.title, "Get ready + breakfast");
});

test("after 10:30 the night runs to tomorrow's wake-up", () => {
  const friday = momentAt(FRIDAY, at("23:00"));
  assert.equal(friday.block.kind, "sleep");
  assert.equal(friday.block.end, DAY_MINUTES + at("08:00"));
  assert.equal(friday.left, 9 * 60);
  assert.equal(friday.next.start, DAY_MINUTES + at("08:00"));
  assert.equal(clock(friday.next.start), "8:00 AM");
  assert.equal(momentAt(SUNDAY, at("22:30")).block.end, DAY_MINUTES + at("06:00"));
});

test("times read the way the student writes them", () => {
  assert.equal(clock(0), "12:00 AM");
  assert.equal(clock(at("12:00")), "12:00 PM");
  assert.equal(clock(at("22:30")), "10:30 PM");
  assert.equal(span(at("16:30"), at("19:00")), "4:30 – 7:00 PM");
  assert.equal(span(at("11:00"), at("15:15")), "11:00 AM – 3:15 PM");
  // Narrow columns drop the bare ":00".
  assert.equal(brief(at("16:30"), at("19:00")), "4:30 – 7 PM");
  assert.equal(brief(at("09:00"), at("12:00")), "9 AM – 12 PM");
  assert.equal(brief(at("08:30"), at("16:00")), "8:30 AM – 4 PM");
  assert.equal(brief(at("19:00"), at("19:30")), "7 – 7:30 PM");
  assert.deepEqual([at("06:00"), at("12:00"), at("23:00"), DAY_MINUTES].map(hourLabel), ["6 AM", "12 PM", "11 PM", "12 AM"]);
});

test("days follow the device's calendar", () => {
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-11-01", 1), "2026-11-02"); // the clocks go back that night
  assert.deepEqual(clockAt(new Date(2026, 9, 5, 7, 45, 30).getTime()), { day: MONDAY, minutes: at("07:45") });
});
