import assert from "node:assert/strict";
import test from "node:test";

import { describeSchedule, nextRunAfter, normalizeSchedule, parseDays, parseTime } from "./schedule";

test("times accept 24-hour and am/pm forms", () => {
  assert.equal(parseTime("7:30"), "07:30");
  assert.equal(parseTime("7:30 pm"), "19:30");
  assert.equal(parseTime("12 am"), "00:00");
  assert.equal(parseTime("12pm"), "12:00");
  assert.equal(parseTime("25:00"), null);
  assert.equal(parseTime("soon"), null);
});

test("days accept names, presets, and lists", () => {
  assert.deepEqual(parseDays("weekdays"), [1, 2, 3, 4, 5]);
  assert.deepEqual(parseDays(["Mon", "wed", "FRI"]), [1, 3, 5]);
  assert.deepEqual(parseDays("sat, sun"), [0, 6]);
  assert.deepEqual(parseDays(undefined), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(parseDays("someday"), null);
});

test("weekday routine skips the weekend and never fires twice for the same minute", () => {
  const schedule = normalizeSchedule({ days: "weekdays", time: "07:00" });
  const friday8am = new Date(2026, 8, 25, 8, 0).getTime();
  assert.equal(nextRunAfter(schedule, friday8am), new Date(2026, 8, 28, 7, 0).getTime());
  const monday7am = new Date(2026, 8, 28, 7, 0).getTime();
  assert.equal(nextRunAfter(schedule, monday7am), new Date(2026, 8, 29, 7, 0).getTime());
  assert.equal(nextRunAfter(schedule, monday7am - 1), monday7am);
});

test("intervals have a floor and read naturally", () => {
  const every = normalizeSchedule({ everyMinutes: 1 });
  assert.deepEqual(every, { kind: "every", minutes: 5 });
  assert.equal(nextRunAfter(every, 0), 5 * 60_000);
  assert.equal(describeSchedule({ kind: "every", minutes: 120 }), "Every 2 hours");
  assert.equal(describeSchedule(normalizeSchedule({ days: "weekdays", time: "7:30 am" })), "Weekdays at 7:30 am");
  assert.throws(() => normalizeSchedule({ time: "whenever" }), /isn't a time/);
});
