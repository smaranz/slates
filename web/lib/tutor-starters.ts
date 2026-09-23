import type { Assignment, Bucket, Course, Status } from "./types";

/**
 * What an empty tutor thread offers before anything has been asked.
 *
 * These used to be three fixed lines about Calc and series tests, which is
 * fine for the sample board and a lie for everyone else. The chips are
 * derived from the same courses and assignments the tutor already sees, so
 * tapping one asks about work that is actually on the board.
 */
export interface TutorStarterSource {
  courses: Course[];
  assignments: Assignment[];
  statusOf: (a: Assignment) => Status;
  bucketOf: (a: Assignment) => Bucket;
  onBoard: (a: Assignment) => boolean;
}

export interface TutorStarter {
  /** Shown on the chip — short enough to sit on one line. */
  label: string;
  /** Sent as the question. Keeps the full title when the chip had to clip. */
  ask: string;
}

const BUCKET_RANK: Record<Bucket, number> = {
  overdue: 0,
  tonight: 1,
  soon: 2,
  week: 3,
  done: 4,
};

const IMPACT_RANK = { high: 0, medium: 1, low: 2 } as const;

const WRITE =
  /\b(essay|draft|paper|dbq|leq|frq|write-?up|outline|bibliography|narrative|poem|speech|lab report)\b/i;
const READ = /\b(read|reading|chapter|ch\.|annotate|margin notes)\b/i;
const ASSESS_TITLE = /\b(quiz|exam|assessment|prueba)\b/i;
const CORRECTION = /\bcorrections?\b/i;
/** Calendar noise — a library meetup is not something to "start". */
const ERRAND = /\b(meet in|sign[- ]?ups?|join |bring your|advisory)\b/i;
const NOT_A_CLASS = /\b(advisee|advisory|hub|counsel|tutorial|closed)\b/i;

/** How many chips the empty state holds. Three is a choice, not a pile. */
const LIMIT = 3;

export function buildTutorStarters(s: TutorStarterSource): TutorStarter[] {
  const open = s.assignments
    .filter(
      (a) =>
        s.onBoard(a) &&
        s.statusOf(a) !== "done" &&
        s.bucketOf(a) !== "done" &&
        !ERRAND.test(a.title)
    )
    .sort((a, b) => {
      const buckets = BUCKET_RANK[s.bucketOf(a)] - BUCKET_RANK[s.bucketOf(b)];
      if (buckets) return buckets;
      const da = a.dateOffset ?? 99;
      const db = b.dateOffset ?? 99;
      if (da !== db) return da - db;
      return IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact];
    });

  const weakest = weakestCourse(s.courses);
  const picked = new Set<string>();
  const out: TutorStarter[] = [];

  const take = (starter: TutorStarter | null, assignmentId?: string) => {
    if (!starter || out.length >= LIMIT) return;
    if (out.some((row) => row.label === starter.label)) return;
    if (assignmentId) {
      if (picked.has(assignmentId)) return;
      picked.add(assignmentId);
    }
    out.push(starter);
  };

  // First chip: the work that is actually in front of them.
  const first = open[0];
  if (first) take(starterFor(first, s.statusOf(first)), first.id);

  // Second chip: a different kind of work, so the row isn't three flavors of
  // the same assignment. A quiz, a paper, or the next urgent thing in another
  // class — whatever is on the board that isn't the first chip.
  const second =
    open.find((a) => !picked.has(a.id) && isAssess(a)) ??
    open.find((a) => !picked.has(a.id) && isWriting(a)) ??
    open.find((a) => !picked.has(a.id) && a.courseId !== first?.courseId) ??
    open.find((a) => !picked.has(a.id));
  if (second) take(starterFor(second, s.statusOf(second)), second.id);

  // Third chip: the grade that has the most room to move, when one does.
  if (weakest) {
    const course = courseLabel(weakest);
    take({
      label: `How do I raise my ${course} grade?`,
      ask: `How do I raise my ${course} grade?`,
    });
  }

  // Still short: name a class rather than inventing homework.
  for (const course of s.courses) {
    if (out.length >= LIMIT) break;
    if (NOT_A_CLASS.test(`${course.short} ${course.name}`)) continue;
    const name = courseLabel(course);
    take({
      label: `What should I review in ${name}?`,
      ask: `What should I review in ${name}?`,
    });
  }

  // A board with nothing on it still needs something to tap. These do not
  // name a class, because we don't have one.
  for (const fallback of EMPTY_FALLBACKS) {
    if (out.length >= LIMIT) break;
    take(fallback);
  }

  return out;
}

const EMPTY_FALLBACKS: TutorStarter[] = [
  { label: "What should I work on?", ask: "What should I work on?" },
  { label: "Help me make a study plan", ask: "Help me make a study plan" },
  { label: "Quiz me on this week's material", ask: "Quiz me on this week's material" },
];

function starterFor(a: Assignment, status: Status): TutorStarter {
  const prefix = prefixFor(a, status);
  const full = cleanTitle(a.title) || "this";
  const short = shortTitle(full);
  const label = `${prefix} ${short}`;
  return {
    label,
    ask: short === full ? label : `${prefix} ${full}`,
  };
}

function prefixFor(a: Assignment, status: Status): string {
  if (isAssess(a)) return "Help me review for";
  if (isWriting(a)) return "Help me outline";
  if (isReading(a)) return "Help me get through";
  if (status === "active") return "Help me finish";
  return "Help me start";
}

function isAssess(a: Assignment): boolean {
  if (CORRECTION.test(a.title)) return false;
  return a.kind === "quiz" || a.kind === "assessment" || ASSESS_TITLE.test(a.title);
}

function isWriting(a: Assignment): boolean {
  return a.kind === "drive" || WRITE.test(a.title);
}

function isReading(a: Assignment): boolean {
  return READ.test(a.title);
}

function courseLabel(course: Course): string {
  return (course.short || course.name).replace(/\.\.\.$/, "").trim();
}

/**
 * The course whose published grade has the most room to move. Untouched
 * gradebooks (nothing scored yet) are skipped — "raise this" about a blank
 * is just noise.
 */
function weakestCourse(courses: Course[]): Course | null {
  const graded = courses.filter((c) => c.pct > 0 && c.pct < 90);
  if (!graded.length) return null;
  return graded.reduce((a, b) => (b.pct < a.pct ? b : a));
}

/** Schoology suffixes and collapsed whitespace, before we clip for the chip. */
export function cleanTitle(title: string): string {
  return title.replace(/\s+/g, " ").replace(/\s+SUBMISSION$/i, "").trim();
}

/** Chip-length title: the clause before a dash or colon, then a hard clip. */
export function shortTitle(title: string, max = 34): string {
  const t = cleanTitle(title);
  if (!t) return "this";
  if (t.length <= max) return t;
  const head = t.split(/\s+[—–]\s+|:\s+/)[0]?.trim() ?? t;
  if (head.length >= 8 && head.length <= max) return head;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > 8 ? cut.slice(0, at) : cut).trimEnd()}…`;
}
