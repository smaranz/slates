import { uid } from "./state";
import type {
  Activity,
  Award,
  AwardLevel,
  CounselorProfile,
  CourseLevel,
  Memory,
  MemoryKind,
  StatePatch,
  TestScore,
  TranscriptCourse,
} from "./types";

/**
 * Reading a record produced somewhere else.
 *
 * The intake interview happens in a chat, not in this app — a form cannot ask
 * a good follow-up question, and "I do robotics" needs one. So the interview
 * runs wherever the student likes and hands back JSON, and this is the door it
 * comes through.
 *
 * Everything here is defensive on purpose. The input is model-generated: keys
 * go missing, enums come back as prose ("Advanced Placement" for "AP"), grade
 * levels arrive as strings, and a tier occasionally shows up as 0 or 7.
 * Nothing is trusted, nothing invented to fill a hole, and a field that can't
 * be read is dropped rather than guessed — a fabricated GPA would poison every
 * number computed from it.
 */

export interface ImportResult {
  patch: StatePatch;
  /** What actually landed, for a plain-language confirmation. */
  summary: string[];
  /** Fields that were present but unreadable. Shown, not swallowed. */
  warnings: string[];
}

const LEVELS: Record<string, CourseLevel> = {
  regular: "regular",
  reg: "regular",
  standard: "regular",
  honors: "honors",
  honor: "honors",
  h: "honors",
  ap: "AP",
  "advanced placement": "AP",
  ib: "IB",
  "international baccalaureate": "IB",
  "dual-enrollment": "dual-enrollment",
  "dual enrollment": "dual-enrollment",
  de: "dual-enrollment",
  "community college": "dual-enrollment",
};

const AWARD_LEVELS: AwardLevel[] = ["school", "regional", "state", "national", "international"];

const MEMORY_KINDS: MemoryKind[] = [
  "fact",
  "preference",
  "goal",
  "concern",
  "context",
  "relationship",
  "milestone",
  "other",
];

function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

/** A number from a number, or from a string with units and commas in it. */
function num(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function clampInt(value: unknown, lo: number, hi: number): number | undefined {
  const parsed = num(value);
  if (parsed == null) return undefined;
  const rounded = Math.round(parsed);
  return rounded >= lo && rounded <= hi ? rounded : undefined;
}

/**
 * Merges an imported record into the current one.
 *
 * Additive rather than destructive: a second import after another
 * conversation should add what's new, not wipe what the counselor learned in
 * between. Duplicates are matched on the thing that identifies the row to a
 * person — the same course in the same year, the same test on the same date —
 * not on an id, because the import mints its own.
 */
export function importRecord(
  raw: unknown,
  current: {
    profile: CounselorProfile;
    memories: Memory[];
    coursework: TranscriptCourse[];
    testing: TestScore[];
    awards: Award[];
  }
): ImportResult {
  const summary: string[] = [];
  const warnings: string[] = [];
  const patch: StatePatch = {};

  if (typeof raw !== "object" || raw === null) {
    return { patch, summary, warnings: ["That isn't a JSON object."] };
  }
  const body = raw as Record<string, unknown>;

  /* ── profile ── */

  const incoming = (body.profile ?? {}) as Record<string, unknown>;
  if (Object.keys(incoming).length) {
    const profile: CounselorProfile = { ...current.profile };
    const changed: string[] = [];

    const set = <K extends keyof CounselorProfile>(key: K, value: CounselorProfile[K] | undefined) => {
      if (value === undefined) return;
      if (JSON.stringify(profile[key]) === JSON.stringify(value)) return;
      profile[key] = value;
      changed.push(key);
    };

    set("name", str(incoming.name));
    set("gradeLevel", clampInt(incoming.gradeLevel, 9, 13) as CounselorProfile["gradeLevel"] | undefined);
    set("applyYear", clampInt(incoming.applyYear, 2020, 2060));
    set("state", str(incoming.state)?.toUpperCase().slice(0, 2));
    set("highSchool", str(incoming.highSchool));
    set("dreamSchool", str(incoming.dreamSchool));
    set("intendedMajor", str(incoming.intendedMajor));
    set("notes", str(incoming.notes));
    if (typeof incoming.firstGen === "boolean") set("firstGen", incoming.firstGen);

    // A GPA outside 0–4.0 is a weighted number, or a percentage, or a slip.
    // Better to flag it than to feed the chance engine a 4.6.
    if (incoming.gpaUnweighted != null) {
      const gpa = num(incoming.gpaUnweighted);
      if (gpa != null && gpa >= 0 && gpa <= 4) set("gpaUnweighted", Math.round(gpa * 100) / 100);
      else warnings.push(`Ignored a GPA of ${String(incoming.gpaUnweighted)} — this field is unweighted, 0–4.0.`);
    }

    if (incoming.sat != null) {
      const sat = clampInt(incoming.sat, 400, 1600);
      if (sat != null) set("sat", sat);
      else warnings.push(`Ignored an SAT of ${String(incoming.sat)}.`);
    }
    if (incoming.act != null) {
      const act = clampInt(incoming.act, 1, 36);
      if (act != null) set("act", act);
      else warnings.push(`Ignored an ACT of ${String(incoming.act)}.`);
    }
    if (incoming.budgetMax != null) {
      const budget = num(incoming.budgetMax);
      if (budget != null && budget > 0) set("budgetMax", Math.round(budget));
    }

    const rigor = str(incoming.rigor)?.toLowerCase().replace(/\s+/g, "-");
    if (rigor === "low" || rigor === "medium" || rigor === "high" || rigor === "very-high") {
      set("rigor", rigor);
    }

    if (Array.isArray(incoming.activities)) {
      const activities: Activity[] = [];
      for (const entry of incoming.activities as Record<string, unknown>[]) {
        const name = str(entry?.name);
        if (!name) continue;
        activities.push({
          id: str(entry.id) ?? uid(),
          name,
          role: str(entry.role),
          tier: (clampInt(entry.tier, 1, 4) ?? 3) as Activity["tier"],
          detail: str(entry.detail),
        });
      }
      if (activities.length) {
        // Activities replace rather than append: a later interview is a better
        // description of the same commitments, not a second set of them.
        const kept = current.profile.activities.filter(
          (existing) => !activities.some((a) => a.name.toLowerCase() === existing.name.toLowerCase())
        );
        set("activities", [...activities, ...kept]);
        summary.push(`${activities.length} activities`);
      }
    }

    if (changed.length) {
      patch.profile = profile;
      const fields = changed.filter((f) => f !== "activities");
      if (fields.length) summary.push(`profile (${fields.join(", ")})`);
    }
  }

  /* ── memories ── */

  if (Array.isArray(body.memories)) {
    const fresh: Memory[] = [];
    const seen = new Set(current.memories.map((m) => m.content.trim().toLowerCase()));
    for (const entry of body.memories as Record<string, unknown>[]) {
      const content = str(entry?.content);
      if (!content || seen.has(content.toLowerCase())) continue;
      seen.add(content.toLowerCase());
      const kind = str(entry.kind) as MemoryKind | undefined;
      fresh.push({
        id: uid(),
        kind: kind && MEMORY_KINDS.includes(kind) ? kind : "fact",
        content,
        importance: clampInt(entry.importance, 1, 5) ?? 3,
        source: "student",
        updatedAt: Date.now(),
      });
    }
    if (fresh.length) {
      patch.memories = [...fresh, ...current.memories];
      summary.push(`${fresh.length} things to remember`);
    }
  }

  /* ── transcript ── */

  if (Array.isArray(body.coursework)) {
    const fresh: TranscriptCourse[] = [];
    const key = (year: number, course: string, term?: string) =>
      `${year}|${course.trim().toLowerCase()}|${term?.trim().toLowerCase() ?? ""}`;
    const seen = new Set(current.coursework.map((c) => key(c.year, c.course, c.term)));

    for (const entry of body.coursework as Record<string, unknown>[]) {
      const course = str(entry?.course);
      const year = clampInt(entry?.year, 9, 12);
      if (!course || year == null) continue;
      const term = str(entry.term);
      if (seen.has(key(year, course, term))) continue;
      seen.add(key(year, course, term));

      const level = str(entry.level)?.toLowerCase();
      fresh.push({
        id: uid(),
        year: year as TranscriptCourse["year"],
        course,
        level: (level && LEVELS[level]) || "regular",
        grade: str(entry.grade),
        term,
      });
    }
    if (fresh.length) {
      patch.coursework = [...current.coursework, ...fresh];
      summary.push(`${fresh.length} transcript rows`);
    }
  }

  /* ── testing ── */

  if (Array.isArray(body.testing)) {
    const fresh: TestScore[] = [];
    const key = (t: string, d?: string, s?: string) =>
      `${t.trim().toLowerCase()}|${d ?? ""}|${s ?? ""}`;
    const seen = new Set(current.testing.map((t) => key(t.test, t.date, t.score)));

    for (const entry of body.testing as Record<string, unknown>[]) {
      const test = str(entry?.test);
      const score = str(entry?.score) ?? (entry?.score != null ? String(entry.score) : undefined);
      if (!test || !score) continue;
      const date = str(entry.date);
      if (seen.has(key(test, date, score))) continue;
      seen.add(key(test, date, score));
      fresh.push({ id: uid(), test, date, score });
    }
    if (fresh.length) {
      patch.testing = [...current.testing, ...fresh];
      summary.push(`${fresh.length} scores`);
    }
  }

  /* ── awards ── */

  if (Array.isArray(body.awards)) {
    const fresh: Award[] = [];
    const seen = new Set(current.awards.map((a) => a.name.trim().toLowerCase()));
    for (const entry of body.awards as Record<string, unknown>[]) {
      const name = str(entry?.name);
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      const level = str(entry.level)?.toLowerCase() as AwardLevel | undefined;
      fresh.push({
        id: uid(),
        name,
        level: level && AWARD_LEVELS.includes(level) ? level : "school",
        year: clampInt(entry.year, 2000, 2060),
      });
    }
    if (fresh.length) {
      patch.awards = [...current.awards, ...fresh];
      summary.push(`${fresh.length} awards`);
    }
  }

  if (!summary.length && !warnings.length) {
    warnings.push("Nothing in there was new — everything it held is already on your record.");
  }

  return { patch, summary, warnings };
}

/** Parses the text a student pasted, tolerating a fence and surrounding prose. */
export function parseRecord(text: string): { value: unknown } | { error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { error: "Nothing pasted." };

  // Models wrap JSON in a fence however often you ask them not to, and
  // sometimes add a sentence before it.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : trimmed;

  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return { error: "Couldn't find a JSON object in that." };

  // The prompt asks for `// NOTE:` lines after the object; they fall outside
  // the braces, so slicing to them is enough.
  try {
    return { value: JSON.parse(body.slice(start, end + 1)) };
  } catch (err) {
    return { error: err instanceof Error ? `That isn't valid JSON — ${err.message}` : "That isn't valid JSON." };
  }
}
