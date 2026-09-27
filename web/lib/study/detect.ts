import type { Assignment, GradeItem, SyncSnapshot } from "../types";

/**
 * Which items on the board are tests and quizzes — and nothing else.
 *
 * Three signals, strongest first: Schoology's own item type (a test/quiz it
 * runs itself), the gradebook category the teacher filed it under ("Quizzes",
 * "Tests/Quizzes/FE"), and the title. Anything that is *about* a test rather
 * than being one — review sheets, corrections, practice, sign-ups — is out,
 * whatever the other signals say, and so is anything already scored.
 *
 * Over-detecting is the worse failure: a study list with worksheets in it
 * stops being a list of tests. Missing one is recoverable, since any item can
 * still be studied for by hand.
 */

export type TestKind = "test" | "quiz" | "exam";

export interface StudyTarget {
  /** Schoology item id — the assignment's, or the gradebook row's when there is no assignment. */
  id: string;
  courseId: string;
  title: string;
  kind: TestKind;
  /** Why Slates counted it, worded for the student. */
  because: string;
  /** Days from today; null when no date is known. */
  dateOffset: number | null;
  /** The due label as Schoology words it. */
  due: string;
  url: string | null;
  assignment?: Assignment;
}

const TEST_WORDS = /\b(tests?|exams?|examen(?:es)?|pruebas?|quiz(?:zes)?|midterms?|benchmark|final exams?|finals)\b/i;

/** Words that make an item about a test rather than a test. */
const NOT_A_TEST =
  /\b(review|study guide|practice|prep|corrections?|retake form|sign[- ]?ups?|reflections?|self[- ]?assessments?|surveys?|test[- ]taking|testing (?:procedures|lab)|quizlet)\b/i;

/** Categories that hold tests. "Formative" ones mix in worksheets, so they don't count alone. */
const TEST_CATEGORY = /\b(tests?|quiz(?:zes)?|exams?)\b/i;

/** Graded work that sits in test categories without being a test. */
const NOT_TEST_WORK = /\b(essay|project|presentation|lab report|paper|poster|portfolio)\b/i;

function kindOf(word: string | undefined, fallback: TestKind): TestKind {
  if (!word) return fallback;
  if (/exam|midterm|final/i.test(word)) return "exam";
  if (/quiz/i.test(word)) return "quiz";
  return "test";
}

export function classify(input: {
  title: string;
  kind?: string;
  category?: string | null;
  hasAssessment?: boolean;
}): { kind: TestKind; because: string } | null {
  const title = input.title ?? "";
  if (NOT_A_TEST.test(title)) return null;
  const word = TEST_WORDS.exec(title)?.[0];

  if (input.kind === "quiz" || input.kind === "assessment" || input.hasAssessment) {
    return { kind: kindOf(word, "quiz"), because: "A test or quiz in Schoology" };
  }
  const category = input.category ?? "";
  if (category && TEST_CATEGORY.test(category) && !/formative/i.test(category) && !NOT_TEST_WORK.test(title)) {
    return { kind: kindOf(word, /quiz/i.test(category) ? "quiz" : "test"), because: `Filed under “${category}” in your grades` };
  }
  if (word && !NOT_TEST_WORK.test(title)) return { kind: kindOf(word, "test"), because: `The title says “${word}”` };
  return null;
}

/** Gradebook dates read "9/28/26 8:30am". */
export function gradebookOffset(date: string | undefined, today: Date): number | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(date ?? "");
  if (!m) return null;
  const year = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
  const day = new Date(year, Number(m[1]) - 1, Number(m[2]));
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((day.getTime() - start.getTime()) / 86_400_000);
}

/** Every test and quiz still ahead, soonest first; undated ones last. */
export function studyTargets(
  snapshot: Pick<SyncSnapshot, "assignments" | "gradebook">,
  today = new Date(),
): StudyTarget[] {
  const rows = new Map<string, { cat: string; item: GradeItem; courseId: string }>();
  for (const [courseId, cats] of Object.entries(snapshot.gradebook ?? {})) {
    for (const cat of cats ?? []) for (const item of cat.items ?? []) if (item.id) rows.set(item.id, { cat: cat.cat, item, courseId });
  }

  const out: StudyTarget[] = [];
  for (const a of snapshot.assignments ?? []) {
    const row = rows.get(a.id);
    const hit = classify({ title: a.title, kind: a.kind, category: row?.cat, hasAssessment: !!a.assessment });
    if (!hit || a.grade || row?.item.earned != null) continue;
    const offset = a.dateOffset ?? gradebookOffset(row?.item.date, today);
    if (offset !== null && offset < 0) continue;
    out.push({ id: a.id, courseId: a.courseId, title: a.title, kind: hit.kind, because: hit.because, dateOffset: offset, due: a.due, url: a.url || null, assignment: a });
  }

  // A test the teacher set up in the gradebook but never posted to the board.
  const onBoard = new Set((snapshot.assignments ?? []).map((a) => a.id));
  for (const [id, row] of rows) {
    if (onBoard.has(id) || row.item.earned != null) continue;
    const offset = gradebookOffset(row.item.date, today);
    if (offset === null || offset < 0) continue;
    const hit = classify({ title: row.item.name, category: row.cat });
    if (hit) out.push({ id, courseId: row.courseId, title: row.item.name, kind: hit.kind, because: hit.because, dateOffset: offset, due: row.item.date, url: row.item.url ?? null });
  }

  return out.sort((a, b) => (a.dateOffset ?? Number.MAX_SAFE_INTEGER) - (b.dateOffset ?? Number.MAX_SAFE_INTEGER));
}
