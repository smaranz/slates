import type { ItemAttachment } from "../types";
import type { TestKind } from "./detect";

/** Shared study-set shapes; safe in the browser and on the server. */

export type SourceKind = "writeup" | "handout" | "review" | "material" | "homework" | "web";

/** One thing the study agent did, for the build's live view. */
export interface StudyActivity {
  at: number;
  label: string;
  detail?: string;
}

export interface StudySource {
  /** Citation number used in the guide and on cards, from 1. */
  n: number;
  title: string;
  kind: SourceKind;
  /** Where in Schoology it came from, e.g. "Materials › Unit 2 › Notes". */
  where: string;
  /** Schoology href, relative to the school's domain; null when there is none. */
  url: string | null;
  /** Characters read from it; 0 when it was only listed. */
  chars: number;
  read: boolean;
  /** Why it couldn't be read, when it couldn't. */
  note?: string;
}

export interface StudyCard {
  id: string;
  front: string;
  back: string;
  topic: string;
  source?: number;
}

export interface StudyQuestion {
  id: string;
  /** 1 for the set's own questions, then one more per "more practice" round. */
  round: number;
  type: "mcq" | "short";
  prompt: string;
  choices?: string[];
  answer?: number;
  explanation?: string;
  rubric?: string;
  sample?: string;
  topic: string;
  source?: number;
}

export interface StudyAnswer {
  correct: boolean | null;
  picked?: number;
  text?: string;
  feedback?: string;
  at: number;
}

export interface StudyProgress {
  cards: Record<string, "again" | "good">;
  answers: Record<string, StudyAnswer>;
}

export type StudyStatus = "gathering" | "writing" | "ready" | "failed";

export interface StudySet {
  /** The test's Schoology id. */
  id: string;
  courseId: string;
  course: string;
  title: string;
  kind: TestKind;
  due: string;
  status: StudyStatus;
  /** What the build is doing right now, for the list and the set view. */
  step: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  builtAt?: number;
  model?: string;
  /** Who wrote it: the study agent (browser, web, files) or the plain writer it falls back to. */
  builder?: "agent" | "writer";
  /** The study agent's steps, newest last. */
  activity?: StudyActivity[];
  sources: StudySource[];
  /** Something the student should know about how the set was built, e.g. Materials was unreachable. */
  notice?: string;
  /** Two or three sentences on what the test covers. */
  overview: string;
  /** The study guide, in Markdown, citing sources as [n]. */
  guide: string;
  cards: StudyCard[];
  questions: StudyQuestion[];
  progress: StudyProgress;
  /** A "more practice" round is being written. */
  practicing?: boolean;
  practiceError?: string;
  /** A test the student added by hand rather than one found on the board, and its date as yyyy-mm-dd. */
  custom?: boolean;
  date?: string;
  /** What the student chose for the last build, so a rebuild starts from the same material. */
  inputs?: StudyInputs;
}

/** A Schoology Materials item the student picked for a set. */
export interface StudyPick {
  title: string;
  /** The item's link exactly as Materials lists it. */
  url: string;
  /** Where it sits, e.g. "Materials › Unit 2 › Notes". */
  where?: string;
}

/** A file the student uploaded for a set, as the host keeps it. */
export interface StudyUpload {
  id: string;
  name: string;
  ext: string;
  bytes: number;
  /** Characters of text Slates read from it; 0, with `error`, when it couldn't. */
  chars: number;
  /** Read off the page by a vision model, because it's a scan or a photo. */
  scanned?: boolean;
  at: number;
  error?: string;
}

/** The material a student chose for a build. */
export interface StudyInputs {
  picks: StudyPick[];
  uploads: { id: string; name: string }[];
  notes: string;
  /** Whether Slates also looked through the class for the unit's material. */
  auto: boolean;
}

/** One board item as the builder needs it — sent by the browser, which holds the board. */
export interface StudyItemInput {
  id: string;
  title: string;
  kind?: string;
  brief?: string;
  due?: string;
  dateOffset?: number | null;
  url?: string | null;
  attachments?: ItemAttachment[];
}

export interface BuildRequest {
  target: StudyItemInput & { courseId: string; testKind: TestKind };
  course: { id: string; name: string };
  /** The school's Schoology host, e.g. "fuhsd.schoology.com", for turning Schoology's relative links into real ones. */
  domain?: string;
  /** Other work in the same class, for the unit's homework and review sheets. */
  related: StudyItemInput[];
  /** Schoology Materials items the student picked; read right after the test's own write-up. */
  picks?: StudyPick[];
  /** Files the student uploaded, by the ids /api/study/upload gave them. */
  uploads?: string[];
  /** The student's own notes on what the test covers. */
  notes?: string;
  /** Also look through the class for the unit's material, review sheets and homework. On unless it's false. */
  auto?: boolean;
  /** A test the student added by hand: its id is a custom one (see isStudyId) and this is its date, yyyy-mm-dd. */
  custom?: boolean;
  date?: string;
}

export function mastery(set: Pick<StudySet, "questions" | "cards" | "progress">): number | null {
  const answered = set.questions.filter((q) => set.progress.answers[q.id]?.correct != null);
  const cards = set.cards.filter((c) => set.progress.cards[c.id]);
  const total = answered.length + cards.length;
  if (!total) return null;
  const right = answered.filter((q) => set.progress.answers[q.id]!.correct).length
    + cards.filter((c) => set.progress.cards[c.id] === "good").length;
  return Math.round((right / total) * 100);
}
