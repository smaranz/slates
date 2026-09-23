import type {
  MasterPlan,
  PlanOperation,
  PlanRevision,
} from "./plan-types";
import type { CounselorState } from "./types";
import { uid } from "./state";

export const MAX_PLAN_REVISIONS = 5;

export function planFingerprint(state: Pick<CounselorState, "profile" | "memories" | "coursework" | "testing" | "awards" | "essays" | "list" | "applications">): string {
  const material = JSON.stringify({
    profile: state.profile,
    memories: state.memories,
    coursework: state.coursework,
    testing: state.testing,
    awards: state.awards,
    essays: state.essays.map((essay) => ({
      id: essay.id,
      kind: essay.kind,
      collegeName: essay.collegeName,
      words: essay.content.trim().split(/\s+/).filter(Boolean).length,
      updatedAt: essay.updatedAt,
    })),
    list: state.list,
    applications: state.applications,
  });
  let hash = 2166136261;
  for (let index = 0; index < material.length; index += 1) {
    hash ^= material.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function applyPlanOperation(plan: MasterPlan, operation: PlanOperation): MasterPlan | null {
  const now = Date.now();
  let changed = false;
  let next = plan;

  if (operation.type === "update-recommendation") {
    const rows = plan.strategy[operation.area].map((row) => {
      if (row.id !== operation.recommendationId) return row;
      changed = true;
      return { ...row, ...operation.changes, id: row.id };
    });
    next = { ...plan, strategy: { ...plan.strategy, [operation.area]: rows } };
  }

  if (operation.type === "select-project") {
    if (operation.projectId !== null && !plan.projects.ideas.some((project) => project.id === operation.projectId)) {
      return null;
    }
    changed = plan.projects.selectedProjectId !== operation.projectId;
    next = { ...plan, projects: { ...plan.projects, selectedProjectId: operation.projectId } };
  }

  if (operation.type === "remove-college") {
    const colleges = plan.colleges.filter((college) => college.id !== operation.collegeId);
    changed = colleges.length !== plan.colleges.length;
    next = { ...plan, colleges };
  }

  if (operation.type === "remove-next-step") {
    const nextSteps = plan.nextSteps.filter((step) => step.id !== operation.stepId);
    changed = nextSteps.length !== plan.nextSteps.length;
    next = { ...plan, nextSteps };
  }

  if (operation.type === "drop-activity") {
    const dropped = dropActivity(plan, operation.name);
    if (!dropped || dropped.removed === 0) return null;
    changed = true;
    next = dropped.plan;
  }

  if (operation.type === "revise-text") {
    const find = operation.find.trim();
    // A short needle would match half the plan; an exact sentence will not.
    if (find.length < 12) return null;
    let hits = 0;
    const rewrite = (node: unknown): unknown => {
      if (typeof node === "string") {
        if (!node.includes(find)) return node;
        hits += 1;
        return node.split(find).join(operation.replace);
      }
      if (Array.isArray(node)) return node.map(rewrite);
      if (node && typeof node === "object") {
        return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, rewrite(v)]));
      }
      return node;
    };
    // `generator` is import provenance, not advice, and is left alone.
    const { generator, ...rest } = plan;
    const revised = rewrite(rest) as Omit<MasterPlan, "generator">;
    if (hits === 0) return null;
    changed = true;
    next = { ...revised, generator } as MasterPlan;
  }

  if (operation.type === "revise-evaluation") {
    const e = plan.evaluation;
    const evaluation = {
      ...e,
      ...(operation.profileSummary ? { profileSummary: operation.profileSummary } : {}),
      ...(operation.competitivenessReadout
        ? { competitivenessReadout: operation.competitivenessReadout }
        : {}),
      ...(operation.academicSummary
        ? { academic: { ...e.academic, summary: operation.academicSummary } }
        : {}),
      ...(operation.extracurricularSummary
        ? { extracurricular: { ...e.extracurricular, summary: operation.extracurricularSummary } }
        : {}),
    };
    changed = JSON.stringify(evaluation) !== JSON.stringify(e);
    next = { ...plan, evaluation };
  }

  return changed ? { ...next, version: plan.version + 1, updatedAt: now } : null;
}

/**
 * Take an activity out of the parts of the plan that are only about it.
 *
 * Deliberately not a find-and-replace. A line like "Turn Code Starters, Hacks
 * on Fire, bootcamps, and Publick into documented outcomes" is still true
 * without its last item, and deleting it would lose real advice about three
 * other activities; cutting the word out in place is worse still, leaving "and
 *  into documented outcomes".
 *
 * So an entry is removed only when this activity is the sole thing it names.
 * Everything else is returned in `remaining` for the counselor to rewrite, and
 * the tool reports that count back — which is what stops it announcing the
 * activity is gone while most of the plan still assumes it.
 */
export function dropActivity(
  plan: MasterPlan,
  name: string
): { plan: MasterPlan; removed: number; remaining: string[] } | null {
  const needle = name.trim().toLowerCase();
  if (needle.length < 3) return null;

  /*
   * The student's other activities, read off the plan itself rather than
   * guessed: anything the plan treats as a named thing. A line mentioning one
   * of these alongside the dropped activity is about more than the drop.
   */
  const others = new Set<string>();
  for (const idea of plan.projects.ideas) others.add(idea.title.toLowerCase());
  for (const rows of Object.values(plan.strategy)) {
    for (const row of rows) others.add(row.title.toLowerCase());
  }
  const otherNames = [...others].filter((o) => !o.includes(needle));

  const mentions = (text: string) => text.toLowerCase().includes(needle);

  /*
   * Other proper nouns in the same line — excluding the student's own name,
   * which appears in nearly every sentence and would otherwise make every
   * entry look shared.
   */
  const namesSomethingElse = (text: string) => {
    const lower = text.toLowerCase();
    if (otherNames.some((o) => o.length > 4 && lower.includes(o))) return true;
    const proper = text.match(/\b[A-Z][a-z]+(?: [A-Z][a-z]+)+/g) ?? [];
    return proper.some((phrase) => {
      const p = phrase.toLowerCase();
      return !p.includes(needle) && p !== plan.evaluation.profileSummary.split(" ")[0]?.toLowerCase();
    });
  };

  const soleSubject = (text: string) => mentions(text) && !namesSomethingElse(text);

  const remaining: string[] = [];
  let removed = 0;

  /** Drop the entries this activity owns outright; note the ones it shares. */
  const sift = (rows: string[]) =>
    rows.filter((row) => {
      if (!mentions(row)) return true;
      if (soleSubject(row)) {
        removed += 1;
        return false;
      }
      remaining.push(row);
      return true;
    });

  const e = plan.evaluation;
  const evaluation = {
    ...e,
    advantages: sift(e.advantages),
    risks: sift(e.risks),
    improvements: sift(e.improvements),
    academic: { ...e.academic, evidence: sift(e.academic.evidence) },
    extracurricular: { ...e.extracurricular, evidence: sift(e.extracurricular.evidence) },
    narrativeThemes: e.narrativeThemes.map((theme) => ({ ...theme, evidence: sift(theme.evidence) })),
  };

  const siftTitled = <T extends { title: string }>(rows: T[]) =>
    rows.filter((row) => {
      if (!mentions(row.title)) return true;
      if (soleSubject(row.title)) {
        removed += 1;
        return false;
      }
      remaining.push(row.title);
      return true;
    });

  const strategy = Object.fromEntries(
    Object.entries(plan.strategy).map(([area, rows]) => [area, siftTitled(rows)])
  ) as MasterPlan["strategy"];

  const ideas = plan.projects.ideas.filter((idea) => {
    if (!mentions(idea.title)) return true;
    removed += 1;
    return false;
  });

  const projects = {
    ...plan.projects,
    ideas,
    // A selection pointing at a removed idea would leave the Projects tab
    // highlighting something no longer on it.
    selectedProjectId: ideas.some((idea) => idea.id === plan.projects.selectedProjectId)
      ? plan.projects.selectedProjectId
      : null,
    essayPositioning: sift(plan.projects.essayPositioning),
  };

  const roadmap = {
    years: plan.roadmap.years.map((period) => ({ ...period, milestones: siftTitled(period.milestones) })),
    terms: plan.roadmap.terms.map((period) => ({ ...period, milestones: siftTitled(period.milestones) })),
  };

  const nextSteps = siftTitled(plan.nextSteps);
  const missingInfo = sift(plan.missingInfo);

  const after = { ...plan, evaluation, strategy, projects, roadmap, nextSteps, missingInfo };

  /*
   * Everything still naming the activity, swept off the finished plan rather
   * than collected field by field.
   *
   * The first version of this listed the places it knew about, and quietly
   * missed the ones it didn't — a college's `weakness`, a recommendation's
   * `why`, a career direction's rationale. Missing a mention here reproduces
   * the exact bug this operation exists to fix, so the check is now whatever
   * the plan actually says.
   */
  const seen = new Set(remaining);
  const sweep = (node: unknown) => {
    if (typeof node === "string") {
      if (node.toLowerCase().includes(needle) && !seen.has(node)) {
        seen.add(node);
        remaining.push(node);
      }
      return;
    }
    if (Array.isArray(node)) return node.forEach(sweep);
    if (node && typeof node === "object") return Object.values(node).forEach(sweep);
  };
  // `generator` records where the plan was imported from, not what the student
  // does; a Publick-sourced plan mentions it there for ever and correctly so.
  sweep({ ...after, generator: undefined });
  if (removed === 0 && remaining.length === 0) return null;
  return { plan: after, removed, remaining };
}

export function revisionOf(plan: MasterPlan, summary: string): PlanRevision {
  return {
    id: uid(),
    version: plan.version,
    summary,
    plan: structuredClone(plan),
    createdAt: Date.now(),
  };
}

export function pushRevision(revisions: PlanRevision[], revision: PlanRevision): PlanRevision[] {
  return [revision, ...revisions].slice(0, MAX_PLAN_REVISIONS);
}

export function restoreRevision(revision: PlanRevision): MasterPlan {
  return {
    ...structuredClone(revision.plan),
    version: revision.plan.version + 1,
    updatedAt: Date.now(),
  };
}
