import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_ASSIGNMENTS, DEMO_COURSES } from "./demo";
import { buildTutorStarters, shortTitle, type TutorStarterSource } from "./tutor-starters";
import type { Assignment, Bucket, Course, Status } from "./types";

function source(
  courses: Course[],
  assignments: Assignment[],
  extras: {
    archived?: string[];
    status?: Record<string, Status>;
    buckets?: Record<string, Bucket>;
  } = {}
): TutorStarterSource {
  const archived = new Set(extras.archived ?? []);
  const status = extras.status ?? {};
  const buckets = extras.buckets ?? {};
  return {
    courses,
    assignments,
    statusOf: (a) => (a.bucket === "done" ? "done" : (status[a.id] ?? "todo")),
    bucketOf: (a) => (a.bucket === "done" ? "done" : (buckets[a.id] ?? a.bucket)),
    onBoard: (a) => !archived.has(a.id),
  };
}

test("demo board names real work and the weakest course, not stock Calc copy", () => {
  const starters = buildTutorStarters(source(DEMO_COURSES, DEMO_ASSIGNMENTS));
  const labels = starters.map((s) => s.label);
  assert.equal(labels.length, 3);
  assert.ok(labels.some((l) => l.includes("Unit 6 problem set")));
  assert.ok(labels.some((l) => /Vocab set 9|Gatsby|enzyme/i.test(l)));
  assert.ok(labels.some((l) => l.includes("Calc BC")));
  assert.ok(!labels.includes("Explain series convergence tests"));
});

test("an empty board does not invent a class the student does not have", () => {
  const labels = buildTutorStarters(source([], [])).map((s) => s.label);
  assert.deepEqual(labels, [
    "What should I work on?",
    "Help me make a study plan",
    "Quiz me on this week's material",
  ]);
  assert.ok(labels.every((l) => !/calc|series|gatsby/i.test(l)));
});

test("courses without open work still get named", () => {
  const labels = buildTutorStarters(source(DEMO_COURSES, [])).map((s) => s.label);
  assert.ok(labels.some((l) => l.includes("Calc BC")));
  assert.ok(labels.some((l) => l.includes("AP Bio") || l.includes("APUSH") || l.includes("Spanish")));
});

test("ignores finished and swept work", () => {
  const onlyDone = DEMO_ASSIGNMENTS.filter((a) => a.bucket === "done");
  const labels = buildTutorStarters(source(DEMO_COURSES, onlyDone)).map((s) => s.label);
  assert.ok(labels.every((l) => !/bibliography|respiration/i.test(l)));
  assert.ok(labels.some((l) => l.includes("Calc BC")));
});

test("a lone overdue quiz becomes a review chip", () => {
  const quiz: Assignment = {
    ...DEMO_ASSIGNMENTS[3],
    id: "q1",
    title: "Chapter 4 quiz",
    kind: "quiz",
    bucket: "overdue",
    dateOffset: -1,
    courseId: "apbio",
  };
  const labels = buildTutorStarters(source([DEMO_COURSES[0]], [quiz])).map((s) => s.label);
  assert.ok(labels[0].startsWith("Help me review for"));
  assert.ok(labels[0].includes("Chapter 4 quiz"));
});

test("shortTitle keeps a dash clause off the chip", () => {
  assert.equal(shortTitle("Unit 6 problem set — series convergence"), "Unit 6 problem set");
  assert.equal(shortTitle("Lab writeup: enzyme rates"), "Lab writeup: enzyme rates");
  assert.equal(shortTitle("Engineering Fields Presentation SUBMISSION"), "Engineering Fields Presentation");
});

test("a real board names the overdue work, a quiz, and the weakest class", () => {
  const courses: Course[] = [
    { ...DEMO_COURSES[0], id: "phys", name: "AP Physics 1", short: "AP Physics 1", pct: 93, letter: "A" },
    { ...DEMO_COURSES[1], id: "engg", name: "Intro Engineering", short: "Intro Engineering...", pct: 0, letter: "" },
    { ...DEMO_COURSES[2], id: "pre", name: "Pre-Calculus H", short: "Pre-Calculus H", pct: 87, letter: "B+" },
    { ...DEMO_COURSES[3], id: "span", name: "Spanish 3", short: "Spanish 3", pct: 100, letter: "A" },
  ];
  const assignments: Assignment[] = [
    { ...DEMO_ASSIGNMENTS[0], id: "1", courseId: "engg", title: "Engineering Fields Presentation SUBMISSION", bucket: "overdue", dateOffset: -2, kind: "assignment" },
    { ...DEMO_ASSIGNMENTS[1], id: "2", courseId: "phys", title: "HW 9/9 APCR", bucket: "soon", dateOffset: 2, kind: "assignment" },
    { ...DEMO_ASSIGNMENTS[3], id: "3", courseId: "span", title: "C.1 2026 Prueba de vocabulario", bucket: "week", dateOffset: 5, kind: "assessment" },
    { ...DEMO_ASSIGNMENTS[2], id: "4", courseId: "span", title: "Monday 9/14: Meet in Library for WH", bucket: "soon", dateOffset: 3, kind: "assignment" },
  ];
  const labels = buildTutorStarters(source(courses, assignments)).map((s) => s.label);
  assert.ok(labels.some((l) => l.includes("Engineering Fields Presentation") && !l.includes("SUBMISSION")));
  assert.ok(labels.some((l) => /prueba|vocabulario/i.test(l)));
  assert.ok(labels.some((l) => l.includes("Pre-Calculus H")));
  assert.ok(labels.every((l) => !/library|calc grade|series/i.test(l)));
});
