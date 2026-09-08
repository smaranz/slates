"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useIdentity } from "./identity";
import { normalizeSnapshot } from "./normalize";
import { emptyOwnWork, withOwnWork, type OwnWork } from "./own-work";
import { EMPTY_SNAPSHOT, IMPACT_LABEL } from "./demo";
import { gradeFor, letterFor } from "./grades";
import { nowLabel } from "./format";
import type {
  Assignment,
  Bucket,
  Recipient,
  Comment,
  Course,
  CustomScore,
  LocalFile,
  Status,
  SyncSnapshot,
} from "./types";

export type View =
  | "board"
  | "classes"
  | "list"
  | "grades"
  | "calendar"
  | "tutor"
  | "essays"
  | "messages"
  | "settings";

/** How often the portal pulls from Schoology. */
const AUTO_SYNC_MS = 3 * 60_000;

/**
 * The last synced board, cached so a refresh renders instantly.
 *
 * Without this, reloading dropped straight back to sample data and waited on a
 * fresh scrape. Now the last snapshot renders immediately and the background
 * sync just updates it in place.
 *
 * This is a *cache*. It is disposable, it is rejected when it looks empty, and
 * nothing you did is allowed to live in it — see MARKS_KEY.
 */
const PERSIST_KEY = "slates.state.v1";
/**
 * What you did: ticked done, time tracked, scores added, attempts started.
 *
 * This used to share the snapshot's key, and that cost real work. The snapshot
 * is rejected on load unless it still carries assignments, so a single scrape
 * that came back empty — an expired Schoology session, a slow To Do panel —
 * made the next launch throw the whole blob away and tick every finished
 * assignment back to Tonight. Your marks are not a cache and are never gated on
 * the snapshot being any good.
 */
const MARKS_KEY = "slates.marks.v1";

interface Persisted {
  snapshot: SyncSnapshot;
  syncStats: SyncStats | null;
  studentName: string;
}

interface Marks {
  status: Record<string, Status>;
  timeTotals: Record<string, number>;
  customScores: CustomScore[];
  submittedAt: Record<string, string | null>;
  attempts: Record<string, number>;
  /**
   * Columns you dragged a card into. A plan you made by hand outranks one
   * derived from a due date, so this lives with the marks and survives every
   * resync — the estimator may re-read an assignment, but it never gets to
   * move a card you placed yourself.
   */
  buckets: Record<string, Bucket>;
  /**
   * Work the Sunday sweep took off the board, and when. Nothing is deleted:
   * these are still in the snapshot, still searchable, still on the calendar —
   * they've just stopped competing for attention with the week ahead.
   */
  archived: Record<string, number>;
  /** The reset boundary already applied, so a week is never swept twice. */
  sweptAt: number;
  /**
   * Work you added that Schoology never knew about. Kept with the marks, not
   * the snapshot, because a bad scrape must never delete something you typed.
   */
  ownWork: OwnWork[];
}

/**
 * The most recent Sunday 7pm on or before `now`.
 *
 * Computed rather than scheduled, so the sweep survives the app being shut
 * on Sunday evening — whenever it next opens it can see it missed one and
 * catch up. Local time on purpose: 7pm means 7pm where the student is.
 */
export function lastSundayReset(now: Date = new Date()): number {
  const boundary = new Date(now);
  boundary.setHours(19, 0, 0, 0);
  boundary.setDate(boundary.getDate() - boundary.getDay()); // back to Sunday
  // Sunday before 7pm belongs to the week that started last Sunday.
  if (boundary.getTime() > now.getTime()) boundary.setDate(boundary.getDate() - 7);
  return boundary.getTime();
}

function loadPersisted(): Partial<Persisted> | null {
  try {
    const raw = window.localStorage.getItem(PERSIST_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Persisted>;
    // Only trust it if it actually carries a synced snapshot.
    return p?.snapshot?.assignments?.length ? p : null;
  } catch {
    return null;
  }
}

const NO_MARKS: Marks = {
  status: {},
  timeTotals: {},
  customScores: [],
  submittedAt: {},
  attempts: {},
  buckets: {},
  archived: {},
  ownWork: [],
  // No sweep recorded yet: start from this week's boundary rather than
  // sweeping a first-run board that hasn't had a week to accumulate anything.
  sweptAt: lastSundayReset(),
};

const BUCKETS: Bucket[] = ["overdue", "tonight", "soon", "week", "done"];

/** Only keep placements that name a column this build still has. */
function readBuckets(value: unknown): Record<string, Bucket> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, Bucket] => BUCKETS.includes(entry[1] as Bucket)
    )
  );
}

function readMarks(raw: string | null): Marks | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<Marks>;
    if (!p || typeof p !== "object") return null;
    return {
      status: p.status ?? {},
      timeTotals: p.timeTotals ?? {},
      customScores: p.customScores ?? [],
      submittedAt: p.submittedAt ?? {},
      attempts: p.attempts ?? {},
      buckets: readBuckets(p.buckets),
      archived: typeof p.archived === "object" && p.archived ? p.archived : {},
      sweptAt: typeof p.sweptAt === "number" ? p.sweptAt : lastSundayReset(),
      ownWork: Array.isArray(p.ownWork) ? p.ownWork : [],
    };
  } catch {
    return null;
  }
}

/**
 * Marks from their own key, falling back to the combined blob they used to
 * share with the snapshot. That fallback deliberately skips the snapshot
 * check — the point is to rescue marks from a blob whose snapshot went empty.
 */
function loadMarks(): Marks {
  try {
    const own = readMarks(window.localStorage.getItem(MARKS_KEY));
    if (own) return own;
    return readMarks(window.localStorage.getItem(PERSIST_KEY)) ?? NO_MARKS;
  } catch {
    return NO_MARKS;
  }
}



/** Where a hand-in or a reply got to, for the one line of status under it. */
export interface SubmitState {
  phase: "idle" | "submitting" | "verifying" | "done" | "error";
  message?: string;
  /** The stage being attempted, when there is one worth naming. */
  step?: string;
  /** When this submission started, so the UI can show it ticking rather than hung. */
  startedAt?: number;
}

/** What the last crawl actually found — surfaced so an empty board is explainable. */
export interface SyncStats {
  courses: number;
  items: number;
  dated: number;
  at: number;
}

interface Store {
  snapshot: SyncSnapshot;
  demoMode: boolean;
  connected: boolean;
  connecting: boolean;
  syncError: string | null;
  syncStats: SyncStats | null;
  resync: () => Promise<void>;

  /** The Schoology REST API, signed with your own key. */
  syncNow: (fresh?: boolean) => Promise<void>;
  connect: () => void;
  disconnect: () => void;

  view: View;
  nav: string;
  setNav: (label: string, view: View) => void;
  setView: (v: View) => void;

  courseId: string | null;
  openCourse: (id: string | null) => void;

  assignmentId: string | null;
  openAssignment: (id: string | null) => void;

  /** Work you added by hand, newest first. */
  ownWork: OwnWork[];
  /** Adds a blank one for a course and returns it, ready to edit. */
  addOwnWork: (courseId?: string) => OwnWork;
  saveOwnWork: (work: OwnWork) => void;
  removeOwnWork: (id: string) => void;

  statusOf: (a: Assignment) => Status;
  setStatus: (id: string, s: Status) => void;

  /** The column a card belongs in, your own placements included. */
  bucketOf: (a: Assignment) => Bucket;
  /** Drop a card into a column and keep it there across syncs. */
  moveTo: (id: string, to: Bucket) => void;

  /**
   * Whether a card belongs to the current week's board. Finished and past-due
   * work is swept off every Sunday at 7pm — still searchable, still on the
   * calendar, just no longer in the way.
   */
  onBoard: (a: Assignment) => boolean;
  /** When each swept card left the board, keyed by assignment id. */
  archived: Record<string, number>;

  courseById: (id: string) => Course | undefined;
  assignmentById: (id: string) => Assignment | undefined;

  /* per-assignment local editing state */
  text: Record<string, string>;
  setText: (id: string, v: string) => void;
  files: Record<string, LocalFile[]>;
  addFiles: (id: string, list: FileList | null) => void;
  removeFile: (id: string, fileId: string) => void;
  submittedAt: Record<string, string | null>;
  draftSavedAt: Record<string, string>;
  submitState: Record<string, SubmitState>;
  saveDraft: (id: string) => Promise<void>;
  turnIn: (id: string) => Promise<void>;
  unsubmit: (id: string) => Promise<void>;
  openOverlay: (id: string) => Promise<void>;
  /** Attempt start times, keyed by assignment id, for the companion countdown. */
  attempts: Record<string, number>;
  startClock: (id: string) => void;
  clearAttempt: (id: string) => void;

  localComments: Record<string, Comment[]>;
  commentDraft: Record<string, string>;
  setCommentDraft: (id: string, v: string) => void;
  addComment: (id: string) => Promise<void>;

  /* grades */
  customScores: CustomScore[];
  addScore: (s: Omit<CustomScore, "id" | "date">) => void;
  removeScore: (id: string) => void;
  projectionFor: (courseId: string) => { pct: number | null; letter: string };

  /* messages */
  msgRead: Record<string, boolean>;
  msgOpen: string | null;
  openMessage: (id: string | null) => void;
  /** What you've typed back to a teacher, per thread. */
  replyDrafts: Record<string, string>;
  setReplyDraft: (id: string, v: string) => void;
  /** Progress of a reply being typed into Schoology, per thread. */
  replyState: Record<string, SubmitState>;
  sendReply: (id: string) => Promise<void>;

  /* composing a brand new conversation */
  composing: boolean;
  openCompose: (open: boolean) => void;
  composeTo: Recipient[];
  addRecipient: (person: Recipient) => void;
  removeRecipient: (uid: string) => void;
  composeSubject: string;
  setComposeSubject: (v: string) => void;
  composeBody: string;
  setComposeBody: (v: string) => void;
  /** Look a name up in Schoology's directory. */
  findRecipients: (query: string) => Promise<Recipient[]>;
  composeState: SubmitState;
  sendNewMessage: () => Promise<void>;

  /* settings — name and photo persist on their own, not with the snapshot */
  studentName: string;
  setStudentName: (v: string) => void;
  avatar: string | null;
  setAvatar: (dataUrl: string | null) => void;

  /* time tracking */
  timeTotals: Record<string, number>;
  activeTimer: string | null;
  toggleTimer: (id: string) => Promise<void>;
}

const Ctx = createContext<Store | null>(null);


export function useStore(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore must be used inside <StoreProvider>");
  return v;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<SyncSnapshot>(EMPTY_SNAPSHOT);
  const [demoMode, setDemoMode] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncStats, setSyncStats] = useState<SyncStats | null>(null);

  const [view, setView] = useState<View>("board");
  const [nav, setNavLabel] = useState("Assignments");
  const [courseId, setCourseId] = useState<string | null>(null);
  const [assignmentId, setAssignmentId] = useState<string | null>(null);

  const [status, setStatusMap] = useState<Record<string, Status>>({});
  const [buckets, setBucketMap] = useState<Record<string, Bucket>>({});
  const [text, setTextMap] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, LocalFile[]>>({});
  const [submittedAt, setSubmittedAt] = useState<Record<string, string | null>>({});
  /**
   * When each attempt was opened from Slates, so the companion countdown
   * survives a refresh. Schoology owns the authoritative clock server-side —
   * this only mirrors it from the moment we handed you over.
   */
  const [attempts, setAttempts] = useState<Record<string, number>>({});
  const [draftSavedAt, setDraftSavedAt] = useState<Record<string, string>>({});
  const [submitState, setSubmitState] = useState<Record<string, SubmitState>>({});
  const [localComments, setLocalComments] = useState<Record<string, Comment[]>>({});
  const [commentDraft, setCommentDraftMap] = useState<Record<string, string>>({});

  const [customScores, setCustomScores] = useState<CustomScore[]>([]);
  const [ownWork, setOwnWork] = useState<OwnWork[]>([]);
  const [msgRead, setMsgRead] = useState<Record<string, boolean>>({});
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyState, setReplyState] = useState<Record<string, SubmitState>>({});
  const [archived, setArchived] = useState<Record<string, number>>({});
  const [sweptAt, setSweptAt] = useState<number>(() => lastSundayReset());
  const [composing, setComposing] = useState(false);
  const [composeTo, setComposeTo] = useState<Recipient[]>([]);
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeState, setComposeState] = useState<SubmitState>({ phase: "idle" });
  const [msgOpen, setMsgOpen] = useState<string | null>(null);

  // The student's name and photo are shared with the counselor half rather
  // than owned here — see lib/identity.tsx. The store still exposes them under
  // their old names so nothing that reads `s.studentName` had to change.
  const identity = useIdentity();
  const { name: studentName, avatar } = identity;
  const { setName: setStudentName, setAvatar } = identity;

  const [timeTotals, setTimeTotals] = useState<Record<string, number>>({});
  const [activeTimer, setActiveTimer] = useState<string | null>(null);
  const lastSyncAt = useRef(0);
  const syncing = useRef(false);
  /** The board as it stands, readable from the sync callback without a dep on it. */
  const snapshotRef = useRef(snapshot);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  /* ---- persistence ---- */

  const hydrated = useRef(false);
  const cacheReady = useRef(false);
  const marksReady = useRef(false);
  // Whatever a debounced write below hasn't flushed to disk yet — a closing
  // window doesn't wait for the debounce, so these get flushed immediately
  // on pagehide instead of losing whatever changed in the last 300ms.
  const pendingMarksWrite = useRef<(() => void) | null>(null);
  const pendingCacheWrite = useRef<(() => void) | null>(null);

  // Restore the last synced state before any network call, so a refresh shows
  // your real board immediately instead of sample data.
  useEffect(() => {
    // Marks load on their own terms — a rejected snapshot must never take your
    // ticked-off work down with it.
    const marks = loadMarks();
    setStatusMap(marks.status);
    setBucketMap(marks.buckets);
    setArchived(marks.archived);
    setSweptAt(marks.sweptAt);
    setTimeTotals(marks.timeTotals);
    setCustomScores(marks.customScores);
    setOwnWork(marks.ownWork);
    setSubmittedAt(marks.submittedAt);
    setAttempts(marks.attempts);

    const p = loadPersisted();
    hydrated.current = true;
    if (!p?.snapshot) return;

    setSnapshot(p.snapshot);
    setDemoMode(false);
    setConnected(true);
    if (p.syncStats) setSyncStats(p.syncStats);
  }, []);

  /**
   * Marks are written on every change, and — like the profile — the first pass
   * after mount is skipped so the empty initial state can't overwrite what was
   * just loaded off disk. Nothing here is conditional on the snapshot: marks
   * outlive a bad sync, a disconnect, and demo mode.
   */
  useEffect(() => {
    if (!hydrated.current) return;
    if (!marksReady.current) {
      marksReady.current = true;
      return;
    }
    const write = () => {
      try {
        window.localStorage.setItem(
          MARKS_KEY,
          JSON.stringify({
            status,
            timeTotals,
            customScores,
            ownWork,
            submittedAt,
            attempts,
            buckets,
            archived,
            sweptAt,
          })
        );
      } catch {
        /* quota or private mode — persistence is a nicety, not required */
      }
      pendingMarksWrite.current = null;
    };
    pendingMarksWrite.current = write;
    const t = window.setTimeout(write, 300);
    return () => window.clearTimeout(t);
  }, [status, timeTotals, customScores, ownWork, submittedAt, attempts, buckets, archived, sweptAt]);

  // Cache the snapshot after hydration, so the initial demo state can't
  // overwrite a good saved board on first paint.
  useEffect(() => {
    if (!hydrated.current || demoMode) return;
    if (!cacheReady.current) {
      cacheReady.current = true;
      return;
    }
    const write = () => {
      try {
        window.localStorage.setItem(
          PERSIST_KEY,
          JSON.stringify({ snapshot, syncStats, studentName })
        );
      } catch {
        /* quota or private mode — persistence is a nicety, not required */
      }
      pendingCacheWrite.current = null;
    };
    pendingCacheWrite.current = write;
    const t = window.setTimeout(write, 300);
    return () => window.clearTimeout(t);
  }, [snapshot, syncStats, studentName, demoMode]);

  // A closing or backgrounded window doesn't wait for the 300ms debounce
  // above — flush whatever's pending immediately so a mark made seconds
  // before closing the tab (the exact moment a student is done for the
  // night) doesn't silently lose the write.
  useEffect(() => {
    function flushPending() {
      pendingMarksWrite.current?.();
      pendingCacheWrite.current?.();
    }
    function onVisibility() {
      if (document.visibilityState === "hidden") flushPending();
    }
    window.addEventListener("pagehide", flushPending);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flushPending);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  /* ---- connection ---- */

  /**
   * Pull a fresh snapshot from the Schoology API.
   *
   * Guarded against overlap — the automatic poll and a manual Sync can land
   * together, and a sync is a few dozen signed requests, not one.
   */
  const syncNow = useCallback(async (fresh = true) => {
    if (syncing.current) return;
    syncing.current = true;
    setConnecting(true);
    setSyncError(null);
    try {
      const res = await fetch(`/api/scrape${fresh ? "?fresh=1" : ""}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Sync failed (${res.status})`);

      const snap = normalizeSnapshot(data.snapshot);

      /*
       * An empty sync is far more often a bad sync — a key that lost its
       * permissions, a grading period that just rolled — than a clear week.
       * Replacing a working board with it wipes the screen and, worse, writes
       * the emptiness to the cache. Keep what we have and say what happened.
       */
      if (!snap.assignments.length && snapshotRef.current.assignments.length) {
        setSyncError(
          "Sync came back empty, so the last board is still showing. If Schoology " +
            "really is clear this is harmless; otherwise check that your API key " +
            "is still valid in Settings."
        );
        lastSyncAt.current = Date.now();
        return;
      }

      setSnapshot(snap);
      setSyncStats({
        courses: data.snapshot.courses.length,
        items: data.snapshot.assignments.length,
        dated: snap.assignments.filter((a) => a.due !== "No due date").length,
        at: Date.now(),
      });
      setDemoMode(false);
      setConnected(true);
      lastSyncAt.current = Date.now();
      if (!data.snapshot.assignments.length) {
        setSyncError(
          "Schoology answered but listed no assignments. That usually means the key has no sections attached to it yet."
        );
      }
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "Sync failed.");
    } finally {
      syncing.current = false;
      setConnecting(false);
    }
  }, []);

  const resync = useCallback(() => syncNow(true), [syncNow]);
  const connect = useCallback(() => void syncNow(true), [syncNow]);

  /**
   * Keep the board current on its own.
   *
   * On load, and then every few minutes, pull from Schoology. Also refreshes
   * when the tab regains focus, so coming back to Slates shows current work
   * rather than a stale board.
   */
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const pull = async (fresh: boolean) => {
      if (cancelled || document.visibilityState === "hidden") return;
      try {
        const health = await fetch("/api/scrape", { cache: "no-store" }).then((r) => r.json());
        if (!health?.running || cancelled) return;
        await syncNow(fresh);
      } catch {
        /* not connected yet — the Settings card explains how to set the key */
      }
    };

    void pull(false);
    timer = window.setInterval(() => void pull(false), AUTO_SYNC_MS);

    // Refresh on return to the tab, but not more than once a minute.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastSyncAt.current < 60_000) return;
      void pull(false);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [syncNow]);

  const disconnect = useCallback(() => {
    setConnected(false);
    setDemoMode(true);
    setSnapshot(EMPTY_SNAPSHOT);
    setSyncError(null);
    // Drop the saved snapshot too, or a refresh would silently reconnect.
    try {
      window.localStorage.removeItem(PERSIST_KEY);
    } catch {
      /* nothing to clear */
    }
  }, []);


  /* ---- lookups ---- */

  const courseById = useCallback(
    (id: string) => snapshot.courses.find((c) => c.id === id),
    [snapshot.courses]
  );

  const assignmentById = useCallback(
    (id: string) => snapshot.assignments.find((a) => a.id === id),
    [snapshot.assignments]
  );

  const statusOf = useCallback(
    (a: Assignment): Status =>
      a.bucket === "done" ? "done" : (status[a.id] ?? "todo"),
    [status]
  );

  const setStatus = useCallback((id: string, s: Status) => {
    setStatusMap((prev) => ({ ...prev, [id]: s }));
  }, []);

  /**
   * Where a card actually sits: your placement first, then whatever the due
   * date and estimator worked out. Work Schoology already has is the one thing
   * you can't drag around — that column reports a fact, not a plan.
   *
   * A placement holds until you drag the card again or it lands back on the
   * column its due date would have picked anyway (`moveTo` drops the override
   * in that case). It does *not* get compared against the live due-date
   * bucket to decide whether it's still "worth" honoring — `a.bucket` is
   * recomputed fresh on every call, so it's never behind; a guard like that
   * would fire the instant you dragged a card anywhere less urgent than where
   * its due date already had it, undoing the drag before the next render.
   */
  const bucketOf = useCallback(
    (a: Assignment): Bucket => {
      if (a.bucket === "done") return "done";
      return buckets[a.id] ?? a.bucket;
    },
    [buckets]
  );

  const moveTo = useCallback(
    (id: string, to: Bucket) => {
      const a = snapshot.assignments.find((item) => item.id === id);
      // Schoology's word on what's turned in isn't ours to overrule.
      if (!a || a.bucket === "done") return;

      if (to === "done") {
        setStatusMap((prev) => ({ ...prev, [id]: "done" }));
        return;
      }
      // Dragging back out of Turned in un-ticks it, or it would land in a
      // column and immediately filter itself back into Turned in.
      setStatusMap((prev) => (prev[id] === "done" ? { ...prev, [id]: "todo" } : prev));
      setBucketMap((prev) => {
        // Back where it was derived to be: drop the override entirely, so the
        // card resumes following its due date instead of pinning here forever.
        if (to === a.bucket) {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        }
        return prev[id] === to ? prev : { ...prev, [id]: to };
      });
    },
    [snapshot.assignments]
  );

  /* ---- the Sunday sweep ---- */

  /**
   * Clear the week off the board every Sunday at 7pm.
   *
   * Only work that's finished or already past its due date goes. Anything
   * still ahead of you stays exactly where it is — a project set on Thursday
   * and due Monday must not vanish on Sunday evening, which is precisely when
   * you need to see it.
   *
   * Nothing is deleted. Swept work stays in the snapshot and stays reachable
   * through ⌘K and the calendar; it just stops crowding the week ahead.
   */
  const sweep = useCallback(() => {
    const boundary = lastSundayReset();
    if (sweptAt >= boundary) return;

    const stale = snapshot.assignments.filter((a) => {
      const finished = a.bucket === "done" || status[a.id] === "done";
      const pastDue = a.dateOffset !== null && a.dateOffset < 0;
      return finished || pastDue;
    });

    if (stale.length) {
      const at = Date.now();
      setArchived((prev) => {
        const next = { ...prev };
        for (const a of stale) if (!(a.id in next)) next[a.id] = at;
        return next;
      });
    }
    // Recorded even when nothing needed clearing, so a quiet week doesn't
    // leave the app re-checking the same boundary forever.
    setSweptAt(boundary);
  }, [snapshot.assignments, status, sweptAt]);

  /*
   * Checked on a timer rather than scheduled for 7pm exactly: a laptop that
   * was asleep, or an app that wasn't running, would miss a one-shot timer,
   * and `lastSundayReset` already answers "has the boundary passed?" from
   * nothing but the clock.
   */
  useEffect(() => {
    if (!snapshot.assignments.length) return;
    const t = window.setTimeout(sweep, 0);
    const i = window.setInterval(sweep, 60_000);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(i);
    };
  }, [sweep, snapshot.assignments.length]);

  /** Is this card still part of the current week's board? */
  const onBoard = useCallback((a: Assignment) => !(a.id in archived), [archived]);

  /* ---- navigation ---- */

  const setNav = useCallback((label: string, v: View) => {
    setNavLabel(label);
    setView(v);
    setCourseId(null);
    setAssignmentId(null);
  }, []);

  const openCourse = useCallback((id: string | null) => {
    setCourseId(id);
    setAssignmentId(null);
  }, []);

  const openAssignment = useCallback((id: string | null) => {
    setAssignmentId(id);
  }, []);

  /* ---- assignment editing ---- */

  const setText = useCallback((id: string, v: string) => {
    setTextMap((prev) => ({ ...prev, [id]: v }));
  }, []);

  /* ---- work you added yourself ---- */

  const addOwnWork = useCallback((courseId = "") => {
    const work = emptyOwnWork(courseId);
    setOwnWork((prev) => [work, ...prev]);
    return work;
  }, []);

  const saveOwnWork = useCallback((work: OwnWork) => {
    setOwnWork((prev) => (prev.some((w) => w.id === work.id) ? prev.map((w) => (w.id === work.id ? work : w)) : [work, ...prev]));
  }, []);

  const removeOwnWork = useCallback((id: string) => {
    setOwnWork((prev) => prev.filter((w) => w.id !== id));
    // Its marks go with it, or a later id collision would inherit them.
    setStatusMap((prev) => {
      const { [id]: _gone, ...rest } = prev;
      void _gone;
      return rest;
    });
    setBucketMap((prev) => {
      const { [id]: _gone, ...rest } = prev;
      void _gone;
      return rest;
    });
  }, []);

  const addFiles = useCallback((id: string, list: FileList | null) => {
    const arr = Array.from(list ?? []);
    if (!arr.length) return;
    const stamped = arr.map((f, i) => ({
      id: `f${Date.now()}-${i}-${f.name}`,
      name: f.name,
      size: f.size,
    }));
    setFiles((prev) => ({ ...prev, [id]: [...(prev[id] ?? []), ...stamped] }));
  }, []);

  const removeFile = useCallback((id: string, fileId: string) => {
    setFiles((prev) => {
      const list = prev[id] ?? [];
      const idx = list.findIndex((f) => f.id === fileId);
      if (idx < 0) return prev;
      return { ...prev, [id]: list.filter((f) => f.id !== fileId) };
    });
  }, []);

  const mark = useCallback((id: string, s: SubmitState) => {
    setSubmitState((prev) => ({ ...prev, [id]: s }));
  }, []);

  /**
   * Drafts, submissions and comments are tracked locally for now.
   *
   * Writing back to Schoology needs endpoints its API does not give a student
   * key. So these record intent in Slates and say so, rather than pretending
   * the work was turned in.
   */

  /**
   * Handing work in, which Slates cannot do.
   *
   * Schoology's REST API exposes whether an assignment has a dropbox but gives
   * a student-scoped key no way to write to one — there is no endpoint that
   * creates a submission. Rather than pretend, this says so and points at the
   * page that can: every card carries the real Schoology link.
   */
  const sendToSchoology = useCallback(
    async (id: string) => {
      mark(id, {
        phase: "error",
        message:
          "Slates can't hand work in — Schoology's API has no submission endpoint. Open it in Schoology.",
      });
      return false;
    },
    [mark]
  );

  const saveDraft = useCallback(
    async (id: string) => {
      const ok = await sendToSchoology(id);
      if (!ok) return;
      setDraftSavedAt((p) => ({ ...p, [id]: nowLabel() }));
      if (status[id] !== "done") setStatus(id, "active");
    },
    [sendToSchoology, setStatus, status]
  );

  const turnIn = useCallback(
    async (id: string) => {
      const ok = await sendToSchoology(id);
      // Only claim it's in when Schoology confirmed it.
      if (!ok) return;
      setSubmittedAt((p) => ({ ...p, [id]: nowLabel() }));
      setStatus(id, "done");
    },
    [sendToSchoology, setStatus]
  );

  const unsubmit = useCallback(
    async (id: string) => {
      setSubmittedAt((p) => ({ ...p, [id]: null }));
      setStatus(id, "active");
      mark(id, { phase: "idle" });
    },
    [mark, setStatus]
  );

  /** Quizzes and Drive work open on Schoology itself — that stays true. */
  const openOverlay = useCallback(
    async (id: string) => {
      const a = assignmentById(id);
      if (!a?.url || a.url === "#") {
        mark(id, { phase: "error", message: "No Schoology link for this item yet — re-sync." });
        return;
      }

      const q = a.assessment;
      if (q) {
        /*
         * A LockDown assessment opens — on Schoology's own page, in the real
         * browser, which is where Respondus hands off to the proctored app.
         * It used to dead-end in an error here, which helped nobody: the
         * student still had to go find it themselves.
         *
         * What it deliberately does *not* do is open in Slates' streamed
         * viewer. That viewer exists so ordinary work can be done without
         * leaving the app; a proctored exam is proctored on purpose, and
         * putting it behind a screenshare with an AI tutor a keystroke away
         * would defeat exactly the control the teacher chose.
         */
        if (q.lockdown) {
          mark(id, {
            phase: "idle",
            message: "Opening on Schoology — LockDown Browser takes it from there.",
          });
          window.open(a.url, "_blank", "noopener,noreferrer");
          return;
        }
        if (!q.open) {
          mark(id, {
            phase: "error",
            message: "Schoology isn't accepting attempts for this right now.",
          });
          return;
        }
        if (q.attemptsLeft === 0) {
          mark(id, { phase: "error", message: "No attempts left on this assessment." });
          return;
        }
        // Only timed assessments get a clock, and only from the moment the
        // player is actually opened.
        if (q.timeLimitMin) setAttempts((prev) => ({ ...prev, [id]: Date.now() }));
      }

      window.open(a.url, "_blank", "noopener,noreferrer");
      setStatus(id, "active");
    },
    [assignmentById, mark, setStatus]
  );

  /** Begin the companion countdown, for an attempt opened inside Slates. */
  const startClock = useCallback((id: string) => {
    setAttempts((prev) => (id in prev ? prev : { ...prev, [id]: Date.now() }));
  }, []);

  /** Drop the companion clock — the attempt is finished or was never started. */
  const clearAttempt = useCallback((id: string) => {
    setAttempts((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const setCommentDraft = useCallback((id: string, v: string) => {
    setCommentDraftMap((prev) => ({ ...prev, [id]: v }));
  }, []);

  const addComment = useCallback(
    async (id: string) => {
      const txt = (commentDraft[id] ?? "").trim();
      if (!txt) return;
      const time = nowLabel();
      setLocalComments((prev) => ({
        ...prev,
        [id]: [...(prev[id] ?? []), { from: null, text: txt, time }],
      }));
      setCommentDraftMap((prev) => ({ ...prev, [id]: "" }));
    },
    [commentDraft, demoMode, mark]
  );

  /* ---- grades ---- */

  const addScore = useCallback((s: Omit<CustomScore, "id" | "date">) => {
    setCustomScores((prev) => [
      // One what-if per real assignment: typing a new score onto a row you've
      // already tried replaces it, rather than counting both.
      ...prev.filter((x) => !(s.itemId && x.itemId === s.itemId && x.courseId === s.courseId)),
      { ...s, id: `s${Date.now()}`, date: "Today" },
    ]);
  }, []);

  const removeScore = useCallback((id: string) => {
    setCustomScores((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const projectionFor = useCallback(
    (cid: string) => {
      const cats = snapshot.gradebook[cid] ?? [];
      const mine = customScores.filter((c) => c.courseId === cid);
      const { pct } = gradeFor(cats, mine);
      // No points anywhere in the course means no projection — not an F.
      return { pct, letter: pct === null ? "" : letterFor(pct) };
    },
    [customScores, snapshot.gradebook]
  );

  /* ---- messages ---- */

  const openMessage = useCallback((id: string | null) => {
    setMsgOpen(id);
    if (id) setMsgRead((prev) => ({ ...prev, [id]: true }));
  }, []);

  const setReplyDraft = useCallback((id: string, v: string) => {
    setReplyDrafts((prev) => ({ ...prev, [id]: v }));
  }, []);

  /**
   * Replying, which Slates cannot do.
   *
   * Schoology's API reads a student's inbox but will not send on their behalf:
   * addressing a message needs recipient ids from the user directory, and a
   * student-scoped key may not search it.
   */
  const sendReply = useCallback(async (id: string) => {
    setReplyState((prev) => ({
      ...prev,
      [id]: {
        phase: "error",
        message:
          "Slates can't send messages — Schoology's API won't do it with a student key. Reply in Schoology.",
      },
    }));
  }, []);

  const openCompose = useCallback((open: boolean) => {
    setComposing(open);
    // Leaving compose clears the outcome banner, never the draft — a failed
    // send should still have your words in it when you come back.
    if (!open) setComposeState({ phase: "idle" });
  }, []);

  const addRecipient = useCallback((person: Recipient) => {
    setComposeTo((prev) => (prev.some((p) => p.uid === person.uid) ? prev : [...prev, person]));
  }, []);

  const removeRecipient = useCallback((uid: string) => {
    setComposeTo((prev) => prev.filter((p) => p.uid !== uid));
  }, []);

  const findRecipients = useCallback(async (): Promise<Recipient[]> => {
    // The directory search this needs is administrator-scoped.
    throw new Error("Schoology won't share its user directory with a student API key.");
  }, []);

  /** Composing, blocked for the same reason replying is. */
  const sendNewMessage = useCallback(async () => {
    setComposeState({
      phase: "error",
      message:
        "Slates can't send messages — Schoology's API won't do it with a student key. Write it in Schoology.",
    });
  }, []);

  const toggleTimer = useCallback(
    async (id: string) => {
      const stopping = activeTimer === id;
      setActiveTimer(stopping ? null : id);
      if (!stopping) setStatus(id, "active");
    },
    [activeTimer, setStatus]
  );

  // Local tick so the running timer advances even in demo mode.
  useEffect(() => {
    if (!activeTimer) return;
    const t = window.setInterval(() => {
      setTimeTotals((prev) => ({
        ...prev,
        [activeTimer]: (prev[activeTimer] ?? 0) + 1000,
      }));
    }, 1000);
    return () => window.clearInterval(t);
  }, [activeTimer]);

  /**
   * The board, as everything downstream sees it: what Schoology synced plus
   * what you added. Derived rather than stored, so a resync can replace the
   * snapshot without ever touching your own entries, and every view — board,
   * list, calendar, tutor context, counselor workload — gets both with no
   * special case of its own.
   */
  const board = useMemo<SyncSnapshot>(
    () => (ownWork.length ? { ...snapshot, assignments: withOwnWork(snapshot.assignments, ownWork) } : snapshot),
    [snapshot, ownWork]
  );

  const value = useMemo<Store>(
    () => ({
      snapshot: board,
      demoMode,
      connected,
      connecting,
      syncError,
      syncStats,
      resync,
      syncNow,
      connect,
      disconnect,
      view,
      nav,
      setNav,
      setView,
      courseId,
      openCourse,
      assignmentId,
      openAssignment,
      ownWork,
      addOwnWork,
      saveOwnWork,
      removeOwnWork,
      statusOf,
      setStatus,
      bucketOf,
      moveTo,
      onBoard,
      archived,
      courseById,
      assignmentById,
      text,
      setText,
      files,
      addFiles,
      removeFile,
      submittedAt,
      draftSavedAt,
      submitState,
      saveDraft,
      turnIn,
      unsubmit,
      openOverlay,
      attempts,
      startClock,
      clearAttempt,
      localComments,
      commentDraft,
      setCommentDraft,
      addComment,
      customScores,
      addScore,
      removeScore,
      projectionFor,
      msgRead,
      msgOpen,
      openMessage,
      replyDrafts,
      setReplyDraft,
      replyState,
      sendReply,
      composing,
      openCompose,
      composeTo,
      addRecipient,
      removeRecipient,
      composeSubject,
      setComposeSubject,
      composeBody,
      setComposeBody,
      findRecipients,
      composeState,
      sendNewMessage,
      studentName,
      setStudentName,
      avatar,
      setAvatar,
      timeTotals,
      activeTimer,
      toggleTimer,
    }),
    [
      board, demoMode, connected, connecting, syncError, syncStats, resync,
      syncNow,
      connect, disconnect,
      view, nav, setNav, courseId, openCourse, assignmentId,
      openAssignment, statusOf, setStatus, bucketOf, moveTo, onBoard, archived,
      courseById, assignmentById, text,
      setText, files, addFiles, removeFile, submittedAt, draftSavedAt,
      submitState, saveDraft, turnIn, unsubmit, openOverlay, attempts, startClock, clearAttempt, localComments,
      commentDraft, setCommentDraft, addComment, customScores, addScore,
      removeScore, projectionFor, msgRead, msgOpen, openMessage,
      replyDrafts, setReplyDraft, replyState, sendReply,
      composing, openCompose, composeTo, addRecipient, removeRecipient,
      composeSubject, composeBody, findRecipients, composeState, sendNewMessage,
      ownWork, addOwnWork, saveOwnWork, removeOwnWork,
      studentName, setStudentName,
      avatar, setAvatar, timeTotals, activeTimer, toggleTimer,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { IMPACT_LABEL };
