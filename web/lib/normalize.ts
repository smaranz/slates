/**
 * The extension scrapes raw facts (id, title, due text, url). The UI needs
 * presentation fields (bucket, tone, estimate, impact). Deriving them here
 * rather than in the extension means this can be iterated without reloading
 * the extension, and keeps the scraper honest about what it actually saw.
 */

import type {
  Assignment,
  Bucket,
  Course,
  GradeCategory,
  GradeSource,
  SyncSnapshot,
  Tone,
} from "./types";

/* Reused from the design's course palette, cycled so each course is distinct. */
const PALETTE: Array<{ tone: Tone; dot: string }> = [
  { tone: "success", dot: "oklch(0.72 0.13 145)" },
  { tone: "warning", dot: "oklch(0.76 0.13 75)" },
  { tone: "speed", dot: "oklch(0.72 0.14 250)" },
  { tone: "premium", dot: "oklch(0.72 0.14 300)" },
  { tone: "secondary", dot: "oklch(0.72 0 0)" },
  { tone: "danger", dot: "oklch(0.72 0.16 25)" },
];

/** Distinct fallback estimates keep the board useful when AI is unavailable. */
function fallbackMinutes(kind: string, title: string, brief: string): number {
  const text = `${title} ${brief}`.toLowerCase();
  if (/\b(project|presentation|portfolio|research)\b/.test(text)) return 90;
  if (/\b(essay|report|lab write|rough draft|final draft)\b/.test(text)) return 75;
  if (/\b(dbq|frq|problem set|worksheet|packet|homework)\b/.test(text)) return 50;
  if (/\b(read|reading|chapter|annotat)\b/.test(text)) return 35;
  if (kind === "assessment" || kind === "quiz") return 25;
  if (kind === "discussion") return 20;
  if (kind === "drive") return 60;
  return 40;
}

/**
 * Schoology renders due dates in several shapes depending on skin and locale:
 *   "Due Friday, September 5, 2026 11:59 pm"
 *   "Due Sep 5"           "Due Tomorrow"        "Due Today"
 * Returns whole days from today, or null when nothing parses.
 */
export function parseDueOffset(text: string, now = new Date()): number | null {
  if (!text) return null;

  // "3 days overdue" / "1 day overdue" — Schoology's overdue rows carry no date.
  const overdue = text.match(/(\d+)\s+days?\s+overdue/i);
  if (overdue) return -Number(overdue[1]);

  const t = text
    .replace(/^\s*this was due on\s*/i, "") // completed / overdue phrasing
    .replace(/^\s*due\s*/i, "")
    .trim();
  if (!t) return null;

  if (/^earlier today\b/i.test(t)) return 0;
  if (/^today\b/i.test(t)) return 0;
  if (/^tomorrow\b/i.test(t)) return 1;
  if (/^yesterday\b/i.test(t)) return -1;

  const weekday = t.match(
    /^(next\s+)?(sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?)(?:\s+at\b.*)?$/i
  );
  if (weekday) {
    const names = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const target = names.findIndex((name) => weekday[2].toLowerCase().startsWith(name));
    const upcoming = (target - now.getDay() + 7) % 7;
    return weekday[1] ? upcoming + 7 : upcoming;
  }

  // Strip a leading weekday name, which Date.parse handles inconsistently
  // when it disagrees with the numeric date. Then drop Schoology's " at HH:MM
  // am" clause — Date.parse rejects the literal "at", and the time of day
  // never changes which day the item lands on.
  const cleaned = t
    .replace(/^(sun|mon|tues?|wed(nes)?|thur?s?|fri|satur?)(day)?,?\s*/i, "")
    .replace(/\s+at\s+\d{1,2}(:\d{2})?\s*(am|pm)?\s*$/i, "")
    .trim();

  const hasYear = /\b\d{4}\b/.test(cleaned);
  const candidates = hasYear
    ? [cleaned]
    : [cleaned, `${cleaned} ${now.getFullYear()}`, `${cleaned} ${now.getFullYear() + 1}`];

  // Schoology omits the year for near-term dates. Prefer this year, but permit
  // the next year around winter break instead of turning January into 11 months ago.
  for (const candidate of candidates) {
    const ms = Date.parse(candidate);
    if (Number.isNaN(ms)) continue;

    const due = new Date(ms);
    const a = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const days = Math.round((a.getTime() - b.getTime()) / 86_400_000);

    // A parsed date more than a term away is almost certainly a misparse
    // (e.g. a bare "5" reading as year 2005).
    if (days < -30 || days > 365) continue;
    return days;
  }
  return null;
}

export function bucketFor(offset: number | null): Bucket {
  if (offset === null) return "week"; // undated — still show it
  if (offset <= 1) return "tonight"; // includes overdue
  if (offset <= 3) return "soon";
  return "week";
}

/**
 * Badge label from a Schoology course title.
 * "AP Physics 1 - 3750: AgarwalA p5 T1" -> "AP Physics 1"
 * "CHS Hub: Gr10"                       -> "CHS Hub"
 */
function shorten(name: string): string {
  const base = name
    .replace(/:.*$/, "") // teacher/period suffix
    .replace(/\s+-\s+\d{3,6}\s*$/, "") // section code
    .replace(/\s*[-–—(]\s*(period|per\.?|p)\s*\d+.*$/i, "")
    .replace(/\s*\bsection\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return base.length > 18 ? `${base.slice(0, 17)}...` : base || name;
}

function codeFor(course: Course | undefined, id: string): string {
  const prefix = (course?.short ?? "SCH")
    .split(/\s+/)
    .map((part) => part.replace(/[^A-Za-z0-9]/g, "")[0] ?? "")
    .join("")
    .slice(0, 5)
    .toUpperCase() || "SCH";
  return `${prefix}-${id.slice(-4)}`;
}

export interface Standing {
  pct: number | null;
  source: GradeSource;
}

const NOT_GRADED: Standing = { pct: null, source: "none" };

/**
 * A category's standing, 0-100.
 *
 * Schoology's own percentage wins, because it knows which items actually count
 * toward the grade — its category percentage and its points sometimes disagree,
 * and when they do Schoology is right. Failing that, the points are added up.
 *
 * A letter with no points behind it yields no percentage at all. A letter is a
 * band, and turning "A" into "96.5%" was inventing a number the gradebook never
 * contained.
 */
export function categoryPct(c: GradeCategory): Standing {
  if (c.pct != null) return { pct: c.pct, source: "reported" };
  if (c.possible > 0) return { pct: (c.earned / c.possible) * 100, source: "points" };
  return NOT_GRADED;
}

/**
 * Course percentage worked out from the gradebook, for classes where Schoology
 * publishes no percentage of its own.
 *
 * Categories with no grade are left out rather than counted as zero — nothing
 * scored yet is not the same as scoring nothing. Weights that don't sum to 100
 * (because only some categories have been graded) are renormalised over what
 * exists. A gradebook with no weights at all is scored on total points, which
 * is what "unweighted" means in Schoology — averaging the categories evenly
 * would quietly weight a 5-point warmup like a 100-point exam.
 */
function fromCategories(cats: GradeCategory[]): Standing | null {
  const graded = cats
    .map((c) => ({ weight: c.weight, earned: c.earned, possible: c.possible, pct: categoryPct(c).pct }))
    .filter((c): c is { weight: number; earned: number; possible: number; pct: number } => c.pct !== null);
  if (!graded.length) return null;

  const totalWeight = graded.reduce((a, c) => a + c.weight, 0);
  if (totalWeight > 0) {
    return {
      pct: graded.reduce((a, c) => a + c.weight * c.pct, 0) / totalWeight,
      source: "points",
    };
  }

  const possible = graded.reduce((a, c) => a + c.possible, 0);
  if (possible > 0) {
    return { pct: (graded.reduce((a, c) => a + c.earned, 0) / possible) * 100, source: "points" };
  }

  // Percentages but no points and no weights: an even average is all there is.
  return { pct: graded.reduce((a, c) => a + c.pct, 0) / graded.length, source: "points" };
}

/**
 * What to show for a course. Schoology's own number wins; otherwise it is added
 * up from the gradebook's points. A class Schoology grades in letters alone
 * keeps its letter and gets no percentage — there isn't one to show.
 */
function standingFor(
  reported: { pct: number | null; letter: string } | undefined,
  cats: GradeCategory[]
): Standing {
  if (reported?.pct != null) return { pct: reported.pct, source: "reported" };
  return fromCategories(cats) ?? NOT_GRADED;
}

/** One graded assignment's effect on the running course grade. */
export interface GradePoint {
  /** Short x-axis label — the assignment's due date. */
  d: string;
  /** Course percentage once this item is folded in. */
  v: number;
  /** Assignment name, for the point's hover title. */
  title: string;
  /** Change from the previous point, so a dip is a negative number. */
  delta: number;
  /** The item that first put a percentage on the board — there's no prior grade for its delta to mean anything against. */
  first?: boolean;
  /** Matches `GradeItem.id`, so a "Recent scores" row can look up its own delta. */
  id?: string;
}

/**
 * Schoology's date column reads "8/18/26 8:30am" — parsed by hand rather than
 * `Date.parse`, whose two-digit-year handling isn't reliable across engines.
 */
function parseGradeDate(s: string): Date | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})\s*(am|pm))?/i.exec(s.trim());
  if (!m) return null;
  const [, mo, da, yr, hh, mm, ap] = m;
  const year = yr.length === 2 ? 2000 + Number(yr) : Number(yr);
  let hour = hh ? Number(hh) % 12 : 0;
  if (ap?.toLowerCase() === "pm") hour += 12;
  return new Date(year, Number(mo) - 1, Number(da), hour, mm ? Number(mm) : 0);
}

/**
 * "Grade over time" that's actually about the assignments that moved it.
 *
 * Schoology reports no history, but every graded item already carries a date
 * and a score — replaying them in order shows exactly which assignment
 * caused a jump or a dip.
 *
 * The tricky part is *how* to fold each item in. A course's category list
 * shows weights (15%, 20%, ...), but plenty of Schoology courses display
 * those purely for organisation while actually grading on total points —
 * this can't be told apart by looking at the categories alone, and guessing
 * wrong is wildly wrong (a weighted replay put one course's mid-term grade at
 * 79% on a day its real, Schoology-reported grade was 97%). Since the
 * course's own current percentage is already known, both models are tried
 * against the FULL gradebook and whichever one actually reproduces that
 * number is the one used for every point in the replay.
 */
export function gradeTimeline(cats: GradeCategory[], reportedPct?: number | null): GradePoint[] {
  const items = cats
    .flatMap((cat, catIndex) =>
      cat.items.map((it) => ({
        catIndex,
        weight: cat.weight,
        id: it.id,
        name: it.name,
        earned: it.earned,
        possible: it.possible,
        date: it.date,
      }))
    )
    .filter(
      (it): it is typeof it & { earned: number; possible: number; when: Date } =>
        it.earned != null && it.possible != null && it.possible > 0
    )
    .map((it) => ({ ...it, when: parseGradeDate(it.date) }))
    .filter((it): it is typeof it & { when: Date } => it.when !== null)
    .sort((a, b) => a.when.getTime() - b.when.getTime());

  if (!items.length) return [];

  /** Category-weighted, renormalised over whatever's graded — `fromCategories`, replayed. */
  function weightedPct(earnedByCat: Map<number, number>, possibleByCat: Map<number, number>): number | null {
    let weightedSum = 0;
    let totalWeight = 0;
    for (const [catIndex, possible] of possibleByCat) {
      const cat = items.find((it) => it.catIndex === catIndex);
      const weight = cat?.weight ?? 0;
      if (weight > 0 && possible > 0) {
        weightedSum += weight * ((earnedByCat.get(catIndex)! / possible) * 100);
        totalWeight += weight;
      }
    }
    return totalWeight > 0 ? weightedSum / totalWeight : null;
  }

  /** Straight total points, ignoring category weights entirely. */
  function pointsPct(totalEarned: number, totalPossible: number): number | null {
    return totalPossible > 0 ? (totalEarned / totalPossible) * 100 : null;
  }

  // One pass over every item to find each model's final answer, so it can be
  // checked against the number Schoology actually reports for the course.
  const finalEarnedByCat = new Map<number, number>();
  const finalPossibleByCat = new Map<number, number>();
  let finalEarned = 0;
  let finalPossible = 0;
  for (const it of items) {
    finalEarnedByCat.set(it.catIndex, (finalEarnedByCat.get(it.catIndex) ?? 0) + it.earned);
    finalPossibleByCat.set(it.catIndex, (finalPossibleByCat.get(it.catIndex) ?? 0) + it.possible);
    finalEarned += it.earned;
    finalPossible += it.possible;
  }
  const finalWeighted = weightedPct(finalEarnedByCat, finalPossibleByCat);
  const finalPoints = pointsPct(finalEarned, finalPossible);

  /*
   * No reported grade to calibrate against (this course's headline number was
   * itself computed by `fromCategories`) — stay consistent with that and use
   * the weighted model. Otherwise use whichever model actually lands on the
   * real number.
   */
  const useWeighted =
    reportedPct == null
      ? finalWeighted !== null
      : finalWeighted !== null && (finalPoints === null || Math.abs(finalWeighted - reportedPct) <= Math.abs(finalPoints - reportedPct));

  const earnedByCat = new Map<number, number>();
  const possibleByCat = new Map<number, number>();
  let runningEarned = 0;
  let runningPossible = 0;

  const points: GradePoint[] = [];
  let prev: number | null = null;

  for (const it of items) {
    earnedByCat.set(it.catIndex, (earnedByCat.get(it.catIndex) ?? 0) + it.earned);
    possibleByCat.set(it.catIndex, (possibleByCat.get(it.catIndex) ?? 0) + it.possible);
    runningEarned += it.earned;
    runningPossible += it.possible;

    const pct = useWeighted ? weightedPct(earnedByCat, possibleByCat) : pointsPct(runningEarned, runningPossible);
    if (pct === null) continue;

    points.push({
      d: it.when.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      v: Math.round(pct * 10) / 10,
      title: `${it.name} (${it.earned}/${it.possible})`,
      delta: prev === null ? 0 : Math.round((pct - prev) * 10) / 10,
      first: prev === null,
      id: it.id,
    });
    prev = pct;
  }

  return points;
}

function letterFor(p: number): string {
  if (p >= 93) return "A";
  if (p >= 90) return "A-";
  if (p >= 87) return "B+";
  if (p >= 83) return "B";
  if (p >= 80) return "B-";
  if (p >= 77) return "C+";
  if (p >= 73) return "C";
  if (p >= 70) return "C-";
  if (p >= 67) return "D+";
  if (p >= 60) return "D";
  return "F";
}

type RawCourse = Partial<Course> & { id: string; name: string };
/** `completed` comes from Schoology's "Recently Completed" section. */
type RawAssignment = Partial<Assignment> & {
  id: string;
  courseId: string;
  title: string;
  completed?: boolean;
  /** ISO instant from the iCal feed — exact, so no text parsing is needed. */
  dueAt?: string | null;
  allDay?: boolean;
};

/** Whole days from today to `iso`, in the viewer's timezone. */
function offsetFromIso(iso: string, now: Date): number | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

/** "Due Mon, Aug 31 at 8:30 AM" — how the card reads. */
function formatDue(iso: string, allDay: boolean): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  if (allDay) return `Due ${day}`;
  return `Due ${day} at ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

export interface RawSnapshot {
  domain: string;
  courses: RawCourse[];
  assignments: RawAssignment[];
  gradebook?: Record<string, GradeCategory[]>;
  /** Schoology's own course percentage and letter, straight off the report. */
  courseGrades?: Record<string, { pct: number; letter: string }>;
  history?: SyncSnapshot["history"];
  messages?: SyncSnapshot["messages"];
  syncedAt?: number;
}

export function normalizeSnapshot(raw: RawSnapshot, now = new Date()): SyncSnapshot {
  const gradebook = raw.gradebook ?? {};
  const courseGrades = raw.courseGrades ?? {};

  const courses: Course[] = (raw.courses ?? []).map((c, i) => {
    const skin = PALETTE[i % PALETTE.length];
    const reported = courseGrades[c.id];
    const { pct, source } = standingFor(reported, gradebook[c.id] ?? []);
    const letter = reported?.letter || (pct === null ? "" : letterFor(pct));
    return {
      id: c.id,
      name: c.name,
      short: c.short ?? shorten(c.name),
      period: c.period ?? "",
      // A letter-graded class shows its letter. Nothing graded shows nothing —
      // neither gets a percentage invented for it.
      grade: pct === null ? letter || "—" : `${pct.toFixed(1)}%`,
      pct: pct ?? 0,
      gradeSource: source,
      letter,
      trend: c.trend ?? "0.0",
      tone: c.tone ?? skin.tone,
      dot: c.dot ?? skin.dot,
      url: c.url ?? "#",
    };
  });

  const known = new Set(courses.map((c) => c.id));
  const courseById = new Map(courses.map((c) => [c.id, c]));

  const assignments: Assignment[] = (raw.assignments ?? [])
    .filter((a) => known.has(a.courseId))
    .map((a) => {
      const kind = a.kind ?? "assignment";
      // An exact timestamp beats parsing prose — prefer it when the source
      // (the iCal feed) provides one.
      const offset =
        a.dateOffset ??
        (a.dueAt ? offsetFromIso(a.dueAt, now) : null) ??
        parseDueOffset(a.due ?? "", now);
      const overdue = offset !== null && offset < 0;
      const dueLabel =
        a.due?.trim() || (a.dueAt ? formatDue(a.dueAt, a.allDay ?? false) : "");

      return {
        id: a.id,
        courseId: a.courseId,
        kind,
        submit: a.submit ?? (kind === "assessment" || kind === "drive" ? "overlay" : "native"),
        submissionTypes: a.submissionTypes,
        title: a.title,
        brief: a.brief ?? "",
        briefHtml: a.briefHtml ?? "",
        attachments: a.attachments ?? [],
        postedAt: a.postedAt ?? "",
        due: dueLabel || "No due date",
        dateOffset: offset,
        code: a.code ?? codeFor(courseById.get(a.courseId), a.id),
        minutes: a.minutes ?? fallbackMinutes(kind, a.title, a.brief ?? ""),
        impact: a.impact ?? (overdue && !a.completed ? "high" : "medium"),
        impactNote:
          a.impactNote ?? (overdue && !a.completed ? "Past due — clear this first." : ""),
        // Already turned in on Schoology → "Turned in" column, not the plan.
        bucket: a.bucket ?? (a.completed ? "done" : bucketFor(offset)),
        url: a.url ?? "#",
        grade: a.grade ?? null,
        comments: a.comments ?? [],
        assessment: a.assessment ?? null,
        timeLimitMin: a.timeLimitMin ?? null,
        attemptsUsed: a.attemptsUsed ?? 0,
        attemptsAllowed: a.attemptsAllowed ?? null,
        resumable: a.resumable ?? true,
        submittedAt: a.submittedAt ?? null,
      };
    })
    // Soonest first, so column order reads as a plan.
    .sort((x, y) => (x.dateOffset ?? Number.POSITIVE_INFINITY) - (y.dateOffset ?? Number.POSITIVE_INFINITY));

  // Graded classes first — advisory groups and hubs carry no grade and would
  // otherwise push the real courses down the page. Keyed off the standing that
  // actually renders, so a computed grade sorts with the rest.
  courses.sort((a, b) => Number(b.grade !== "—") - Number(a.grade !== "—"));

  return {
    domain: raw.domain,
    courses,
    assignments,
    gradebook,
    courseGrades,
    history: raw.history ?? {},
    messages: raw.messages ?? [],
    syncedAt: raw.syncedAt ?? Date.now(),
  };
}
