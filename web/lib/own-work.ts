import { bucketFor } from "./normalize";
import type { Assignment, Course } from "./types";

/**
 * Work you added yourself.
 *
 * Plenty of what a week actually contains never reaches Schoology: a teacher
 * who assigns a reading out loud, a lab report on a paper handout, a make-up
 * test arranged by email, studying you decided to do. A board that can only
 * show what the LMS knows is a board you stop trusting, because the thing you
 * are most likely to forget is the thing nobody wrote down.
 *
 * These live with your marks rather than in the snapshot, for the same reason
 * ticked-off work does: the snapshot is a disposable cache that a single bad
 * scrape can invalidate, and something you typed in must never be collateral
 * damage from an expired Schoology session.
 */

/** The id prefix, which is also how the rest of the app recognises one. */
const OWN = "own:";

export function isOwnWork(id: string): boolean {
  return id.startsWith(OWN);
}

export function newOwnWorkId(): string {
  return `${OWN}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** What the student actually types. Everything else is derived. */
export interface OwnWork {
  id: string;
  title: string;
  /** A real course id when they picked one, or "" for work that belongs to no class. */
  courseId: string;
  /** YYYY-MM-DD, or null for something with no deadline. */
  dueDate: string | null;
  /** HH:MM local, when they gave a time. */
  dueTime?: string;
  notes?: string;
  /** Their own estimate, in minutes. */
  minutes: number;
  impact: Assignment["impact"];
  /** Marks it out of, when it's graded work they want in a what-if. */
  points?: number | null;
  createdAt: number;
}

export function emptyOwnWork(courseId = ""): OwnWork {
  return {
    id: newOwnWorkId(),
    title: "",
    courseId,
    dueDate: null,
    minutes: 30,
    impact: "medium",
    createdAt: Date.now(),
  };
}

/** Whole days from today to a YYYY-MM-DD date, in local time. */
function offsetOf(dueDate: string | null, today: Date): number | null {
  if (!dueDate) return null;
  const due = new Date(`${dueDate}T12:00:00`);
  if (Number.isNaN(due.getTime())) return null;
  const noon = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  return Math.round((due.getTime() - noon.getTime()) / 86_400_000);
}

/** "Tomorrow", "Fri, Sep 12" — worded the way a card words a due date. */
function dueLabel(dueDate: string | null, dueTime: string | undefined, offset: number | null): string {
  if (!dueDate) return "No due date";
  const at = new Date(`${dueDate}T${dueTime ?? "12:00"}:00`);
  const clock = dueTime
    ? ` at ${at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase()}`
    : "";
  const day =
    offset === 0
      ? "Today"
      : offset === 1
        ? "Tomorrow"
        : at.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  return `${day}${clock}`;
}

/**
 * One piece of your own work, in the shape the rest of the app already reads.
 *
 * Deliberately an ordinary `Assignment`. Every view — board, list, calendar,
 * the tutor's context, the counselor's workload check — then handles it with
 * no special case, and the only thing that distinguishes it is the id prefix
 * and `submit: "none"`, which is the truth: there is nowhere to hand it in.
 */
export function toAssignment(work: OwnWork, today = new Date()): Assignment {
  const offset = offsetOf(work.dueDate, today);
  const at = work.dueDate ? new Date(`${work.dueDate}T${work.dueTime ?? "23:59"}:00`) : null;

  return {
    id: work.id,
    courseId: work.courseId,
    kind: "assignment",
    submit: "none",
    title: work.title.trim() || "Untitled",
    brief: work.notes ?? "",
    due: dueLabel(work.dueDate, work.dueTime, offset),
    dueAt: work.dueTime && at ? at.toISOString() : null,
    allDay: !work.dueTime,
    dateOffset: offset,
    code: "",
    minutes: work.minutes,
    impact: work.impact,
    impactNote: "You set this",
    bucket: bucketFor(offset),
    url: "",
    points: work.points ?? null,
    grade: null,
    comments: [],
  };
}

/**
 * Your own work, folded into a synced snapshot.
 *
 * Appended rather than merged: these have ids nothing else can collide with,
 * and the sort each view applies puts them in the right place by due date
 * anyway. Work pointing at a course that no longer exists keeps its title and
 * simply shows as uncategorised, rather than vanishing because a class ended.
 */
export function withOwnWork(
  assignments: Assignment[],
  own: OwnWork[],
  today = new Date()
): Assignment[] {
  if (!own.length) return assignments;
  return [...assignments, ...own.map((w) => toAssignment(w, today))];
}

/** The course to show it under, or null when it belongs to no class. */
export function courseOf(work: OwnWork, courses: Course[]): Course | null {
  return courses.find((c) => c.id === work.courseId) ?? null;
}
