import type { Application, Essay, EssayKind, EssayScope } from "./types";

/**
 * Sorting essays into the two halves of the app, and saying where each one
 * stands.
 *
 * The college side is a tracker: a set of essays with deadlines attached, each
 * one belonging to an application, where what matters is which are unwritten,
 * which are over the limit, and how the written ones score. The school side is
 * coursework. Same editor, different question being asked.
 */

/**
 * Which half an essay belongs to.
 *
 * Records written before the split carry no scope, so it is inferred — and the
 * inference has to err toward school, because that is where every essay lived
 * until the split and where the student last saw it. Guessing the other way is
 * not a cosmetic mistake: the essay vanishes from the list it was written in,
 * which reads as lost work. That is exactly what the first version of this did
 * by treating `personal-statement` as a college essay, when in fact it was the
 * old default kind for every essay created anywhere, school ones included, and
 * so carries no information at all.
 *
 * What does carry information: a college name the student typed, a kind that
 * only exists on an application (a supplement, a UC PIQ), or a link to a
 * Schoology assignment. Everything else stays where it was.
 */
const COLLEGE_ONLY_KINDS = new Set<EssayKind>(["supplement", "uc-piq", "scholarship", "additional-info"]);

export function essayScope(essay: Essay): EssayScope {
  if (essay.scope) return essay.scope;
  if (essay.assignmentId) return "school";
  if (essay.collegeName?.trim()) return "college";
  return COLLEGE_ONLY_KINDS.has(essay.kind) ? "college" : "school";
}

export function inScope(scope: EssayScope) {
  return (essay: Essay) => essayScope(essay) === scope;
}

export type EssayStage = "empty" | "drafting" | "checked" | "over";

/**
 * Where an essay stands, from what's actually in it — never a field the
 * student has to remember to update, because they won't.
 */
export function stageOf(essay: Essay, words: number): EssayStage {
  if (!essay.content.trim()) return "empty";
  if (essay.wordLimit != null && words > essay.wordLimit) return "over";
  return essay.report ? "checked" : "drafting";
}

export const STAGE_LABEL: Record<EssayStage, string> = {
  empty: "Not started",
  drafting: "Drafting",
  checked: "Checked",
  over: "Over the limit",
};

/** The headline number from the last report, when there is one. */
export function scoreOf(essay: Essay): number | null {
  return essay.report ? essay.report.lines.score : null;
}

/** Whether the last report's AI check flagged it. Null when never checked. */
export function flaggedOf(essay: Essay): boolean | null {
  if (!essay.report) return null;
  return essay.report.detection.meld?.flagged ?? null;
}

export interface EssayGroup {
  /** The application these belong to, when they belong to one. */
  application: Application | null;
  /** The heading: a college, or the catch-all for essays not tied to one. */
  title: string;
  /** YYYY-MM-DD, from the application. */
  deadline: string | null;
  essays: Essay[];
}

/**
 * College essays grouped by the application they're for.
 *
 * Matched on the college name the essay carries, because that is what the
 * student types into Setup and what the application stores. An essay naming a
 * college with no application yet still gets its own group, so adding the
 * essay first and the application later doesn't hide it.
 */
export function groupByApplication(essays: Essay[], applications: Application[]): EssayGroup[] {
  const key = (name: string) => name.trim().toLowerCase();
  const groups = new Map<string, EssayGroup>();

  // Every application gets a row, including the ones with nothing written yet:
  // an empty row is the useful signal here, not an absence.
  for (const app of applications) {
    groups.set(key(app.collegeName), {
      application: app,
      title: app.collegeName,
      deadline: app.deadline,
      essays: [],
    });
  }

  const general: Essay[] = [];

  for (const essay of essays) {
    const name = essay.collegeName?.trim();
    if (!name) {
      general.push(essay);
      continue;
    }
    const k = key(name);
    const found = groups.get(k);
    if (found) found.essays.push(essay);
    else groups.set(k, { application: null, title: name, deadline: null, essays: [essay] });
  }

  const out = [...groups.values()].sort((a, b) => {
    // Soonest deadline first; anything without one falls to the bottom.
    if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return a.title.localeCompare(b.title);
  });

  if (general.length) {
    out.unshift({ application: null, title: "Not tied to one school", deadline: null, essays: general });
  }

  return out;
}

/**
 * How many days until a deadline: 0 is today, 1 tomorrow, negative once past.
 *
 * Calendar days in local time, not elapsed milliseconds. The millisecond
 * version answered differently depending on the hour — an application due
 * today read as "1 day" in the morning — and parsing "2026-11-01" as a Date
 * treats it as UTC midnight, which is the previous evening for anyone west of
 * London. Both bugs point the same way: a deadline shown a day later than it
 * is. Round, not floor, so a DST hour doesn't shift the count.
 */
export function daysUntil(deadline: string): number {
  const [y, m, d] = deadline.split("-").map(Number);
  if (!y || !m || !d) return 0;
  const then = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((then.getTime() - today.getTime()) / 86_400_000);
}
