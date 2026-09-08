import type { useStore } from "../store";

type Store = ReturnType<typeof useStore>;

/**
 * The school half, as the counselor sees it.
 *
 * This is the join between the two sides of Slates. Without it the counselor
 * is advising on a transcript the student typed from memory while the real
 * gradebook sits one click away — it would tell them their rigor looks strong
 * while AP Chem quietly sits at 71%.
 *
 * Two shapes, for two jobs. `buildSchoolContext` is a handful of lines that
 * ride along in the system prompt so the counselor always knows roughly where
 * things stand. `buildSchoolRecord` is the full structured picture, handed to
 * the request and read by tools — courses, weighted categories, every open
 * assignment — for when it needs to actually look.
 *
 * Neither invents anything. If nothing has synced, both come back empty and
 * the counselor is told to ask rather than assume.
 */

/** One class, as the counselor reasons about it. */
export interface SchoolCourse {
  name: string;
  short: string;
  period: string;
  /** Schoology's own percentage, or one summed from points. Null when ungraded. */
  pct: number | null;
  letter: string;
  /** Where the grade lands once the student's own what-if scores are counted. */
  projectedPct: number | null;
  projectedLetter: string;
  /** How the grade is weighted, so "the test category is 40%" is answerable. */
  categories: { name: string; weight: number; pct: number | null; earned: number; possible: number }[];
  openCount: number;
  overdueCount: number;
}

export interface SchoolRecord {
  synced: boolean;
  courses: SchoolCourse[];
  /** Unweighted GPA implied by the current percentages, on a 4.0 scale. */
  gpa: number | null;
  /** Work still outstanding, soonest first. */
  upcoming: { title: string; course: string; due: string; daysAway: number | null; impact: string }[];
  overdue: { title: string; course: string; due: string }[];
  /** Marked work from the last stretch, so a slide or a recovery is visible. */
  recent: { title: string; course: string; score: string; pct: number | null }[];
}

/** Standard US 4.0 scale, unweighted — the one admissions offices recompute to. */
function gradePoints(pct: number): number {
  if (pct >= 93) return 4.0;
  if (pct >= 90) return 3.7;
  if (pct >= 87) return 3.3;
  if (pct >= 83) return 3.0;
  if (pct >= 80) return 2.7;
  if (pct >= 77) return 2.3;
  if (pct >= 73) return 2.0;
  if (pct >= 70) return 1.7;
  if (pct >= 67) return 1.3;
  if (pct >= 63) return 1.0;
  if (pct >= 60) return 0.7;
  return 0;
}

export function buildSchoolRecord(s: Store): SchoolRecord {
  const { courses, assignments, gradebook } = s.snapshot;
  if (!courses.length) {
    return { synced: false, courses: [], gpa: null, upcoming: [], overdue: [], recent: [] };
  }

  const rows: SchoolCourse[] = courses.map((course) => {
    const open = assignments.filter(
      (a) => a.courseId === course.id && s.onBoard(a) && s.statusOf(a) !== "done"
    );
    const projection = s.projectionFor(course.id);
    return {
      name: course.name,
      short: course.short,
      period: course.period,
      pct: Number.isFinite(course.pct) && course.pct > 0 ? course.pct : null,
      letter: course.letter,
      projectedPct: projection.pct,
      projectedLetter: projection.letter,
      categories: (gradebook[course.id] ?? []).map((cat) => ({
        name: cat.cat,
        weight: cat.weight,
        pct: cat.pct ?? null,
        earned: cat.earned,
        possible: cat.possible,
      })),
      openCount: open.length,
      overdueCount: open.filter((a) => (a.dateOffset ?? 0) < 0).length,
    };
  });

  const graded = rows.filter((r) => r.pct != null);
  const gpa = graded.length
    ? Math.round((graded.reduce((sum, r) => sum + gradePoints(r.pct as number), 0) / graded.length) * 100) / 100
    : null;

  const nameOf = (courseId: string) => s.courseById(courseId)?.short ?? courseId;

  const outstanding = assignments.filter((a) => s.onBoard(a) && s.statusOf(a) !== "done");

  const upcoming = outstanding
    .filter((a) => a.dateOffset == null || a.dateOffset >= 0)
    .sort((a, b) => (a.dateOffset ?? 99) - (b.dateOffset ?? 99))
    .slice(0, 12)
    .map((a) => ({
      title: a.title,
      course: nameOf(a.courseId),
      due: a.due,
      daysAway: a.dateOffset,
      impact: a.impact,
    }));

  const overdue = outstanding
    .filter((a) => (a.dateOffset ?? 0) < 0)
    .sort((a, b) => (a.dateOffset ?? 0) - (b.dateOffset ?? 0))
    .map((a) => ({ title: a.title, course: nameOf(a.courseId), due: a.due }));

  // Marked work, newest first. A grade the teacher just posted is the single
  // most useful thing the counselor can react to.
  const recent = Object.entries(gradebook)
    .flatMap(([courseId, cats]) =>
      cats.flatMap((cat) =>
        cat.items
          .filter((item) => item.earned != null && item.possible)
          .map((item) => ({
            title: item.name,
            course: nameOf(courseId),
            score: item.score,
            pct:
              item.possible
                ? Math.round(((item.earned as number) / (item.possible as number)) * 1000) / 10
                : null,
            date: item.date,
          }))
      )
    )
    .slice(0, 20)
    .map(({ title, course, score, pct }) => ({ title, course, score, pct }));

  return { synced: true, courses: rows, gpa, upcoming, overdue, recent };
}

/**
 * The same thing boiled down to a few lines for the system prompt.
 *
 * Deliberately much smaller than what the tutor is handed. The tutor needs
 * every assignment's write-up because it is helping with one of them; the
 * counselor needs to know that AP Chem is at 78% and there are nine things
 * open, and can call a tool when it wants more.
 *
 * Returns an empty string when nothing has synced, so the prompt omits the
 * section rather than asserting the student has no courses.
 */
export function buildSchoolContext(s: Store): string {
  const record = buildSchoolRecord(s);
  if (!record.synced) return "";

  const lines: string[] = [];

  for (const course of record.courses) {
    const grade = course.pct != null ? `${course.pct.toFixed(1)}% (${course.letter})` : "ungraded";
    const projected =
      course.projectedPct != null &&
      course.pct != null &&
      Math.round(course.projectedPct * 10) !== Math.round(course.pct * 10)
        ? `, projected ${course.projectedPct.toFixed(1)}% with their own what-if scores`
        : "";
    lines.push(
      `- ${course.name} (period ${course.period}): ${grade}${projected}` +
        ` — ${course.openCount} open${course.overdueCount ? `, ${course.overdueCount} overdue` : ""}`
    );
  }

  if (record.gpa != null) {
    lines.push(
      "",
      `Unweighted GPA implied by these percentages this term: ${record.gpa.toFixed(2)}. ` +
        "This is one term on a standard 4.0 scale, not a cumulative transcript GPA — treat it as a signal, " +
        "and use the profile's GPA for anything about their actual application."
    );
  }

  if (record.overdue.length) {
    lines.push("", `Overdue right now: ${record.overdue.slice(0, 5).map((a) => `${a.title} (${a.course})`).join(", ")}`);
  }

  if (record.upcoming.length) {
    lines.push("", "Due next:");
    for (const a of record.upcoming.slice(0, 6)) {
      lines.push(`- ${a.title} (${a.course}) — ${a.due}`);
    }
  }

  return lines.join("\n");
}
