import assert from "node:assert/strict";
import test from "node:test";

import { addDays, axisOf, brief, clock, clockAt, DAY_MINUTES, hourLabel, momentAt, nightAfter, NIGHT_TAIL, planFor, span, splitOf } from "./schedule";

// The week the student gave: school 8:30–4:00 Mon/Tue/Thu, 11:00–3:15 Wed,
// 10:00–3:15 Fri, up at 6:00 on school days with an hour and a half of
// study before school, at least three hours of homework after it around F45,
// then Instagram content and free time; Codestarters on Monday evenings; and
// seven hours of study on each weekend day around a 10:00 class.

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

test("school days start at 6:00: an hour to get ready, then study until 8:30", () => {
  for (const day of [MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY]) {
    const plan = planFor(day);
    assert.equal(plan.wake, at("06:00"));
    const [ready, study] = plan.blocks;
    assert.deepEqual([ready!.start, ready!.end, ready!.kind], [at("06:00"), at("07:00"), "routine"]);
    assert.deepEqual([study!.start, study!.end, study!.kind], [at("07:00"), at("08:30"), "study"]);
  }
  // Wednesday and Friday start later, and the rest of the morning is coding.
  assert.deepEqual(rows(WEDNESDAY).slice(2, 4), ["8:30 AM Coding + product", "11:00 AM School"]);
  assert.deepEqual(rows(FRIDAY).slice(2, 4), ["8:30 AM Coding + product", "10:00 AM School"]);
});

test("after school: a snack, homework around F45 and dinner, Instagram, free time, sleep at 10:30", () => {
  // Monday: the 5:30 class, then Codestarters at 7:00, so dinner is at 7:30.
  assert.deepEqual(rows(MONDAY).slice(3), [
    "4:00 PM Snack + freshen up",
    "4:30 PM Homework",
    "5:30 PM F45",
    "6:15 PM Homework",
    "7:00 PM Codestarters meeting",
    "7:30 PM Dinner",
    "8:00 PM Homework",
    "9:15 PM Instagram content",
    "10:00 PM Free time",
  ]);
  // The 6:30 class runs past 7:00, so dinner follows it.
  for (const day of [TUESDAY, THURSDAY]) {
    assert.deepEqual(rows(day).slice(3), [
      "4:00 PM Snack + freshen up",
      "4:30 PM Homework",
      "6:30 PM F45",
      "7:15 PM Dinner",
      "7:45 PM Homework",
      "8:45 PM Instagram content",
      "9:45 PM Free time",
    ]);
  }
  // Home 45 minutes earlier on Wednesday and Friday; it goes to homework.
  assert.deepEqual(rows(WEDNESDAY).slice(4), [
    "3:15 PM Snack + freshen up",
    "3:45 PM Homework",
    "6:30 PM F45",
    "7:15 PM Dinner",
    "7:45 PM Homework",
    "8:45 PM Instagram content",
    "9:45 PM Free time",
  ]);
  assert.deepEqual(rows(FRIDAY).slice(4), [
    "3:15 PM Snack + freshen up",
    "3:45 PM Homework",
    "5:30 PM F45",
    "6:15 PM Homework",
    "7:00 PM Dinner",
    "7:30 PM Homework",
    "8:00 PM Instagram content",
    "9:00 PM Free time",
  ]);
  for (let i = 0; i < 7; i++) assert.equal(planFor(addDays(SUNDAY, i)).sleep, at("22:30"));
});

test("every school day has at least three hours of homework and an hour and a half of study", () => {
  const minutes = (day: string, kind: string) => planFor(day).blocks.reduce((sum, b) => sum + (b.kind === kind ? b.end - b.start : 0), 0);
  for (const day of [MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY]) {
    assert.ok(minutes(day, "homework") >= 3 * 60, `${day} has ${minutes(day, "homework")} minutes of homework`);
    assert.equal(minutes(day, "study"), 90);
  }
  // Wednesday's early finish makes it three and three quarter hours.
  assert.equal(minutes(WEDNESDAY, "homework"), 3 * 60 + 45);
  // What's left goes to an hour of Instagram (45 minutes on Monday), then free time.
  assert.deepEqual([MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY].map((day) => minutes(day, "content")), [45, 60, 60, 60, 60]);
  assert.deepEqual([MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY].map((day) => minutes(day, "free")), [30, 45, 45, 45, 90]);
});

test("Codestarters meets on Monday evenings, 7:00–7:30", () => {
  const meetings = (day: string) => planFor(day).blocks.filter((b) => b.title === "Codestarters meeting").map((b) => span(b.start, b.end));
  assert.deepEqual(meetings(MONDAY), ["7:00 – 7:30 PM"]);
  for (let i = 0; i < 7; i++) if (addDays(SUNDAY, i) !== MONDAY) assert.deepEqual(meetings(addDays(SUNDAY, i)), []);
});

test("F45 is the 5:30 class on Monday and the studio's last class every other day", () => {
  const classes = (day: string) => planFor(day).blocks.filter((b) => b.kind === "workout").map((b) => `${b.title} ${span(b.start, b.end)}`);
  assert.deepEqual(classes(MONDAY), ["F45 5:30 – 6:15 PM"]);
  for (const day of [TUESDAY, WEDNESDAY, THURSDAY]) assert.deepEqual(classes(day), ["F45 6:30 – 7:15 PM"]);
  assert.deepEqual(classes(FRIDAY), ["F45 5:30 – 6:15 PM"]);
  // Saturday's class is an hour, Sunday's the usual 45 minutes.
  assert.deepEqual(classes(SATURDAY), ["F45 10:00 – 11:00 AM"]);
  assert.deepEqual(classes(SUNDAY), ["F45 10:00 – 10:45 AM"]);
});

test("each weekend day is still seven hours of study, in four sessions around F45", () => {
  const saturday = [
    "8:00 AM Get ready + breakfast",
    "9:00 AM Study session 1",
    "10:00 AM F45",
    "11:00 AM Study session 2",
    "1:00 PM Lunch",
    "2:00 PM Study session 3",
    "4:00 PM Snack + break",
    "4:30 PM Study session 4",
    "6:30 PM Coding + product",
    "7:00 PM Dinner",
    "7:30 PM Instagram content",
    "9:00 PM Free time",
  ];
  assert.deepEqual(rows(SATURDAY), saturday);
  // Sunday's shorter class leaves a quarter of an hour to get home; the study sessions don't move.
  assert.deepEqual(rows(SUNDAY), [...saturday.slice(0, 3), "10:45 AM Head home", ...saturday.slice(3)]);
  for (const day of [SATURDAY, SUNDAY]) {
    const plan = planFor(day);
    assert.equal(plan.wake, at("08:00"));
    assert.equal(splitOf(plan).find((s) => s.kind === "study")!.minutes, 7 * 60);
    // Seven hours is the most of anything on a weekend day.
    assert.equal(splitOf(plan)[0]!.kind, "study");
  }
  // Weekend hours stay study, the student's pick: none of them is labelled homework.
  for (const day of [SATURDAY, SUNDAY]) assert.ok(!planFor(day).blocks.some((b) => b.kind === "homework"));
});

test("the split adds up to the waking day", () => {
  const plan = planFor(MONDAY);
  const split = splitOf(plan);
  assert.equal(split.reduce((sum, s) => sum + s.minutes, 0), plan.sleep - plan.wake);
  assert.deepEqual(split.slice(0, 2), [
    { kind: "school", minutes: 450 },
    { kind: "homework", minutes: 180 },
  ]);
  assert.equal(split.find((s) => s.kind === "study")!.minutes, 90);
  assert.equal(split.find((s) => s.kind === "workout")!.minutes, 45);
  assert.equal(split.find((s) => s.kind === "content")!.minutes, 45);
  // Monday's only coding + product is the Codestarters meeting.
  assert.equal(split.find((s) => s.kind === "build")!.minutes, 30);
});

test("the split adds up over a week too", () => {
  const week = Array.from({ length: 7 }, (_, i) => planFor(addDays(SUNDAY, i)));
  const split = splitOf(...week);
  const awake = week.reduce((sum, p) => sum + p.sleep - p.wake, 0);
  assert.equal(split.reduce((sum, s) => sum + s.minutes, 0), awake);
  // Seven hours each weekend day, an hour and a half each school day.
  assert.equal(split.find((s) => s.kind === "study")!.minutes, 2 * 7 * 60 + 5 * 90);
  // Three hours a school day, three and three quarters on Wednesday.
  assert.equal(split.find((s) => s.kind === "homework")!.minutes, 4 * 180 + 225);
  // 7:30 on Monday, Tuesday and Thursday, 4:15 on Wednesday, 5:15 on Friday.
  assert.equal(split.find((s) => s.kind === "school")!.minutes, 3 * 450 + 255 + 315);
  // Seven classes, Saturday's an hour long.
  assert.equal(split.find((s) => s.kind === "workout")!.minutes, 6 * 45 + 60);
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
  const m = momentAt(TUESDAY, at("17:30"));
  assert.equal(m.block.title, "Homework");
  assert.equal(m.progress, 0.5);
  assert.equal(m.left, 60);
  assert.equal(m.next.title, "F45");
  const gym = momentAt(MONDAY, at("17:45"));
  assert.equal(gym.block.title, "F45");
  assert.equal(gym.left, 30);
  assert.equal(gym.next.title, "Homework");
  // A boundary belongs to the block starting there.
  assert.equal(momentAt(MONDAY, at("19:00")).block.title, "Codestarters meeting");
  assert.equal(momentAt(MONDAY, at("19:30")).block.title, "Dinner");
  assert.equal(momentAt(MONDAY, at("22:15")).next.kind, "sleep");
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
