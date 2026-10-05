import assert from "node:assert/strict";
import test from "node:test";

import { addDays, clock, clockAt, DAY_MINUTES, momentAt, planFor, span, splitOf } from "./schedule";

// The week the student gave: school 8:30–4:00 Mon/Tue/Thu, 11:00–3:15 Wed,
// 10:00–3:15 Fri, up at 6:00 on school days, the evening split into coding
// and product work, then Instagram content, and weekends for studying,
// building and content.

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

test("weekends have studying, building and content", () => {
  for (const day of [SATURDAY, SUNDAY]) {
    const kinds = new Set(planFor(day).blocks.map((b) => b.kind));
    for (const kind of ["study", "build", "content"] as const) assert.ok(kinds.has(kind), `${day} has no ${kind}`);
    assert.equal(planFor(day).wake, at("08:00"));
  }
});

test("the split adds up to the waking day", () => {
  const plan = planFor(MONDAY);
  const split = splitOf(plan);
  assert.equal(split.reduce((sum, s) => sum + s.minutes, 0), plan.sleep - plan.wake);
  assert.deepEqual(split[0], { kind: "school", minutes: 450 });
  assert.equal(split.find((s) => s.kind === "build")!.minutes, 240);
  assert.equal(split.find((s) => s.kind === "content")!.minutes, 90);
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
});

test("days follow the device's calendar", () => {
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-11-01", 1), "2026-11-02"); // the clocks go back that night
  assert.deepEqual(clockAt(new Date(2026, 9, 5, 7, 45, 30).getTime()), { day: MONDAY, minutes: at("07:45") });
});
