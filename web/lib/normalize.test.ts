import assert from "node:assert/strict";
import test from "node:test";

import { bucketFor, isAfterDeadline, normalizeSnapshot, parseDueOffset, refreshDates } from "./normalize";

// Thursday, September 24, 2026, mid-morning local time.
const now = new Date(2026, 8, 24, 9, 30);

test("Schoology's own due strings land on the right day", () => {
  const cases: [string, number | null][] = [
    ["Due Thursday, September 24, 2026 at 11:59 pm", 0],
    ["Due Thursday, September 24, 2026 at 8:30 am", 0],
    // Date with no time: Schoology leaves a dangling "at". These used to parse as undated.
    ["Due Thursday, September 24, 2026 at", 0],
    ["Due Friday, September 25, 2026 at 8:30 am", 1],
    ["Due Friday, September 25, 2026 at 1:35 pm", 1],
    ["Due Monday, September 28, 2026 at", 4],
    ["Due Thursday, October 1, 2026 at", 7],
    ["Due Friday, September 5, 2026 11:59 pm", -19],
    ["Due Today", 0],
    ["Due today at 3:00 pm", 0],
    ["Due Tomorrow", 1],
    ["Due tomorrow at 8:30 AM", 1],
    ["This was due on Tuesday, September 22, 2026 at 11:59 pm", -2],
    ["3 days overdue", -3],
    ["1 day overdue", -1],
  ];
  for (const [text, want] of cases) assert.equal(parseDueOffset(text, now), want, text);
});

test("short and numeric dates", () => {
  assert.equal(parseDueOffset("Due Sept 25", now), 1);
  assert.equal(parseDueOffset("Due Sep 25th", now), 1);
  assert.equal(parseDueOffset("Due Oct 2", now), 8);
  assert.equal(parseDueOffset("Due 9/25/2026", now), 1);
  assert.equal(parseDueOffset("Due 9/25", now), 1);
  assert.equal(parseDueOffset("Due 2026-09-25", now), 1);
  assert.equal(parseDueOffset("Due Feb 31", now), null);
});

test("weekdays count forward from today", () => {
  assert.equal(parseDueOffset("Due Thursday", now), 0);
  assert.equal(parseDueOffset("Due Friday", now), 1);
  assert.equal(parseDueOffset("Due Friday at 8:30 am", now), 1);
  assert.equal(parseDueOffset("Due Wednesday", now), 6);
  assert.equal(parseDueOffset("Due next Friday", now), 8);
});

test("a yearless date near New Year picks the nearest year", () => {
  const dec30 = new Date(2026, 11, 30, 12);
  assert.equal(parseDueOffset("Due Jan 4", dec30), 5);
  const jan2 = new Date(2027, 0, 2, 12);
  assert.equal(parseDueOffset("Due Dec 30", jan2), -3);
});

test("columns mean exactly today, tomorrow, later", () => {
  assert.equal(bucketFor(-2), "overdue");
  assert.equal(bucketFor(0), "tonight");
  assert.equal(bucketFor(1), "soon");
  assert.equal(bucketFor(2), "week");
  assert.equal(bucketFor(null), "week");
});

test("a card can be pulled earlier, never past its due day", () => {
  assert.equal(isAfterDeadline("soon", 0), true); // due today, dragged to Tomorrow
  assert.equal(isAfterDeadline("week", 1), true); // due tomorrow, dragged to Later
  assert.equal(isAfterDeadline("tonight", 5), false); // next week's work, pulled into Today
  assert.equal(isAfterDeadline("tonight", -3), false); // overdue, planned for today
  assert.equal(isAfterDeadline("soon", -3), true);
  assert.equal(isAfterDeadline("week", null), false); // undated: anywhere
});

const course = { id: "c1", name: "Precalculus" };
function snap(assignment: Record<string, unknown>) {
  return normalizeSnapshot(
    { courses: [course], assignments: [{ id: "a1", courseId: "c1", title: "HW", ...assignment }] } as never,
    now
  ).assignments[0]!;
}

test("an all-day ISO date is a calendar day, not UTC midnight", () => {
  assert.equal(snap({ dueAt: "2026-09-25", allDay: true }).dateOffset, 1);
  assert.equal(snap({ dueAt: "2026-09-25T00:00:00Z", allDay: true }).dateOffset, 1);
  assert.equal(snap({ dueAt: "2026-09-24", allDay: true }).dateOffset, 0);
});

test("a stale stored offset loses to the real due date", () => {
  const a = snap({ due: "Due Friday, September 25, 2026 at 8:30 am", dateOffset: 2 });
  assert.equal(a.dateOffset, 1);
  assert.equal(a.bucket, "soon");
});

test("the board re-counts when the day changes", () => {
  const s = normalizeSnapshot(
    {
      courses: [course],
      assignments: [{ id: "a1", courseId: "c1", title: "HW", due: "Due Friday, September 25, 2026 at 8:30 am" }],
    } as never,
    now
  );
  assert.equal(s.assignments[0]!.bucket, "soon");
  const friday = refreshDates(s, new Date(2026, 8, 25, 0, 1));
  assert.equal(friday.assignments[0]!.dateOffset, 0);
  assert.equal(friday.assignments[0]!.bucket, "tonight");
  assert.equal(refreshDates(friday, new Date(2026, 8, 25, 18)), friday, "no change, same object");
});
