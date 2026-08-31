/**
 * Where a percentage came from.
 *  - "reported": Schoology printed this exact number.
 *  - "points"  : Slates added up the points Schoology published.
 *  - "none"    : there is no percentage. Nothing is invented to fill the gap.
 */
export type GradeSource = "reported" | "points" | "none";

export type Tone =
  | "secondary"
  | "outline"
  | "warning"
  | "success"
  | "danger"
  | "speed"
  | "premium";

/**
 * How an item can be turned in.
 *  - "native"  : plain file / text dropbox. Slates submits it through the proxy.
 *  - "overlay" : quiz, assessment, or Drive-linked work. The real Schoology page
 *                owns the attempt; Slates renders its chrome on top of it.
 *  - "none"    : nothing to hand in anywhere — paper, in-class, or a reminder.
 *                Schoology shows no dropbox for it, so ticking it off in Slates
 *                is the only thing left to do.
 */
export type SubmitMode = "native" | "overlay" | "none";
export type SubmissionType = "text" | "file";

export type ItemKind =
  | "assignment"
  | "quiz"
  | "assessment"
  | "discussion"
  | "drive";

export type Impact = "high" | "medium" | "low";
export type Status = "todo" | "active" | "done";
export type Bucket = "tonight" | "soon" | "week" | "done";

export interface Course {
  /** Schoology section id */
  id: string;
  name: string;
  short: string;
  period: string;
  /** Headline: a percentage, or the letter when that is all Schoology grades in. */
  grade: string;
  pct: number;
  /** Whether Schoology printed the percentage or Slates added up its points. */
  gradeSource?: GradeSource;
  letter: string;
  trend: string;
  tone: Tone;
  dot: string;
  url: string;
}

export interface GradeItem {
  /** Schoology assignment id, so a row links back to the item itself. */
  id?: string;
  name: string;
  score: string;
  /** null when the teacher has not scored it yet. */
  earned?: number | null;
  possible?: number | null;
  /** Set when the item is marked in letters rather than points. */
  letter?: string;
  date: string;
  url?: string;
}

export interface GradeCategory {
  cat: string;
  /** Contribution to the course grade, as Schoology weights it. */
  weight: number;
  /**
   * Schoology's own percentage for the category, or null when nothing in it has
   * been graded. Kept separate from points: a category can be graded with no
   * item showing points, and treating "nothing scored" as 0/0 rendered as 0%.
   */
  pct?: number | null;
  /** Letter grade, for categories Schoology marks in letters with no points. */
  letter?: string;
  /** Points summed over scored items only; both 0 when nothing is scored. */
  earned: number;
  possible: number;
  items: GradeItem[];
}

export interface CustomScore {
  id: string;
  courseId: string;
  cat: string;
  weight: number;
  name: string;
  earned: number;
  possible: number;
  date: string;
}

/**
 * Schoology's own assessment configuration, read from the player's embedded
 * config rather than the rendered page — none of this is visible until an
 * attempt has already been started.
 */
export interface AssessmentInfo {
  /** Minutes allowed per attempt; null when the assessment is untimed. */
  timeLimitMin: number | null;
  /** Points across the questions, which can differ from the gradebook total. */
  questionPoints: number | null;
  opensAt: number | null;
  closesAt: number | null;
  /** Whether Schoology is currently accepting attempts. */
  open: boolean;
  /** Requires Respondus LockDown Browser — cannot run in a normal browser. */
  lockdown: boolean;
  passwordRequired: boolean;
  overdue: boolean;
  attemptsLeft: number | null;
  /** Schoology's own launch state, e.g. DELIVERY_SOME_ATTEMPTS_LEFT. */
  scenario: string;
  resumable: boolean;
}

export interface AssignmentGrade {
  earned: number;
  possible: number;
  feedback: string;
}

export interface Comment {
  from: string | null;
  text: string;
  time: string;
}

export interface Assignment {
  /** Schoology numeric id — the stable primary key across renames + reschedules */
  id: string;
  courseId: string;
  kind: ItemKind;
  submit: SubmitMode;
  /** Verified controls found in this assignment's real Schoology submit form. */
  submissionTypes?: SubmissionType[];
  title: string;
  brief: string;
  due: string;
  /** days from today; negative = past */
  dateOffset: number | null;
  code: string;
  minutes: number;
  impact: Impact;
  impactNote?: string;
  bucket: Bucket;
  start?: string;
  url: string;
  grade?: AssignmentGrade | null;
  comments?: Comment[];
  /** quiz + assessment only */
  assessment?: AssessmentInfo | null;
  timeLimitMin?: number | null;
  attemptsUsed?: number;
  attemptsAllowed?: number | null;
  resumable?: boolean;
  /** Schoology's own submission timestamp, when one was exposed. */
  submittedAt?: string | null;
}

export interface Message {
  id: string;
  from: string;
  courseId: string;
  subject: string;
  body: string;
  time: string;
  unread: boolean;
}

export interface HistoryPoint {
  d: string;
  v: number;
}

/** One tracked stretch of work on an assignment. */
export interface WorkSession {
  id: string;
  assignmentId: string;
  startedAt: number;
  endedAt: number | null;
  source: "auto" | "manual";
}

export interface LocalFile {
  id: string;
  name: string;
  size: number;
}

export interface SyncSnapshot {
  domain: string;
  courses: Course[];
  assignments: Assignment[];
  gradebook: Record<string, GradeCategory[]>;
  /** Course percentage exactly as Schoology reports it, keyed by course id. */
  courseGrades: Record<string, { pct: number; letter: string }>;
  history: Record<string, HistoryPoint[]>;
  messages: Message[];
  syncedAt: number;
}
