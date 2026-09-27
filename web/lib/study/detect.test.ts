import assert from "node:assert/strict";
import test from "node:test";

import type { Assignment, GradeCategory } from "../types";
import { classify, gradebookOffset, studyTargets } from "./detect";

// Titles and categories from a real board, so the rules are held to the
// items a student actually has rather than to invented ones.

test("counts real tests and quizzes", () => {
  const yes: [string, Parameters<typeof classify>[0]][] = [
    ["quiz", { title: "Reminder: Quiz 2- NEED LOCKDOWN BROWSER", kind: "assignment", category: "Quizzes" }],
    ["test", { title: "APP1 Unit 1 Test Retake/ Alternate Test Reminder", kind: "assignment", category: "Tests" }],
    ["quiz", { title: "Homework Quiz: Ch 4 Sections 4.4-4.6", kind: "assessment" }],
    ["quiz", { title: "Worksheet 2.1 Forces and Newton's Laws HW Quiz & Bring to class", kind: "assessment" }],
    ["quiz", { title: "Project Management Terminology", kind: "assessment" }],
    ["quiz", { title: "GROUP quiz bearing/LOS/LOC", kind: "assignment", category: "Tests/Quizzes/FE" }],
    ["exam", { title: "French Revolution Exam", kind: "assignment" }],
    ["exam", { title: "R3 C1 Examen de escuchar", kind: "assessment" }],
    ["quiz", { title: "LOTF vocab quiz", kind: "assignment" }],
    ["test", { title: "TEST Ch9", kind: "assignment" }],
    ["test", { title: "Chapter 5", kind: "assignment", category: "Tests" }],
    ["exam", { title: "Semester 1 Final Exam", kind: "assignment" }],
  ];
  for (const [kind, input] of yes) assert.equal(classify(input)?.kind, kind, input.title);
});

test("leaves out everything that is about a test, or isn't one", () => {
  const no: Parameters<typeof classify>[0][] = [
    { title: "HW 9/23 FRQ Scan", kind: "assignment" },
    { title: "Unit 1 Test Corrections (In Class Only)", kind: "assignment", category: "Tests" },
    { title: "Hw#16: The ch10 review (lilac)", kind: "assignment" },
    { title: "Quizlet: Pretérito con cambio en la raíz. Estudia las tarjetas", kind: "assignment" },
    { title: "French Revolution Essay", kind: "assignment", category: "Summative" },
    { title: "Caja de mi personalidad: Presentación grabada.", kind: "assignment", category: "Summative Assessments" },
    { title: "Essay Final Draft", kind: "assignment" },
    { title: "Unit 3 Study Guide", kind: "assignment" },
    { title: "Practice Quiz 4", kind: "assessment" },
    { title: "Notebook Check", kind: "assignment", category: "Formative Assessments" },
    { title: "Self-Assessment Reflection", kind: "assignment" },
    { title: "Testing procedures lab", kind: "assignment" },
  ];
  for (const input of no) assert.equal(classify(input), null, input.title);
});

test("reads gradebook dates", () => {
  const today = new Date(2026, 8, 26);
  assert.equal(gradebookOffset("9/28/26 8:30am", today), 2);
  assert.equal(gradebookOffset("10/02/26 10:10am", today), 6);
  assert.equal(gradebookOffset("", today), null);
});

test("lists only what is still ahead and not yet scored, including gradebook-only tests", () => {
  const today = new Date(2026, 8, 26);
  const base = { courseId: "c1", submit: "native", brief: "", code: "", minutes: 0, impact: "low", bucket: "soon", url: "/x" } as const;
  const assignments = [
    { ...base, id: "1", kind: "assignment", title: "French Revolution Exam", due: "Due Monday", dateOffset: 2 },
    { ...base, id: "2", kind: "assignment", title: "LOTF vocab quiz", due: "5 days overdue", dateOffset: -5 },
    { ...base, id: "3", kind: "assessment", title: "R3 C1 Examen de escuchar", due: "", dateOffset: null },
    { ...base, id: "4", kind: "assignment", title: "HW 9/25 Reading", due: "Due Wednesday", dateOffset: 0 },
  ] as Assignment[];
  const gradebook: Record<string, GradeCategory[]> = {
    c1: [
      { cat: "Summative Assessments", weight: 50, earned: 14, possible: 15, items: [{ id: "3", name: "R3 C1 Examen de escuchar", score: "14/15", earned: 14, possible: 15, date: "9/24/26 9:45am" }] },
      { cat: "Tests", weight: 40, earned: 0, possible: 0, items: [{ id: "9", name: "Unit 2 Test", score: "—", earned: null, possible: null, date: "10/08/26 8:30am" }] },
    ],
  };
  const targets = studyTargets({ assignments, gradebook }, today);
  assert.deepEqual(targets.map((t) => [t.id, t.dateOffset]), [["1", 2], ["9", 12]]);
});
