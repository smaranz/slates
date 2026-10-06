import assert from "node:assert/strict";
import test from "node:test";

import { ALERT_GRACE_MS, alertsBetween, alertsDue, timeOf } from "./alerts";
import { addDays, clockAt, planFor } from "./schedule";

const SUNDAY = "2026-10-04";
const MONDAY = "2026-10-05";
const TUESDAY = "2026-10-06";
const FRIDAY = "2026-10-09";
const SATURDAY = "2026-10-10";

const at = (day: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return timeOf(day, h! * 60 + m!);
};

const dayOf = (day: string) => alertsBetween(at(day, "00:00"), at(day, "23:59"));
const said = (day: string) => dayOf(day).map((a) => `${new Date(a.at).toTimeString().slice(0, 5)} ${a.title}`);

test("a minute of a day is that minute on the device's clock", () => {
  assert.deepEqual(clockAt(at(MONDAY, "17:15")), { day: MONDAY, minutes: 17 * 60 + 15 });
  // The clocks go back early on 1 November; every block still starts when it says.
  for (const block of planFor("2026-11-01").blocks) assert.deepEqual(clockAt(timeOf("2026-11-01", block.start)), { day: "2026-11-01", minutes: block.start });
});

test("each block speaks up as it starts, F45 a quarter of an hour early as well, and bedtime last", () => {
  assert.deepEqual(said(MONDAY), [
    "06:00 Get ready + breakfast",
    "07:00 Study",
    "08:30 School",
    "16:00 Snack + freshen up",
    "16:30 Homework",
    "17:15 F45 in 15 minutes",
    "17:30 F45",
    "18:15 Homework",
    "19:00 Codestarters meeting",
    "19:30 Dinner",
    "20:00 Homework",
    "21:15 Instagram content",
    "22:00 Free time",
    "22:30 Sleep",
  ]);
  const monday = dayOf(MONDAY);
  assert.equal(monday.find((a) => a.title === "Homework")!.body, "4:30 – 5:30 PM, then F45");
  assert.equal(monday.find((a) => a.title === "Free time")!.body, "10:00 – 10:30 PM, then sleep");
  assert.equal(monday.find((a) => a.kind === "f45")!.body, "Class 5:30 – 6:15 PM at F45 Cupertino. Time to head out.");
  assert.equal(monday.at(-1)!.body, "Lights out. Up at 6:00 AM.");
  // Friday night runs into a weekend morning.
  assert.equal(dayOf(FRIDAY).at(-1)!.body, "Lights out. Up at 8:00 AM.");
});

test("the loud alert comes 15 minutes before every class", () => {
  const warnings = Array.from({ length: 7 }, (_, i) =>
    dayOf(addDays(SUNDAY, i))
      .filter((a) => a.kind === "f45")
      .map((a) => new Date(a.at).toTimeString().slice(0, 5)),
  );
  // Sunday to Saturday.
  assert.deepEqual(warnings, [["09:45"], ["17:15"], ["18:15"], ["18:15"], ["18:15"], ["17:15"], ["09:45"]]);
  assert.equal(dayOf(SATURDAY).filter((a) => a.kind === "f45").length, 1);
  assert.equal(dayOf(SUNDAY).find((a) => a.kind === "f45")!.body, "Class 10:00 – 10:45 AM at F45 Cupertino. Time to head out.");
});

test("a check hears what came due since the last one, across midnight too", () => {
  const due = alertsDue(at(MONDAY, "17:14"), 0, at(MONDAY, "17:15") + 250);
  assert.deepEqual(due.map((a) => a.title), ["F45 in 15 minutes"]);
  assert.deepEqual(alertsBetween(at(MONDAY, "22:29"), at(TUESDAY, "06:00")).map((a) => a.title), ["Sleep", "Get ready + breakfast"]);
  // Nothing due between two blocks.
  assert.deepEqual(alertsDue(at(MONDAY, "16:31"), 0, at(MONDAY, "16:32")), []);
});

test("waking the Mac doesn't replay the afternoon, and nothing sounds twice", () => {
  // Asleep from 3:00 to 5:16: only the F45 warning a minute ago is still worth hearing.
  assert.deepEqual(alertsDue(at(MONDAY, "15:00"), 0, at(MONDAY, "17:16")).map((a) => a.title), ["F45 in 15 minutes"]);
  // Two minutes is the most an alert may be late.
  assert.deepEqual(alertsDue(at(MONDAY, "15:00"), 0, at(MONDAY, "17:15") + ALERT_GRACE_MS + 1), []);
  // Already sounded (say, before a reload): not again.
  assert.deepEqual(alertsDue(at(MONDAY, "17:14"), at(MONDAY, "17:15"), at(MONDAY, "17:16")), []);
});
