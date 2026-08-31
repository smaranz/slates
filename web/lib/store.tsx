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

import { estimateAssignments } from "./estimate";
import { normalizeSnapshot } from "./normalize";
import { EMPTY_SNAPSHOT, IMPACT_LABEL } from "./demo";
import { gradeFor, letterFor } from "./grades";
import { nowLabel } from "./format";
import type {
  Assignment,
  Comment,
  Course,
  CustomScore,
  LocalFile,
  Status,
  SyncSnapshot,
} from "./types";

export type View =
  | "board"
  | "list"
  | "grades"
  | "calendar"
  | "tutor"
  | "messages"
  | "settings";

/** How often the portal pulls from the local scraper. */
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
/** Name and photo live here so they survive a refresh, demo mode, and disconnect. */
const PROFILE_KEY = "slates.profile.v1";

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
}

interface Profile {
  studentName: string;
  avatar: string | null;
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
};

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

function loadProfile(): Profile {
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Profile>;
      return {
        studentName: typeof p.studentName === "string" ? p.studentName : "",
        avatar:
          typeof p.avatar === "string" && p.avatar.startsWith("data:image/") ? p.avatar : null,
      };
    }
  } catch {
    /* ignore a bad profile blob */
  }

  // Names saved before the profile split lived on the snapshot key.
  try {
    const raw = window.localStorage.getItem(PERSIST_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Persisted>;
      if (typeof p.studentName === "string" && p.studentName) {
        return { studentName: p.studentName, avatar: null };
      }
    }
  } catch {
    /* ignore */
  }

  return { studentName: "", avatar: null };
}

interface SubmitEvent {
  type: "step" | "result" | "error";
  step?: string;
  label?: string;
  error?: string;
  result?: SubmitResult;
}

interface SubmitResult {
  verified?: boolean;
  message?: string;
  error?: string;
}

/**
 * Read the submission response, which is a stream of stages ending in the
 * result — the scraper is driving a real browser and each stage is reported as
 * it happens.
 *
 * A plain JSON body is still accepted, because an error raised before the
 * submission starts (offline scraper, rejected URL) never becomes a stream.
 */
async function readSubmitStream(
  res: Response,
  onEvent: (e: SubmitEvent) => void
): Promise<SubmitResult> {
  const type = res.headers.get("content-type") ?? "";
  if (!res.body || !type.includes("text/event-stream")) {
    return (await res.json().catch(() => ({}))) as SubmitResult;
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let result: SubmitResult = {};

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;

    // SSE frames are separated by a blank line; a partial one waits for more.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("");
      if (!data) continue;
      let event: SubmitEvent;
      try {
        event = JSON.parse(data) as SubmitEvent;
      } catch {
        continue; // a frame we can't read is not a reason to lose the submission
      }
      if (event.type === "result" && event.result) result = event.result;
      else if (event.type === "error") result = { error: event.error };
      onEvent(event);
    }
  }
  return result;
}

export interface SubmitState {
  phase: "idle" | "submitting" | "verifying" | "done" | "error";
  message?: string;
  /** What the scraper is doing right now, straight from the browser it drives. */
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

  /** Local dedicated-browser scraper — full data, needs scraper/ running. */
  syncScraper: (fresh?: boolean) => Promise<void>;
  connect: () => void;
  disconnect: () => void;

  view: View;
  nav: string;
  setNav: (label: string, view: View) => void;
  setView: (v: View) => void;

  query: string;
  setQuery: (q: string) => void;

  courseId: string | null;
  openCourse: (id: string | null) => void;

  assignmentId: string | null;
  openAssignment: (id: string | null) => void;

  statusOf: (a: Assignment) => Status;
  setStatus: (id: string, s: Status) => void;

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
  openMessage: (id: string) => void;

  /* settings — name and photo persist on their own, not with the snapshot */
  studentName: string;
  setStudentName: (v: string) => void;
  avatar: string | null;
  setAvatar: (dataUrl: string | null) => void;
  notifPush: boolean;
  togglePush: () => void;
  notifDigest: boolean;
  toggleDigest: () => void;

  /* time tracking */
  timeTotals: Record<string, number>;
  activeTimer: string | null;
  toggleTimer: (id: string) => Promise<void>;
}

const Ctx = createContext<Store | null>(null);

function keepCurrent<T>(record: Record<string, T>, ids: Set<string>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([id]) => ids.has(id)));
}

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
  const [query, setQuery] = useState("");
  const [courseId, setCourseId] = useState<string | null>(null);
  const [assignmentId, setAssignmentId] = useState<string | null>(null);

  const [status, setStatusMap] = useState<Record<string, Status>>({});
  const [text, setTextMap] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, LocalFile[]>>({});
  const [rawFiles, setRawFiles] = useState<Record<string, File[]>>({});
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
  const [msgRead, setMsgRead] = useState<Record<string, boolean>>({});
  const [msgOpen, setMsgOpen] = useState<string | null>(null);

  const [studentName, setStudentName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [notifPush, setNotifPush] = useState(true);
  const [notifDigest, setNotifDigest] = useState(true);

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
  const profileReady = useRef(false);
  const cacheReady = useRef(false);
  const marksReady = useRef(false);

  // Restore the last synced state before any network call, so a refresh shows
  // your real board immediately instead of sample data.
  useEffect(() => {
    const profile = loadProfile();
    setStudentName(profile.studentName);
    setAvatar(profile.avatar);

    // Marks load on their own terms — a rejected snapshot must never take your
    // ticked-off work down with it.
    const marks = loadMarks();
    setStatusMap(marks.status);
    setTimeTotals(marks.timeTotals);
    setCustomScores(marks.customScores);
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

  // Profile is written on every change, including demo mode and an empty board.
  // Skip the first pass after hydrate so the empty initial state can't wipe a
  // saved name or photo before those values have been applied.
  useEffect(() => {
    if (!hydrated.current) return;
    if (!profileReady.current) {
      profileReady.current = true;
      return;
    }
    try {
      window.localStorage.setItem(PROFILE_KEY, JSON.stringify({ studentName, avatar }));
    } catch {
      /* quota or private mode — persistence is a nicety, not required */
    }
  }, [studentName, avatar]);

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
    const t = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          MARKS_KEY,
          JSON.stringify({ status, timeTotals, customScores, submittedAt, attempts })
        );
      } catch {
        /* quota or private mode — persistence is a nicety, not required */
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [status, timeTotals, customScores, submittedAt, attempts]);

  // Cache the snapshot after hydration, so the initial demo state can't
  // overwrite a good saved board on first paint.
  useEffect(() => {
    if (!hydrated.current || demoMode) return;
    if (!cacheReady.current) {
      cacheReady.current = true;
      return;
    }
    const t = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          PERSIST_KEY,
          JSON.stringify({ snapshot, syncStats, studentName })
        );
      } catch {
        /* quota or private mode — persistence is a nicety, not required */
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [snapshot, syncStats, studentName, demoMode]);

  /* ---- connection ---- */

  /**
   * Sync via the local scraper: a dedicated Chrome profile that stays logged in
   * to Schoology and reads the fully rendered pages.
   *
   * Guarded against overlap — the automatic poll and a manual Sync can land
   * together, and two concurrent scrapes would queue behind one browser.
   */
  const syncScraper = useCallback(async (fresh = true) => {
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
       * An empty scrape is far more often a bad scrape — an expired Schoology
       * session, a To Do panel that never filled — than a genuinely clear week.
       * Replacing a working board with it wipes the screen and, worse, writes
       * the emptiness to the cache. Keep what we have and say what happened.
       */
      if (!snap.assignments.length && snapshotRef.current.assignments.length) {
        setSyncError(
          "Sync came back empty, so the last board is still showing. If Schoology " +
            "really is clear this is harmless; otherwise the scraper's session may " +
            "have expired — run `npm run login` in scraper/."
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
          "Scraper ran but found no assignments. Run `npm run once -- --show` in scraper/ to watch what it sees."
        );
      }
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "Sync failed.");
    } finally {
      syncing.current = false;
      setConnecting(false);
    }
  }, []);

  // Sync has one implementation now — the local scraper.
  const resync = useCallback(() => syncScraper(true), [syncScraper]);
  const connect = useCallback(() => void syncScraper(true), [syncScraper]);

  /**
   * Keep the board current on its own.
   *
   * On load, and then every few minutes, pull from the scraper — which is also
   * refreshing in the background, so these calls usually hit a warm cache and
   * return immediately. Also refreshes when the tab regains focus, so coming
   * back to Slates shows current work rather than a stale board.
   */
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const pull = async (fresh: boolean) => {
      if (cancelled || document.visibilityState === "hidden") return;
      try {
        const health = await fetch("/api/scrape", { cache: "no-store" }).then((r) => r.json());
        if (!health?.running || cancelled) return;
        await syncScraper(fresh);
      } catch {
        /* scraper not up yet — the Settings card explains how to start it */
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
  }, [syncScraper]);

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

  const addFiles = useCallback((id: string, list: FileList | null) => {
    const arr = Array.from(list ?? []);
    if (!arr.length) return;
    const stamped = arr.map((f, i) => ({
      id: `f${Date.now()}-${i}-${f.name}`,
      name: f.name,
      size: f.size,
    }));
    setFiles((prev) => ({ ...prev, [id]: [...(prev[id] ?? []), ...stamped] }));
    setRawFiles((prev) => ({ ...prev, [id]: [...(prev[id] ?? []), ...arr] }));
  }, []);

  const removeFile = useCallback((id: string, fileId: string) => {
    setFiles((prev) => {
      const list = prev[id] ?? [];
      const idx = list.findIndex((f) => f.id === fileId);
      if (idx < 0) return prev;
      setRawFiles((raw) => ({
        ...raw,
        [id]: (raw[id] ?? []).filter((_, i) => i !== idx),
      }));
      return { ...prev, [id]: list.filter((f) => f.id !== fileId) };
    });
  }, []);

  const mark = useCallback((id: string, s: SubmitState) => {
    setSubmitState((prev) => ({ ...prev, [id]: s }));
  }, []);

  /**
   * Drafts, submissions and comments are tracked locally for now.
   *
   * Writing back to Schoology needs an authenticated session; that used to run
   * through the browser extension, which is gone. The scraper owns a logged-in
   * browser and is the natural place to add it — until then these record intent
   * in Slates and say so, rather than pretending the work was turned in.
   */
  /** Base64 so files survive the JSON hop to the scraper. */
  const encode = (file: File) =>
    new Promise<{ name: string; data: string }>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () =>
        resolve({ name: file.name, data: String(r.result).split(",")[1] ?? "" });
      r.onerror = () => reject(new Error(`Couldn't read ${file.name}`));
      r.readAsDataURL(file);
    });

  /**
   * Hand work to Schoology through the scraper, which drives the real dropbox
   * in the signed-in browser.
   *
   * `verified` matters: the scraper re-reads the page afterwards and only says
   * a submission landed if Schoology shows it. Anything less is reported as
   * uncertain rather than as success — a submission that silently didn't
   * happen is the most expensive way for this to fail.
   */
  const sendToSchoology = useCallback(
    async (id: string, draft: boolean) => {
      const a = assignmentById(id);
      if (!a?.url || a.url === "#") {
        mark(id, { phase: "error", message: "No Schoology link for this yet — re-sync." });
        return false;
      }

      const body = (text[id] ?? "").trim();
      const picked = rawFiles[id] ?? [];
      if (!body && !picked.length) {
        mark(id, { phase: "error", message: "Add a response or a file first." });
        return false;
      }

      const startedAt = Date.now();
      mark(id, { phase: "submitting", step: "Reading your work", startedAt });
      try {
        const files = await Promise.all(picked.map(encode));
        const res = await fetch("/api/submit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: a.url, text: body, files, draft }),
        });

        const out = await readSubmitStream(res, (event) => {
          if (event.type !== "step") return;
          mark(id, {
            // "verify" is the scraper re-reading the page, which is the part
            // worth naming — it's what decides whether this counts as done.
            phase: event.step === "verify" ? "verifying" : "submitting",
            step: event.label,
            startedAt,
          });
        });
        if (!res.ok) throw new Error(out.error ?? "Submission failed");
        if (out.error) throw new Error(out.error);

        if (out.verified) {
          mark(id, { phase: "done", message: out.message });
        } else {
          mark(id, {
            phase: "error",
            // A stream that ended without a verdict is uncertain, not a failure
            // — say that rather than implying nothing was sent.
            message:
              out.message ??
              "Slates lost contact before Schoology confirmed this. Open the assignment to check.",
          });
        }
        // Pull the truth back from Schoology rather than trusting our own guess.
        void syncScraper(true);
        return Boolean(out.verified);
      } catch (e) {
        mark(id, {
          phase: "error",
          message: e instanceof Error ? e.message : "Submission failed",
        });
        return false;
      }
    },
    [assignmentById, mark, rawFiles, syncScraper, text]
  );

  const saveDraft = useCallback(
    async (id: string) => {
      const ok = await sendToSchoology(id, true);
      if (!ok) return;
      setDraftSavedAt((p) => ({ ...p, [id]: nowLabel() }));
      if (status[id] !== "done") setStatus(id, "active");
    },
    [sendToSchoology, setStatus, status]
  );

  const turnIn = useCallback(
    async (id: string) => {
      const ok = await sendToSchoology(id, false);
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
        // Refusing to open a closed or LockDown assessment isn't Slates' call —
        // but starting the companion clock for one would be misleading, since
        // no attempt can actually begin.
        if (q.lockdown) {
          mark(id, {
            phase: "error",
            message:
              "This assessment requires Respondus LockDown Browser. It can't run in Slates or a normal browser — open it from LockDown Browser.",
          });
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
      ...prev,
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

  const openMessage = useCallback((id: string) => {
    setMsgOpen(id);
    setMsgRead((prev) => ({ ...prev, [id]: true }));
  }, []);

  /* ---- timers ---- */

  /**
   * Time tracking is local. Automatic tracking (accruing while an assignment
   * page is focused) needed the extension; this is the manual start/stop, which
   * the interval below advances.
   */
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

  const value = useMemo<Store>(
    () => ({
      snapshot,
      demoMode,
      connected,
      connecting,
      syncError,
      syncStats,
      resync,
      syncScraper,
      connect,
      disconnect,
      view,
      nav,
      setNav,
      setView,
      query,
      setQuery,
      courseId,
      openCourse,
      assignmentId,
      openAssignment,
      statusOf,
      setStatus,
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
      studentName,
      setStudentName,
      avatar,
      setAvatar,
      notifPush,
      togglePush: () => setNotifPush((v) => !v),
      notifDigest,
      toggleDigest: () => setNotifDigest((v) => !v),
      timeTotals,
      activeTimer,
      toggleTimer,
    }),
    [
      snapshot, demoMode, connected, connecting, syncError, syncStats, resync,
      syncScraper,
      connect, disconnect,
      view, nav, setNav, query, courseId, openCourse, assignmentId,
      openAssignment, statusOf, setStatus, courseById, assignmentById, text,
      setText, files, addFiles, removeFile, submittedAt, draftSavedAt,
      submitState, saveDraft, turnIn, unsubmit, openOverlay, attempts, startClock, clearAttempt, localComments,
      commentDraft, setCommentDraft, addComment, customScores, addScore,
      removeScore, projectionFor, msgRead, msgOpen, openMessage, studentName,
      avatar, notifPush, notifDigest, timeTotals, activeTimer, toggleTimer,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { IMPACT_LABEL };
