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
  /** Attempts already handed in, oldest first. Empty until one is. */
  attempts?: AssessmentAttempt[];
}

/** One attempt at an assessment, as Schoology's own attempt table lists it. */
export interface AssessmentAttempt {
  /** Attempt number, counting from the first. */
  n: number;
  /** Schoology's submission id — the handle a per-question review needs. */
  submissionId: string;
  completed: boolean;
  /** Whole minutes Schoology clocked on the attempt. */
  minutes: number;
  /** Schoology's own "last modified" stamp, e.g. "Aug 20, 2026 7:06 pm". */
  modified: string;
  /** False when the teacher hasn't released results. */
  reviewable: boolean;
}

/**
 * How one question in an attempt was marked.
 *
 * There is no question text: Schoology serves the questions themselves from
 * Learnosity, which hands them out only to its own player against a signed
 * session. Only the marks travel.
 */
export interface QuestionResult {
  n: number;
  earned: number;
  possible: number;
  /**
   * "pending" is a question only a teacher can mark and hasn't yet — distinct
   * from "missed", which is a real zero. "dropped" is one the teacher voided
   * for the whole class, so it counts against nobody.
   */
  state: "correct" | "partial" | "missed" | "pending" | "dropped";
  /** Marked by hand, so a zero may only mean "not read yet". */
  byHand: boolean;
  /*
   * The rest is read out of Schoology's rendered review rather than its API, so
   * it is absent whenever that view couldn't be reached — the marks above stand
   * on their own without it.
   */
  /**
   * What the question asked. On a quiz built as an answer sheet for a paper
   * worksheet this is as bare as "Q1", because that is all the teacher typed.
   */
  stem?: string;
  /** "Multiple choice", "Written", … — empty for a kind Slates doesn't name. */
  kind?: string;
  /** The choices offered, with the one that was submitted flagged. */
  options?: { label: string; chosen: boolean }[];
  /** A typed answer, for questions that weren't a set of choices. */
  written?: string;
}

/** One attempt's marks, or why they couldn't be shown. */
export interface AttemptReview extends AssessmentAttempt {
  questions: QuestionResult[];
  /** Points over the questions that counted, so dropped ones don't skew it. */
  earned?: number;
  possible?: number;
  questionsTotal?: number;
  error?: string;
}

export interface AssessmentReview {
  /** False when the item isn't a Schoology-hosted assessment at all. */
  online: boolean;
  title: string;
  pointsPossible?: number | null;
  timeLimitMin?: number | null;
  attempts: AttemptReview[];
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

/**
 * Something the teacher stapled to an item — a handout, or the link that *is*
 * the assignment. Plenty of work carries no write-up at all and only this.
 */
export interface ItemAttachment {
  /**
   *  - "file": an upload. Its bytes come through the scraper's session.
   *  - "link": an outside site — a Quizlet set, a Desmos activity.
   *  - "page": something else Schoology hosts and owns.
   */
  kind: "file" | "link" | "page";
  title: string;
  /** Href exactly as Schoology wrote it; relative for its own pages. */
  url: string;
  /** Where a link really goes, unwrapped from Schoology's /link redirect. */
  target?: string;
  /** The name an upload was filed under, when it differs from the title. */
  filename?: string;
  /** Schoology's own size label for an upload, e.g. "18 KB". */
  size?: string;
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
  /** The teacher's write-up as plain text. Empty when they wrote nothing. */
  brief: string;
  /**
   * The same write-up with its structure intact — paragraphs, lists, links —
   * stripped of Schoology's styling by the scraper. Empty when there is no
   * write-up, or when it was too large to be worth carrying as markup.
   */
  briefHtml?: string;
  /** Handouts and links posted alongside it. */
  attachments?: ItemAttachment[];
  /** When the teacher posted it, worded as Schoology words it. */
  postedAt?: string;
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

/** Someone you can write to, exactly as Schoology's directory returned them. */
export interface Recipient {
  /** Schoology's own user id. Never invented locally — only ever echoed back. */
  uid: string;
  name: string;
  school: string;
  photo: string;
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
