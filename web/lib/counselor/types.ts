import type { Attachment } from "../attachments";
import type { MasterPlan, PlanProposal, PlanRevision, PlanTaskCategory } from "./plan-types";

/**
 * The counselor's world.
 *
 * Slates has no database and no accounts, so unlike the app this was ported
 * from, none of this is a row anywhere. The whole counselor state is one plain
 * object that lives in the browser, is handed to the model on each turn, and
 * comes back with the model's edits applied — see `state.ts` and `tools.ts`.
 * Every id is minted locally.
 */

export type GradeLevel = 9 | 10 | 11 | 12 | 13;
export type Rigor = "low" | "medium" | "high" | "very-high";

/**
 * Tier is the counselor's shorthand for how far an activity carries:
 * 1 = national/exceptional, 2 = strong state or school-wide leadership,
 * 3 = solid sustained involvement, 4 = participation.
 */
export interface Activity {
  id: string;
  name: string;
  role?: string;
  tier: 1 | 2 | 3 | 4;
  detail?: string;
}

export interface CounselorProfile {
  name: string;
  gradeLevel: GradeLevel;
  applyYear: number;
  state: string;
  highSchool?: string;
  dreamSchool?: string;
  firstGen: boolean;
  /** 0–4.0. */
  gpaUnweighted: number | null;
  rigor: Rigor;
  sat: number | null;
  act: number | null;
  intendedMajor: string;
  activities: Activity[];
  /** Per year, USD. */
  budgetMax: number | null;
  /** Anything the student wants the counselor to hold onto verbatim. */
  notes?: string;
}

export type CourseLevel = "regular" | "honors" | "AP" | "IB" | "dual-enrollment";

/**
 * One line of the transcript.
 *
 * Distinct from the school side's live gradebook, which only knows the current
 * term. Admissions reads four years, and the years before this one exist
 * nowhere in Schoology's To Do panel — so they are recorded here, by hand or
 * by import, and the counselor reads both.
 */
export interface TranscriptCourse {
  id: string;
  /** 9-12. */
  year: 9 | 10 | 11 | 12;
  course: string;
  level: CourseLevel;
  /** Exactly as the transcript prints it — "A", "B+", "A-". */
  grade?: string;
  /** Which term, when the transcript splits them. */
  term?: string;
}

/** A score, kept per attempt: superscoring and score choice both need the history. */
export interface TestScore {
  id: string;
  /** "SAT", "ACT", "PSAT", "AP Chemistry", "SAT Math". */
  test: string;
  /** YYYY-MM or YYYY-MM-DD. */
  date?: string;
  /** As reported — "1480", "1510 (740 RW / 770 M)", "5". */
  score: string;
}

export type AwardLevel = "school" | "regional" | "state" | "national" | "international";

export interface Award {
  id: string;
  name: string;
  level: AwardLevel;
  year?: number;
}

/* ─────────────────────────── essays ─────────────────────────── */

export type EssayKind =
  | "personal-statement"
  | "supplement"
  | "uc-piq"
  | "scholarship"
  | "additional-info"
  | "other";

/**
 * Kinds that only exist because of an application.
 *
 * Hidden on the school list, where they are noise: a lab report is never a UC
 * PIQ. They stay on the counselor side, which is where admissions lives.
 */
export const COLLEGE_ONLY_KINDS = new Set<EssayKind>([
  "personal-statement",
  "supplement",
  "uc-piq",
  "scholarship",
  "additional-info",
]);

export const ESSAY_KINDS: EssayKind[] = [
  "personal-statement",
  "supplement",
  "uc-piq",
  "scholarship",
  "additional-info",
  "other",
];

/** A saved draft. Kept so a student can see what a revision actually changed. */
export interface EssayVersion {
  id: string;
  content: string;
  words: number;
  savedAt: number;
  note?: string;
}

/** One rubric line, scored with the evidence behind it. */
export interface RubricScore {
  criterion: string;
  score: number;
  max: number;
  /** A quote from the essay that justifies the score. Never a paraphrase. */
  evidence: string;
  /** The single most valuable change for this criterion. */
  fix: string;
}

export interface EssayFeedback {
  scores: RubricScore[];
  /** What is genuinely working, so a revision doesn't destroy it. */
  strengths: string[];
  /** Sentences to cut, quoted exactly. */
  cuts: string[];
  /** The one thing to do next. */
  verdict: string;
  at: number;
  /** Words at the time of review, so stale feedback is visible as stale. */
  words: number;
}

/** One locally computed statistic behind the AI-likelihood estimate. */
export interface AiSignal {
  label: string;
  /** 0-1, where 1 reads as most machine-like. */
  score: number;
  /** The measurement in plain language, e.g. "sentence lengths vary by ±3.2 words". */
  detail: string;
}

/** Where one sentence of the draft lands. Green, amber, red. */
export type LineVerdict = "strong" | "okay" | "weak";

/** One sentence of the draft, judged on its own. */
export interface LineNote {
  /** The sentence, copied exactly from the draft — that's what makes it findable again. */
  text: string;
  verdict: LineVerdict;
  /** Why it lands there: the praise, the quick tip, or the problem. */
  note: string;
  /** Numbered steps to fix it. Present on the ones that need work. */
  steps: string[];
}

/**
 * The line-by-line read of a draft — every sentence categorized, plus the
 * whole-essay numbers that come out of doing that.
 *
 * Separate from `EssayFeedback` on purpose. That one scores four or five
 * rubric criteria and tells you the single next thing to do; this one is the
 * pass where nothing in the draft goes unjudged, so a student revising knows
 * which specific sentences are carrying the essay and which are padding.
 */
export interface LineReview {
  /** 0-100, against college-level writing. */
  score: number;
  impression: string;
  categories: { name: string; score: number; max: number }[];
  strengths: { title: string; detail: string }[];
  improvements: { title: string; detail: string }[];
  lines: LineNote[];
  at: number;
  /** Words at the time of the read, so a stale review shows as stale. */
  words: number;
  /**
   * Set when the sentence-by-sentence read could not be produced, so the rest
   * of the report can still be shown rather than the whole request failing.
   * Mirrors how a missing local detector is reported.
   */
  unavailable?: string;
}

/**
 * One sentence re-checked on its own, after the student retyped it.
 *
 * The example is deliberately about something else. A model that hands back a
 * fixed version of the student's own sentence has written part of their essay;
 * one that shows the same technique applied to an unrelated subject has taught
 * them to do it themselves, and there's nothing to paste in.
 */
export interface SentenceCheck {
  verdict: LineVerdict;
  summary: string;
  steps: string[];
  example?: string;
}

/**
 * The AI read of a draft: a local model's verdict, plus the statistics that
 * say what about the prose reads that way.
 *
 * Both halves are advisory. No detector can prove who wrote something, and
 * they misfire most often on careful, formal writing — which a college essay
 * is by definition.
 */
export interface AiDetection {
  /** MELD, run locally. Absent when the detector isn't installed or didn't start. */
  meld?: {
    /** The raw score. Compared against `threshold`, not read as a percentage. */
    score: number;
    /** The score below which 99% of human validation texts fell — a 1% false-positive rate. */
    threshold: number;
    flagged: boolean;
    /** The sigmoid of the score. Shown only as a secondary number: it sits near 0.5 for ordinary human prose. */
    probability: number;
    tokensRead: number;
    /** True when the draft was longer than the 2,048 tokens the model reads. */
    truncated: boolean;
    /** Sentences scoring above the document's own flagging line, worst first. */
    passages: { text: string; score: number }[];
    /**
     * Every sentence with its score and where the line for *this* draft sat,
     * so the AI page can mark each one rather than only naming the worst few.
     * `over` is the same test `passages` uses — clearing the document
     * threshold is not enough on its own.
     */
    lines?: { text: string; score: number; over: boolean }[];
    /** The bar a sentence had to clear to be called out, for the same draft. */
    sentenceCut?: number;
  };
  /** Why MELD is missing, when it is. The statistics still stand. */
  unavailable?: string;
  signals: AiSignal[];
  /** 0-100 from the local statistics alone. */
  localScore: number;
  verdict: string;
}

/**
 * One pass over the draft, and everything it produced.
 *
 * Deliberately a single object behind a single button. The three passes used
 * to be three tabs a student ran separately, which meant the usual outcome was
 * one of them run and the other two forgotten — and a rubric score means
 * something different once you know a paragraph reads as machine-written.
 * They are written together, read together, and downloadable as one document.
 */
export interface EssayReport {
  at: number;
  /** Words at the time of the run, so a stale report shows as stale. */
  words: number;
  rubric: EssayFeedback;
  lines: LineReview;
  detection: AiDetection;
}

/**
 * Which half of Slates an essay belongs to.
 *
 * The two are different jobs. A college essay is one of a set with a deadline
 * attached, written for a specific application, and it matters how it scores;
 * a school essay is coursework, tied to an assignment on the board. They were
 * one undifferentiated list for a while, which meant a personal statement and
 * a history paper sat next to each other with the same affordances and neither
 * got the ones it needed.
 */
export type EssayScope = "college" | "school";

/**
 * What an essay is judged on.
 *
 * Declared here rather than imported from `rubric.ts` — that module imports
 * `EssayKind` from this one, and a rubric stored on an essay would close the
 * cycle. `rubric.ts` re-exports this as its own `Rubric`.
 */
export interface Rubric {
  label: string;
  criteria: { name: string; detail: string }[];
  /** A closing instruction about what this kind of essay must not do. */
  note: string;
}

/**
 * A finished voice call, kept so it can be read back.
 *
 * The transcript used to live in React state for exactly as long as the call
 * did: hanging up, or even navigating to another view mid-conversation, took
 * the whole thing with it. A student who talked through their college list for
 * twenty minutes had nothing afterwards but whatever the counselor happened to
 * save as a memory — and no way to check what it actually said.
 */
export interface CallRecord {
  id: string;
  startedAt: number;
  endedAt: number;
  /** Connected seconds, so the list can say how long it ran. */
  seconds: number;
  turns: { role: "user" | "assistant"; text: string }[];
  /** Memories the counselor saved during the call. */
  saved: number;
}

export interface Essay {
  id: string;
  title: string;
  /** Absent on essays written before the two halves were split — see essayScope(). */
  scope?: EssayScope;
  kind: EssayKind;
  /** The prompt as the application prints it. */
  prompt: string;
  /** The hard limit. Null when the application doesn't state one. */
  wordLimit: number | null;
  collegeName?: string;
  content: string;
  versions: EssayVersion[];
  /** A Schoology assignment this is being written for, when it's coursework. */
  assignmentId?: string;
  assignmentTitle?: string;
  report?: EssayReport;
  /**
   * A rubric read off the teacher's own handout, which replaces the built-in
   * one for this essay. Stored on the essay rather than globally: two history
   * papers in the same term are graded on different sheets.
   */
  customRubric?: Rubric;
  /** What it was read from, so the panel can say where it came from. */
  customRubricSource?: string;
  createdAt: number;
  updatedAt: number;
}

export type MemoryKind =
  | "fact"
  | "preference"
  | "goal"
  | "concern"
  | "context"
  | "relationship"
  | "milestone"
  | "other";

/** Something durable the counselor learned, carried into every later session. */
export interface Memory {
  id: string;
  kind: MemoryKind;
  content: string;
  /** 1 (minor) to 5 (defining). Sorts what survives the prompt budget. */
  importance: number;
  source: "counselor" | "student";
  updatedAt: number;
}

export type TaskStatus = "open" | "done" | "dismissed";

export interface Task {
  id: string;
  title: string;
  detail?: string;
  /** YYYY-MM-DD, or absent when the step has no natural deadline. */
  dueDate?: string;
  status: TaskStatus;
  source: "counselor" | "student" | "plan";
  category?: PlanTaskCategory;
  planItemId?: string;
  createdAt: number;
  updatedAt: number;
}

export type MeetingMode = "chat" | "voice";
export type MeetingStatus = "scheduled" | "completed" | "cancelled";

export interface Meeting {
  id: string;
  /** ISO instant. */
  scheduledFor: string;
  topic: string;
  agenda?: string;
  mode: MeetingMode;
  status: MeetingStatus;
  createdAt: number;
}

export type ApplicationRound = "ED" | "ED2" | "EA" | "REA" | "RD" | "Rolling";
export type ApplicationStatus = "planning" | "in_progress" | "submitted";
export type Decision = "pending" | "accepted" | "waitlisted" | "deferred" | "rejected";
export type RequirementStatus = "todo" | "in_progress" | "done" | "na";

export const APPLICATION_ITEMS = [
  "transcript",
  "recommendations",
  "test_scores",
  "personal_essay",
  "supplements",
  "activities",
  "fafsa",
  "css_profile",
  "portfolio",
  "interview",
] as const;
export type ApplicationItem = (typeof APPLICATION_ITEMS)[number];

export const APPLICATION_ITEM_LABEL: Record<ApplicationItem, string> = {
  transcript: "Transcript",
  recommendations: "Recommendations",
  test_scores: "Test scores",
  personal_essay: "Personal essay",
  supplements: "Supplements",
  activities: "Activities list",
  fafsa: "FAFSA",
  css_profile: "CSS Profile",
  portfolio: "Portfolio",
  interview: "Interview",
};

export interface Recommender {
  name: string;
  role?: string;
  status: "requested" | "received";
}

export interface Application {
  id: string;
  /** The seeded college this tracks, when it is one of them. */
  collegeId: string | null;
  collegeName: string;
  round: ApplicationRound;
  /** YYYY-MM-DD. */
  deadline: string | null;
  status: ApplicationStatus;
  decision: Decision;
  items: Partial<Record<ApplicationItem, RequirementStatus>>;
  recommenders: Recommender[];
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

/** A school on the student's list, with the round they mean to apply in. */
export interface ListEntry {
  collegeId: string;
  round: "ED" | "EA" | "RD";
  addedAt: number;
}

export interface College {
  id: string;
  name: string;
  city: string;
  state: string;
  type: "public" | "private";
  /** 0–1. */
  acceptanceRate: number;
  sat25: number;
  sat75: number;
  gpaAvg: number;
  /** Multiplier on odds for an early application, e.g. 1.6. */
  edBoost: number;
  size: "small" | "medium" | "large";
  setting: "urban" | "suburban" | "rural";
  /** Sticker price per year, USD. */
  costPerYear: number;
  topMajors: string[];
}

export type ChanceBand = "safety" | "match" | "reach" | "hard-reach";

export interface ChanceFactor {
  label: string;
  status: "strong" | "neutral" | "weak";
  detail: string;
}

export interface ChanceResult {
  collegeId: string;
  band: ChanceBand;
  /** Percentages, as a range — the model is not precise enough for one number. */
  low: number;
  high: number;
  factors: ChanceFactor[];
  summary: string;
}

/* ─────────────────────────── conversation ─────────────────────────── */

/** One line in the counselor's live "working on it" panel. */
export interface ActivityStep {
  id?: string;
  name?: string;
  label: string;
  state: "run" | "ok" | "fail";
  /** Filled in when the step resolves, so the badge shows real elapsed time. */
  secs?: number;
}

/**
 * Where a claim came from.
 *
 * Shown under the reply as chips. The distinction that matters is `library`
 * versus `web`: the first is this practice's own written guidance, the second
 * is a page on the internet, and a student deciding how much to trust an
 * answer should be able to see which they got.
 */
export interface Source {
  title: string;
  origin: "library" | "web";
  url?: string;
}

/** One question in the counselor's structured ask. */
export interface AskQuestion {
  question: string;
  /** Empty for a free-text answer. */
  options: string[];
  multi: boolean;
}

export interface MeetingRef {
  id: string;
  topic: string;
  scheduledFor: string;
  mode: MeetingMode;
  action: "scheduled" | "rescheduled" | "cancelled";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: number;
  /** "activity" replaces the text bubble with the live work panel. */
  kind?: "activity";
  steps?: ActivityStep[];
  /** Set when an activity panel's work has finished, so it can collapse. */
  done?: boolean;
  reasoning?: string;
  attachments?: Attachment[];
  meetings?: MeetingRef[];
  sources?: Source[];
  /** Set when this turn ended by asking the student a structured question set. */
  ask?: AskQuestion[];
}

export interface Thread {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

/** Everything the counselor knows, in one object. */
export interface CounselorState {
  schemaVersion: 2;
  profile: CounselorProfile;
  memories: Memory[];
  tasks: Task[];
  meetings: Meeting[];
  applications: Application[];
  list: ListEntry[];
  /** Every year of the transcript, including the ones Schoology has forgotten. */
  coursework: TranscriptCourse[];
  testing: TestScore[];
  awards: Award[];
  essays: Essay[];
  /** Finished voice calls, newest first. */
  calls: CallRecord[];
  threads: Thread[];
  masterPlan: MasterPlan | null;
  planProposals: PlanProposal[];
  planRevisions: PlanRevision[];
}

/* ─────────────────────────── wire protocol ─────────────────────────── */

/**
 * What the model changed, as a patch the browser applies to its own copy.
 *
 * The server never stores anything: it runs the tool loop against the state it
 * was handed and streams back the collections it touched. The browser is the
 * only place the counselor's memory actually lives.
 */
export interface StatePatch {
  profile?: CounselorProfile;
  memories?: Memory[];
  tasks?: Task[];
  meetings?: Meeting[];
  applications?: Application[];
  list?: ListEntry[];
  coursework?: TranscriptCourse[];
  testing?: TestScore[];
  awards?: Award[];
  essays?: Essay[];
  masterPlan?: MasterPlan | null;
  planProposals?: PlanProposal[];
  planRevisions?: PlanRevision[];
}

/** One NDJSON frame from /api/counselor/chat. */
export type CounselorEvent =
  | { t: "delta"; v: string }
  | { t: "reasoning"; v: string }
  | { t: "tool"; id: string; name: string; label: string }
  | { t: "tool_done"; id: string; name: string; label: string; ok: boolean }
  | { t: "meetings"; v: MeetingRef[] }
  | { t: "sources"; v: Source[] }
  | { t: "ask"; v: AskQuestion[] }
  | { t: "state"; v: StatePatch }
  | { t: "done" }
  | { t: "error"; v: string };
