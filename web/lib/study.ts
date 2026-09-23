"use client";

import { useCallback, useSyncExternalStore } from "react";

import type { Assignment, Course } from "./types";
import type { Quiz } from "./tutor-quiz";

/**
 * Study Studio's own memory.
 *
 * Kept apart from the Schoology snapshot on purpose: the snapshot is a
 * disposable cache that a single bad scrape replaces wholesale, and a study
 * plan a student worked through is not. The relationship is one-way — a module
 * points at an `assignmentId` and reads the live assignment through the board,
 * so a rescheduled test moves on its own and nothing here has to be migrated.
 *
 * Follows lib/tutor-chats.ts as the persistence pattern: one localStorage key,
 * a module-level snapshot, and `useSyncExternalStore` so every view sees the
 * same object.
 */

const KEY = "slates.study.v1";

/** Debounced so a session tick doesn't write on every keystroke. */
const WRITE_DELAY_MS = 400;

/**
 * What a generated module holds.
 *
 * Deliberately not a curriculum: no skill graph, no standards taxonomy. Every
 * field here is derived from *this* assessment and *this* course's gradebook,
 * which is the thing Slates has and a generic tutor does not.
 */
export interface StudyModule {
  id: string;
  /** The Schoology assignment this studies. The link is the whole point. */
  assignmentId: string;
  courseId: string;
  /** Snapshotted so a module still reads sensibly if the item leaves the board. */
  title: string;
  /** When the assessment is due, as the board worded it. */
  due: string;
  /** Null until generated — a module exists as soon as the assessment does. */
  plan: StudyPlan | null;
  /** Set while a build is running, so the card can say so across a reload. */
  building?: boolean;
  /** Why the last build failed, shown on the card rather than swallowed. */
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface StudyPlan {
  /** What the assessment is actually testing, in the model's words. */
  covers: string[];
  /** A short ordered plan — not a 40-step syllabus. */
  steps: { title: string; detail: string; minutes: number }[];
  /** Practice in the tutor's existing quiz format, so QuizCard renders it. */
  practice: Quiz | null;
  /**
   * Topics this course's gradebook suggests are weak, each with the entry it
   * came from. Evidence is required: an untraceable "you're weak at X" is a
   * guess a student cannot check.
   */
  weakTopics: { topic: string; evidence: string }[];
  /** Which model built it, so a stale module can be told apart from a new one. */
  generator: { model: string; at: number };
}

export interface StudySession {
  id: string;
  moduleId: string;
  startedAt: number;
  endedAt?: number;
  /** Written when the session ends — the research doc's "Past sessions" object. */
  recap?: string;
  /** Practice scored during this sitting, for the recap to be about something. */
  answered?: number;
  correct?: number;
}

export interface StudyState {
  modules: StudyModule[];
  sessions: StudySession[];
}

const EMPTY: StudyState = { modules: [], sessions: [] };

let snapshot: StudyState = EMPTY;
let loaded = false;
let writeTimer: number | null = null;
const listeners = new Set<() => void>();

function read(): StudyState {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<StudyState>;
    return {
      modules: Array.isArray(parsed.modules) ? parsed.modules : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    };
  } catch {
    return EMPTY;
  }
}

function persist(): void {
  if (typeof window === "undefined") return;
  if (writeTimer) window.clearTimeout(writeTimer);
  writeTimer = window.setTimeout(() => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(snapshot));
    } catch {
      // Storage full or blocked. The session still works in memory.
    }
  }, WRITE_DELAY_MS);
}

function emit(next: StudyState): void {
  snapshot = next;
  persist();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  if (!loaded) {
    snapshot = read();
    loaded = true;
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): StudyState {
  if (!loaded && typeof window !== "undefined") {
    snapshot = read();
    loaded = true;
  }
  return snapshot;
}

/** The server has no localStorage; it renders the empty studio. */
function getServerSnapshot(): StudyState {
  return EMPTY;
}

function uid(): string {
  return `sm${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/* ---------------------------------------------------------------- ingestion */

/**
 * Titles that name an assessment even when Schoology's `kind` doesn't.
 *
 * Teachers post tests as plain assignments constantly. The list is
 * deliberately narrow and anchored on whole words: "test" matches "Unit 3
 * Test" and not "Testing procedures lab", and a homework set called "Quiz
 * review" is review, not a quiz. Over-importing is the worse failure — a
 * Study Studio full of worksheets stops being about assessments.
 */
const ASSESSMENT_TITLE =
  /\b(test|exam|midterm|final|quiz|prueba|examen|frq|mcq|benchmark|assessment)\b/i;

/** Words that mean the item is *about* a test rather than being one. */
const NOT_AN_ASSESSMENT = /\b(review|study guide|practice|prep|corrections|retake form|sign[- ]?up)\b/i;

export function isAssessment(assignment: Assignment): boolean {
  if (assignment.kind === "quiz" || assignment.kind === "assessment") return true;
  // Schoology's own assessment metadata is a stronger signal than any title.
  if (assignment.assessment) return true;
  const title = assignment.title ?? "";
  return ASSESSMENT_TITLE.test(title) && !NOT_AN_ASSESSMENT.test(title);
}

/**
 * Bring the board's assessments in, without disturbing what's already here.
 *
 * Runs on every board change. New assessments appear as empty modules; the
 * title and due date are refreshed so a rescheduled test reads correctly;
 * generated plans are never touched. Nothing is ever removed here: a module
 * whose test has passed stops being listed (the studio shows what's ahead) but
 * its plan and sessions stay, so a rescheduled test comes back with the work
 * already done on it rather than a blank card.
 */
export function ingest(assignments: Assignment[]): void {
  const state = getSnapshot();
  const byAssignment = new Map(state.modules.map((m) => [m.assignmentId, m]));
  const now = Date.now();

  let changed = false;
  const modules = [...state.modules];

  for (const assignment of assignments) {
    if (!isAssessment(assignment)) continue;

    const existing = byAssignment.get(assignment.id);
    if (!existing) {
      /*
       * Nothing new for a test already sat. A first sync on a board halfway
       * through a term would otherwise mint a module for every quiz of the
       * last three months, none of which the studio shows.
       */
      if ((assignment.dateOffset ?? 0) < 0) continue;

      modules.push({
        id: uid(),
        assignmentId: assignment.id,
        courseId: assignment.courseId,
        title: assignment.title,
        due: assignment.due,
        plan: null,
        createdAt: now,
        updatedAt: now,
      });
      changed = true;
      continue;
    }

    // Keep the label in step with the board, and nothing else.
    if (existing.title !== assignment.title || existing.due !== assignment.due) {
      const i = modules.indexOf(existing);
      modules[i] = { ...existing, title: assignment.title, due: assignment.due };
      changed = true;
    }
  }

  if (changed) emit({ ...state, modules });
}

/* ------------------------------------------------------------------- store */

export interface StudyStore extends StudyState {
  moduleFor: (assignmentId: string) => StudyModule | undefined;
  setModule: (id: string, patch: Partial<StudyModule>) => void;
  removeModule: (id: string) => void;
  /** The session currently running, if any. Only one at a time, by design. */
  openSession: StudySession | undefined;
  startSession: (moduleId: string) => string;
  endSession: (id: string, recap: string, scored?: { answered: number; correct: number }) => void;
  /** Throw a sitting away — see `dropSession` below for when that is right. */
  dropSession: (id: string) => void;
  sessionsFor: (moduleId: string) => StudySession[];
}

export function useStudy(): StudyStore {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const moduleFor = useCallback(
    (assignmentId: string) => state.modules.find((m) => m.assignmentId === assignmentId),
    [state.modules]
  );

  const setModule = useCallback((id: string, patch: Partial<StudyModule>) => {
    const current = getSnapshot();
    emit({
      ...current,
      modules: current.modules.map((m) =>
        m.id === id ? { ...m, ...patch, updatedAt: Date.now() } : m
      ),
    });
  }, []);

  const removeModule = useCallback((id: string) => {
    const current = getSnapshot();
    emit({
      modules: current.modules.filter((m) => m.id !== id),
      // Its sessions go with it, or they become orphans nothing can show.
      sessions: current.sessions.filter((s) => s.moduleId !== id),
    });
  }, []);

  const openSession = state.sessions.find((s) => !s.endedAt);

  const startSession = useCallback((moduleId: string) => {
    const current = getSnapshot();
    const id = `ss${Date.now().toString(36)}`;
    emit({
      ...current,
      // Close anything left open: a session abandoned by closing the app
      // should not still be counting when the student comes back tomorrow.
      sessions: [
        ...current.sessions.map((s) => (s.endedAt ? s : { ...s, endedAt: Date.now() })),
        { id, moduleId, startedAt: Date.now() },
      ],
    });
    return id;
  }, []);

  const endSession = useCallback(
    (id: string, recap: string, scored?: { answered: number; correct: number }) => {
      const current = getSnapshot();
      emit({
        ...current,
        sessions: current.sessions.map((s) =>
          s.id === id ? { ...s, endedAt: Date.now(), recap, ...scored } : s
        ),
      });
    },
    []
  );

  /**
   * Forget a sitting that never happened.
   *
   * Opening a module and going straight back out is not a study session, and
   * recording it would fill "Past sessions" with entries that say nothing.
   * React's development double-invoke would manufacture one on every open
   * without this.
   */
  const dropSession = useCallback((id: string) => {
    const current = getSnapshot();
    emit({ ...current, sessions: current.sessions.filter((s) => s.id !== id) });
  }, []);

  const sessionsFor = useCallback(
    (moduleId: string) =>
      state.sessions
        .filter((s) => s.moduleId === moduleId && s.endedAt)
        .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0)),
    [state.sessions]
  );

  return {
    ...state,
    moduleFor,
    setModule,
    removeModule,
    openSession,
    startSession,
    endSession,
    dropSession,
    sessionsFor,
  };
}

/* ------------------------------------------------------------------ sorting */

/**
 * Soonest first.
 *
 * `dateOffset` is days from today, so an upcoming test sorts by how close it
 * is. The studio filters past tests out before sorting, but the past branch
 * stays: a test can slip into the past while its module is open on screen.
 */
export function byWhenItMatters(
  a: { assignment?: Assignment },
  b: { assignment?: Assignment }
): number {
  const ao = a.assignment?.dateOffset;
  const bo = b.assignment?.dateOffset;
  const rank = (o: number | null | undefined) =>
    o === null || o === undefined ? 9_000 : o < 0 ? 10_000 - o : o;
  return rank(ao) - rank(bo);
}

/** Course name for a module, or a plain fallback rather than an empty chip. */
export function courseNameOf(courses: Course[], courseId: string): string {
  return courses.find((c) => c.id === courseId)?.name ?? "No class";
}
