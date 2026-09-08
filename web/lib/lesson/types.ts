/**
 * A narrated teaching video, from the topic a student asked about to the MP4
 * that comes out the other end.
 *
 * The shape is deliberately small. A lesson opens with its title written at
 * the top of a board and then works down it a scene at a time: each one a
 * heading, a few short lines jotted underneath, and the sentence or two spoken
 * over them as they are written. That is enough to explain a homework concept
 * and little enough that a language model reliably fills it in.
 */

/**
 * A graph a scene is built around, plotted by Desmos rather than drawn.
 *
 * Anything with an axis goes through here instead of the image model: a
 * generated picture of a parabola is an illustration *of* a parabola, with
 * whatever errors the model felt like, while Desmos plots the real function.
 */
export interface LessonGraph {
  /** Desmos LaTeX, e.g. "y=x^2" or "y=\\sin(x)". One entry per curve. */
  expressions: { latex: string; color?: string }[];
  /** The window to frame it in. */
  bounds: { left: number; right: number; bottom: number; top: number };
}

export interface LessonScene {
  /** The one idea this scene is about. Shown large. */
  heading: string;
  /** Short supporting lines. Never the narration verbatim — that's spoken. */
  bullets: string[];
  /**
   * A short run of text, copied out of this scene's heading or one of its
   * bullets, that gets a hand-drawn ring round it.
   *
   * This is the board's only piece of emphasis, and it exists because it is
   * what a teacher actually does: they write the working out, and then they go
   * back and circle the one part you are meant to leave with. It lands late in
   * the scene, on the beat where the narration says why it matters. Absent
   * when nothing in the scene deserves it — a ring on every scene is a ring on
   * nothing.
   */
  emphasis?: string;
  /** What the voice says over this scene. Drives the scene's length. */
  narration: string;
  /**
   * Set only when a picture genuinely helps — a diagram, an apparatus, a
   * scene from a text. Empty on every scene when images are turned off, and
   * never set for anything graphable: that's what `graph` is for.
   */
  imagePrompt?: string;
  /** Plotted with Desmos. Takes precedence over `imagePrompt` if both appear. */
  graph?: LessonGraph;
}

export interface LessonScript {
  title: string;
  subtitle: string;
  /** Spoken over the title card, before the first scene. */
  intro: string;
  scenes: LessonScene[];
}

/**
 * Where a lesson is in the pipeline. Each one is a real, separately-failable
 * step, and the student is shown which is running — a video takes minutes,
 * and "working…" for three of them reads as broken.
 */
export type LessonStage =
  | "script"
  | "narration"
  | "images"
  | "composing"
  | "rendering"
  | "done"
  | "error"
  /** Stopped by the student. Distinct from "error" — nothing went wrong. */
  | "cancelled";

export interface LessonStatus {
  id: string;
  topic: string;
  stage: LessonStage;
  /** One line for the UI, e.g. "Recording narration (3/6)". */
  note: string;
  /** Known once the script is written. */
  title?: string;
  /**
   * How many scenes the lesson has, once the script exists. The waiting
   * animation draws one frame per scene and fills them as the narration is
   * recorded, so it has to be the real number rather than a guess.
   */
  scenes?: number;
  /** Seconds of finished video, known once it renders. */
  durationSec?: number;
  /** Set only on the error stage. Safe to show — never carries a key. */
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

/** What the tutor's `make_video` tag asks for. */
export interface LessonRequest {
  topic: string;
  /** The student's board, so the lesson can reference their actual work. */
  context?: string;
  /** Opt-in: generating pictures costs money and minutes, so it's off by default. */
  images?: boolean;
}
