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

export const COUNSELOR_KEY = "slates.counselor.v2";
export const LEGACY_COUNSELOR_KEY = "slates.counselor.v1";

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
    schemaVersion: 2,
    profile: { ...DEFAULT_PROFILE, activities: [] },
    memories: [],
    tasks: [],
    meetings: [],
    applications: [],
    list: [],
    coursework: [],
    testing: [],
    awards: [],
    essays: [],
    calls: [],
    threads: [],
    masterPlan: null,
    planProposals: [],
    planRevisions: [],
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
    const current = window.localStorage.getItem(COUNSELOR_KEY);
    const raw = current ?? window.localStorage.getItem(LEGACY_COUNSELOR_KEY);
    if (!raw) return emptyState();
    type LegacyMessage = CounselorState["threads"][number]["messages"][number] & {
      documents?: unknown;
    };
    /*
     * `threads` is lifted out of the Partial before being re-declared:
     * intersecting `Partial<CounselorState>` with a narrower `threads` leaves
     * both declarations in play, and the element type collapses back to the
     * current ChatMessage — which is how stripping the removed `documents`
     * field stopped compiling.
     */
    type SavedState = Omit<Partial<CounselorState>, "threads"> & {
      threads?: Array<Omit<CounselorState["threads"][number], "messages"> & { messages: LegacyMessage[] }>;
    };
    const saved = JSON.parse(raw) as SavedState;
    const base = emptyState();
    const normalized: CounselorState = {
      profile: { ...base.profile, ...(saved.profile ?? {}), activities: saved.profile?.activities ?? [] },
      schemaVersion: 2,
      memories: saved.memories ?? [],
      tasks: saved.tasks ?? [],
      meetings: saved.meetings ?? [],
      applications: saved.applications ?? [],
      list: saved.list ?? [],
      coursework: saved.coursework ?? [],
      testing: saved.testing ?? [],
      awards: saved.awards ?? [],
      essays: saved.essays ?? [],
      calls: saved.calls ?? [],
      threads: (saved.threads ?? []).map((thread) => ({
        ...thread,
        messages: thread.messages.map(({ documents: _documents, ...message }) => message),
      })),
      masterPlan: saved.masterPlan ?? null,
      planProposals: saved.planProposals ?? [],
      planRevisions: saved.planRevisions ?? [],
    };
    if (!current) window.localStorage.setItem(COUNSELOR_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    return emptyState();
  }
}

export function saveState(state: CounselorState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COUNSELOR_KEY, JSON.stringify(state));
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
    ...(patch.meetings ? { meetings: patch.meetings } : {}),
    ...(patch.applications ? { applications: patch.applications } : {}),
    ...(patch.list ? { list: patch.list } : {}),
    ...(patch.coursework ? { coursework: patch.coursework } : {}),
    ...(patch.testing ? { testing: patch.testing } : {}),
    ...(patch.awards ? { awards: patch.awards } : {}),
    ...(patch.essays ? { essays: patch.essays } : {}),
    ...(patch.masterPlan !== undefined ? { masterPlan: patch.masterPlan } : {}),
    ...(patch.planProposals ? { planProposals: patch.planProposals } : {}),
    ...(patch.planRevisions ? { planRevisions: patch.planRevisions } : {}),
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
