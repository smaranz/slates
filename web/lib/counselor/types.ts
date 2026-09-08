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

export interface AiCheck {
  /** 0-100. Advisory only — see lib/counselor/ai-signals.ts on why. */
  score: number;
  verdict: string;
  signals: AiSignal[];
  /** Specific passages that read as generated, quoted with a reason. */
  flagged: { quote: string; why: string }[];
  /** Scores from third-party detectors, when API keys are configured. */
  external: { name: string; score: number }[];
  at: number;
  words: number;
}

export interface Essay {
  id: string;
  title: string;
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
  feedback?: EssayFeedback;
  aiCheck?: AiCheck;
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
  source: "counselor" | "student";
  createdAt: number;
  updatedAt: number;
}

export type DocumentKind =
  | "activity-list"
  | "brag-sheet"
  | "checklist"
  | "college-research"
  | "essay-outline"
  | "essay-brainstorm"
  | "letter-draft"
  | "study-plan"
  | "timeline"
  | "summary"
  | "notes"
  | "other";

export const DOCUMENT_KINDS: DocumentKind[] = [
  "activity-list",
  "brag-sheet",
  "checklist",
  "college-research",
  "essay-outline",
  "essay-brainstorm",
  "letter-draft",
  "study-plan",
  "timeline",
  "summary",
  "notes",
  "other",
];

/** A lasting artifact, in Markdown. The counselor writes these instead of walls of chat. */
export interface CounselorDoc {
  id: string;
  kind: DocumentKind;
  title: string;
  content: string;
  source: "counselor" | "student";
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

export interface DocRef {
  id: string;
  kind: DocumentKind;
  title: string;
  action: "created" | "updated";
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
  documents?: DocRef[];
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
  profile: CounselorProfile;
  memories: Memory[];
  tasks: Task[];
  documents: CounselorDoc[];
  meetings: Meeting[];
  applications: Application[];
  list: ListEntry[];
  /** Every year of the transcript, including the ones Schoology has forgotten. */
  coursework: TranscriptCourse[];
  testing: TestScore[];
  awards: Award[];
  essays: Essay[];
  threads: Thread[];
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
  documents?: CounselorDoc[];
  meetings?: Meeting[];
  applications?: Application[];
  list?: ListEntry[];
  coursework?: TranscriptCourse[];
  testing?: TestScore[];
  awards?: Award[];
  essays?: Essay[];
}

/** One NDJSON frame from /api/counselor/chat. */
export type CounselorEvent =
  | { t: "delta"; v: string }
  | { t: "tool"; label: string }
  | { t: "tool_done"; label: string; ok: boolean }
  | { t: "documents"; v: DocRef[] }
  | { t: "meetings"; v: MeetingRef[] }
  | { t: "sources"; v: Source[] }
  | { t: "ask"; v: AskQuestion[] }
  | { t: "state"; v: StatePatch }
  | { t: "done" }
  | { t: "error"; v: string };
