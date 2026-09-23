import type { GradeCategory, GradeItem } from "@/lib/types";
import type { RawSnapshot } from "@/lib/normalize";
import {
  schoology,
  keysFromEnv,
  type SchoologyAssignment,
  type SchoologyGrade,
  type SchoologySection,
} from "./client";

/**
 * Build the snapshot the app already knows how to read.
 *
 * `normalizeSnapshot` in lib/normalize.ts is the seam: it takes a RawSnapshot
 * and produces everything the board, the gradebook and the calendar render. So
 * the only job here is to speak the API and hand back that one shape — nothing
 * downstream needs to know where the numbers came from.
 */

/** "test_quiz" and friends, mapped onto the three kinds a card can draw. */
function kindOf(a: SchoologyAssignment): "assignment" | "quiz" | "discussion" {
  switch (a.type) {
    case "test_quiz":
      return "quiz";
    case "discussion":
      return "discussion";
    default:
      return "assignment";
  }
}

/**
 * Schoology writes due dates as "2026-09-12 23:59:00" with no zone, meaning the
 * school's local time. Treating that as UTC shifts every evening deadline onto
 * the wrong day for anyone west of Greenwich, so it is parsed as local time —
 * which is the school's time for the student actually looking at the screen.
 */
function dueInstant(due: string | undefined): { dueAt: string | null; allDay: boolean } {
  const raw = (due ?? "").trim();
  if (!raw) return { dueAt: null, allDay: false };

  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(raw);
  if (!m) return { dueAt: null, allDay: false };

  const [, y, mo, d, hh, mm, ss] = m;
  const date = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(hh ?? 0),
    Number(mm ?? 0),
    Number(ss ?? 0)
  );
  if (Number.isNaN(date.getTime())) return { dueAt: null, allDay: false };

  // Schoology's own convention for "no particular time": 11:59pm is a real
  // deadline students plan around, so only a literal midnight reads as all-day.
  const allDay = hh === undefined || (hh === "00" && mm === "00");
  return { dueAt: date.toISOString(), allDay };
}

/** A section's display name, preferring the section title when one is set. */
function courseName(s: SchoologySection): string {
  const title = s.course_title?.trim() || "Untitled course";
  const section = s.section_title?.trim();
  return section && section.toLowerCase() !== title.toLowerCase() ? `${title} - ${section}` : title;
}

function numeric(value: unknown): number | null {
  const n = typeof value === "string" ? parseFloat(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Fold one section's grades into the category rows the gradebook draws.
 *
 * Excused items are dropped rather than scored zero — an excused assignment is
 * one the student was told not to do, and counting it as 0/10 misreports the
 * grade in the one direction that causes panic.
 */
function categoriesFor(
  categories: { id: string | number; title: string; weight?: number }[],
  assignments: SchoologyAssignment[],
  grades: SchoologyGrade[]
): GradeCategory[] {
  const byId = new Map(assignments.map((a) => [String(a.id), a]));
  const gradeByCategory = new Map<string, SchoologyGrade[]>();

  for (const g of grades) {
    if (g.exception) continue;
    const assignment = byId.get(String(g.assignment_id));
    const cat = String(g.category_id ?? assignment?.grading_category ?? "0");
    const list = gradeByCategory.get(cat);
    if (list) list.push(g);
    else gradeByCategory.set(cat, [g]);
  }

  const rows: GradeCategory[] = [];
  for (const cat of categories) {
    const mine = gradeByCategory.get(String(cat.id)) ?? [];

    let earned = 0;
    let possible = 0;
    const items: GradeItem[] = [];

    for (const g of mine) {
      const assignment = byId.get(String(g.assignment_id));
      const score = numeric(g.grade);
      const max = numeric(g.max_points) ?? numeric(assignment?.max_points) ?? 0;

      // Nothing scored yet is not the same as scoring zero: it must not enter
      // the arithmetic at all, or an ungraded final drags the average to the
      // floor the moment the teacher creates it.
      if (score !== null && max > 0) {
        earned += score;
        possible += max;
      }

      items.push({
        id: String(g.assignment_id),
        name: assignment?.title ?? "Assignment",
        score: score === null ? "—" : max > 0 ? `${score}/${max}` : String(score),
        earned: score,
        possible: max,
        // When the teacher entered the mark, which is the only date Schoology
        // attaches to a grade. Undated rows sort last rather than to 1970.
        date: g.timestamp
          ? new Date(g.timestamp * 1000).toLocaleDateString([], {
              month: "numeric",
              day: "numeric",
              year: "2-digit",
            })
          : "",
      });
    }

    rows.push({
      cat: cat.title,
      weight: Math.round(cat.weight ?? 0),
      pct: possible > 0 ? (earned / possible) * 100 : null,
      earned: Math.round(earned * 100) / 100,
      possible: Math.round(possible * 100) / 100,
      items,
    });
  }

  return rows;
}

/**
 * The message list.
 *
 * Sender names cost one call each, so they are resolved once per distinct
 * author and cached across the batch — a busy inbox is usually four teachers
 * and a hundred messages. A name that will not resolve degrades to "Schoology"
 * rather than failing the whole sync for a cosmetic field.
 */
async function inbox(uid: string | number): Promise<RawSnapshot["messages"]> {
  const messages = await schoology.inbox(uid).catch(() => []);
  if (!messages.length) return [];

  const names = new Map<string, string>();
  for (const id of new Set(messages.map((m) => String(m.author_id ?? "")).filter(Boolean))) {
    const who = await schoology.user(id).catch(() => undefined);
    names.set(id, who?.name_display?.trim() || who?.name_first?.trim() || "Schoology");
  }

  return messages.map((m) => ({
    id: String(m.id),
    from: names.get(String(m.author_id ?? "")) ?? "Schoology",
    // Schoology files messages against a person, not a section — the inbox has
    // no course to attribute them to, and inventing one would mis-file them.
    courseId: "",
    subject: m.subject?.trim() || "(no subject)",
    body: m.message?.trim() ?? "",
    time: m.last_updated
      ? new Date(m.last_updated * 1000).toLocaleDateString([], {
          month: "short",
          day: "numeric",
        })
      : "",
    unread: m.message_status === "unread",
  }));
}

export interface SnapshotResult {
  snapshot: RawSnapshot;
  stats: { courses: number; assignments: number; graded: number };
  student: string;
}

export async function buildSnapshot(): Promise<SnapshotResult> {
  const keys = keysFromEnv();
  const me = await schoology.me(keys);
  const uid = me.uid;

  // A teacher's key would return the sections they teach; Slates is a student
  // workspace, so anything the account administers is not "my classes".
  const sections = (await schoology.sections(uid, keys)).filter((s) => !s.admin);

  const courses: RawSnapshot["courses"] = [];
  const assignments: RawSnapshot["assignments"] = [];
  const gradebook: Record<string, GradeCategory[]> = {};
  const courseGrades: Record<string, { pct: number; letter: string }> = {};
  let graded = 0;

  // Sequential on purpose: three calls per section against a district API that
  // rate-limits aggressively, and a student has a dozen sections at most.
  for (const section of sections) {
    const id = String(section.id);

    const [items, categories, report] = await Promise.all([
      schoology.assignments(id, keys).catch(() => [] as SchoologyAssignment[]),
      schoology.gradingCategories(id, keys).catch(() => []),
      schoology.grades(uid, id, keys).catch(() => undefined),
    ]);

    courses.push({
      id,
      name: courseName(section),
      period: section.section_school_code?.trim() || "",
      url: section.link || `https://app.schoology.com/course/${id}`,
    });

    for (const a of items) {
      const { dueAt, allDay } = dueInstant(a.due);
      assignments.push({
        id: String(a.id),
        courseId: id,
        title: a.title?.trim() || "Untitled",
        kind: kindOf(a),
        brief: a.description?.trim() ?? "",
        dueAt,
        allDay,
        /*
         * Always "none". Schoology's API exposes whether an item has a dropbox
         * but gives a student-scoped key no way to put a file in it, so Slates
         * must not draw a hand-in button it cannot honour. The card keeps its
         * `url`, which opens the real assignment page.
         */
        submit: "none",
        completed: a.completed === 1,
        url: a.web_url || `https://app.schoology.com/assignment/${a.id}`,
        points: numeric(a.max_points),
      });
    }

    const periodGrades = report?.period?.flatMap((p) => p.assignment ?? []) ?? [];
    graded += periodGrades.filter((g) => numeric(g.grade) !== null).length;

    if (categories.length) {
      gradebook[id] = categoriesFor(
        categories.map((c) => ({ id: c.id, title: c.title, weight: c.weight })),
        items,
        periodGrades
      );
    }

    // Schoology's own number for the course, when it publishes one. Slates
    // prefers it over its own arithmetic for exactly the reason normalize.ts
    // documents: the two can disagree, and Schoology's is the one on the report.
    const final = report?.final_grade?.find((f) => numeric(f.grade) !== null);
    const pct = numeric(final?.grade);
    if (pct !== null) courseGrades[id] = { pct, letter: final?.letter?.trim() ?? "" };
  }

  return {
    snapshot: {
      domain: "schoology.com",
      courses,
      assignments,
      gradebook,
      courseGrades,
      messages: await inbox(uid),
      syncedAt: Date.now(),
    },
    stats: { courses: courses.length, assignments: assignments.length, graded },
    student: me.name_display?.trim() || me.name_first?.trim() || "",
  };
}
