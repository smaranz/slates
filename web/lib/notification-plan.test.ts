import assert from "node:assert/strict";
import test from "node:test";

import { parseDueInstant } from "./normalize";
import {
  MAX_PENDING_REMINDERS,
  REMINDER_LEAD_MS,
  planAssignmentReminders,
  type ReminderCandidate,
} from "./notification-plan";
import type { Assignment } from "./types";

const now = new Date(2026, 8, 7, 12, 0, 0, 0);

function assignment(id: string, dueAt?: string | null): Assignment {
  return {
    id,
    courseId: "course-1",
    kind: "assignment",
    submit: "native",
    title: `Assignment ${id}`,
    brief: "",
    due: "Due tomorrow at 8:00 PM",
    dueAt,
    allDay: false,
    dateOffset: 1,
    code: id,
    minutes: 30,
    impact: "medium",
    bucket: "tonight",
    url: "#",
  };
}

function candidate(a: Assignment, overrides: Partial<ReminderCandidate> = {}): ReminderCandidate {
  return {
    assignment: a,
    courseName: "Physics",
    status: "todo",
    archived: false,
    submitted: false,
    ...overrides,
  };
}

test("parses an exact local instant only when due prose contains a clock time", () => {
  const exact = parseDueInstant("Due tomorrow at 8:30 PM", now);
  assert.ok(exact);
  const due = new Date(exact);
  assert.equal(due.getDate(), now.getDate() + 1);
  assert.equal(due.getHours(), 20);
  assert.equal(due.getMinutes(), 30);
  assert.equal(parseDueInstant("Due tomorrow", now), null);
});

test("plans one stable reminder exactly one hour before an upcoming due time", () => {
  const dueAt = new Date(now.getTime() + 6 * 60 * 60_000).toISOString();
  const first = planAssignmentReminders([candidate(assignment("42", dueAt))], now);
  const second = planAssignmentReminders([candidate(assignment("42", dueAt))], now);
  assert.equal(first.length, 1);
  assert.equal(first[0].at.getTime(), Date.parse(dueAt) - REMINDER_LEAD_MS);
  assert.equal(first[0].id, second[0].id);
  assert.match(first[0].body, /^Physics · /);
});

test("excludes date-only, all-day, completed, submitted, archived, and too-close work", () => {
  const later = new Date(now.getTime() + 6 * 60 * 60_000).toISOString();
  const tooClose = new Date(now.getTime() + 30 * 60_000).toISOString();
  const items = [
    candidate(assignment("date-only", null)),
    candidate({ ...assignment("all-day", later), allDay: true }),
    candidate(assignment("done", later), { status: "done" }),
    candidate(assignment("submitted", later), { submitted: true }),
    candidate(assignment("archived", later), { archived: true }),
    candidate(assignment("close", tooClose)),
  ];
  assert.deepEqual(planAssignmentReminders(items, now), []);
});

test("caps the plan so native pending queues stay conservative", () => {
  const items = Array.from({ length: MAX_PENDING_REMINDERS + 8 }, (_, i) =>
    candidate(assignment(String(i), new Date(now.getTime() + (i + 2) * 60 * 60_000).toISOString()))
  );
  assert.equal(planAssignmentReminders(items, now).length, MAX_PENDING_REMINDERS);
});
