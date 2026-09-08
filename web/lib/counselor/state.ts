import type { CounselorProfile, CounselorState, StatePatch, Thread } from "./types";

/**
 * Where the counselor's memory lives.
 *
 * The same place everything else in Slates lives: this browser. There is no
 * account and no server-side row, so the counselor's entire recollection of a
 * student — their profile, what it has learned, every document it wrote — is
 * one JSON object under one key. It is handed to the model on each turn and
 * comes back patched.
 *
 * Consequences worth stating plainly: clearing site data forgets the student,
 * and nothing here syncs to another machine. That is the trade Slates already
 * makes everywhere else, and it is why none of this needs a login.
 */

const KEY = "slates.counselor.v1";

export const DEFAULT_PROFILE: CounselorProfile = {
  name: "",
  gradeLevel: 11,
  applyYear: new Date().getFullYear() + 1,
  state: "",
  firstGen: false,
  gpaUnweighted: null,
  rigor: "medium",
  sat: null,
  act: null,
  intendedMajor: "",
  activities: [],
  budgetMax: null,
};

export function emptyState(): CounselorState {
  return {
    profile: { ...DEFAULT_PROFILE, activities: [] },
    memories: [],
    tasks: [],
    documents: [],
    meetings: [],
    applications: [],
    list: [],
    coursework: [],
    testing: [],
    awards: [],
    essays: [],
    threads: [],
  };
}

/** Short, collision-resistant enough for one browser's worth of records. */
export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function newThread(): Thread {
  const now = Date.now();
  return { id: uid(), title: "New conversation", messages: [], createdAt: now, updatedAt: now };
}

/**
 * A saved state, repaired.
 *
 * Every collection is defaulted rather than trusted: a state written by an
 * older build is missing whatever was added since, and a missing array here
 * would crash a view rather than merely lose a feature.
 */
export function loadState(): CounselorState {
  if (typeof window === "undefined") return emptyState();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const saved = JSON.parse(raw) as Partial<CounselorState>;
    const base = emptyState();
    return {
      profile: { ...base.profile, ...(saved.profile ?? {}), activities: saved.profile?.activities ?? [] },
      memories: saved.memories ?? [],
      tasks: saved.tasks ?? [],
      documents: saved.documents ?? [],
      meetings: saved.meetings ?? [],
      applications: saved.applications ?? [],
      list: saved.list ?? [],
      coursework: saved.coursework ?? [],
      testing: saved.testing ?? [],
      awards: saved.awards ?? [],
      essays: saved.essays ?? [],
      threads: saved.threads ?? [],
    };
  } catch {
    return emptyState();
  }
}

export function saveState(state: CounselorState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Quota, private browsing, a wiped profile — the session still works, it
    // just won't outlive the tab. Not worth interrupting the student over.
  }
}

/** Folds a turn's edits back into the state. Absent keys were never touched. */
export function applyPatch(state: CounselorState, patch: StatePatch): CounselorState {
  return {
    ...state,
    ...(patch.profile ? { profile: patch.profile } : {}),
    ...(patch.memories ? { memories: patch.memories } : {}),
    ...(patch.tasks ? { tasks: patch.tasks } : {}),
    ...(patch.documents ? { documents: patch.documents } : {}),
    ...(patch.meetings ? { meetings: patch.meetings } : {}),
    ...(patch.applications ? { applications: patch.applications } : {}),
    ...(patch.list ? { list: patch.list } : {}),
    ...(patch.coursework ? { coursework: patch.coursework } : {}),
    ...(patch.testing ? { testing: patch.testing } : {}),
    ...(patch.awards ? { awards: patch.awards } : {}),
    ...(patch.essays ? { essays: patch.essays } : {}),
  };
}

/** Everything except the conversation — all the model is ever handed. */
export function factsOf(state: CounselorState): Omit<CounselorState, "threads"> {
  const { threads: _threads, ...rest } = state;
  void _threads;
  return rest;
}

/** Whether the student has told the counselor enough for its advice to mean anything. */
export function profileReady(p: CounselorProfile): boolean {
  return Boolean(p.name.trim()) && p.gpaUnweighted != null;
}

export const GRADE_LABEL: Record<number, string> = {
  9: "9th grade",
  10: "10th grade",
  11: "11th grade",
  12: "12th grade",
  13: "Gap year / transfer",
};
