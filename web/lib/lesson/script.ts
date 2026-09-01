import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";

import type { LessonRequest, LessonScript } from "./types";

/**
 * Turning a topic into a lesson worth watching.
 *
 * Structured output rather than "write me some JSON": the composition emitter
 * indexes straight into these fields, and a model that decides to wrap its
 * answer in prose would take the whole render down. `generateObject` makes the
 * shape the model's problem instead of the parser's.
 */

/** One curve on a Desmos graph. */
const EXPRESSION = z.object({
  latex: z.string().min(1).max(120).describe('Desmos LaTeX, e.g. "y=x^2" or "y=\\sin(x)".'),
});

const GRAPH = z.object({
  expressions: z.array(EXPRESSION).min(1).max(4),
  bounds: z
    .object({ left: z.number(), right: z.number(), bottom: z.number(), top: z.number() })
    .describe("The window to frame the curve in. Pick one where the interesting behaviour is obvious."),
});

/**
 * Limits here are real production constraints, not style preferences.
 * Narration length sets scene length, and a scene whose voice runs 40 seconds
 * is a still image for 40 seconds. Bullet counts and heading lengths are what
 * the 1920x1080 layout actually fits — past this, text either shrinks below
 * readable or spills off the frame.
 */
const SCENE = z.object({
  heading: z.string().min(3).max(60).describe("The one idea, 3-7 words. No trailing period."),
  bullets: z
    .array(z.string().min(3).max(90))
    .min(1)
    .max(3)
    .describe("1-3 short lines that land as the voice says them. Fragments. Never repeat the narration."),
  narration: z
    .string()
    .min(20)
    .max(420)
    .describe("What the voice says over this scene: 2-4 spoken sentences, working it out aloud."),
  imagePrompt: z
    .string()
    .max(240)
    .describe(
      "A picture that would genuinely help — an apparatus, a physical setup, a scene from a text. " +
        "Empty string when words are enough, and ALWAYS empty for anything with axes: use graph instead."
    ),
  graph: GRAPH.nullable().describe(
    "A Desmos plot, for any scene about a function, curve, rate, or shape. Null otherwise."
  ),
});

const SCRIPT = z.object({
  title: z.string().min(3).max(60),
  subtitle: z.string().min(3).max(90),
  intro: z.string().min(20).max(300).describe("Spoken over the title card. One or two sentences."),
  scenes: z.array(SCENE).min(2).max(7),
});

/** Roughly how long a scene's narration takes to say, for the length guidance below. */
const WORDS_PER_MINUTE = 150;

export async function writeLessonScript({ topic, context, images }: LessonRequest): Promise<LessonScript> {
  const system = [
    "You write short teaching videos in the style of Khan Academy.",
    "",
    "That style, concretely:",
    "- You are a patient person talking through a problem out loud, not a",
    "  narrator reading a summary. Think on the page: 'so what happens if we",
    "  double this?', 'notice that the bottom is now bigger than the top'.",
    "- Start from something concrete — an actual number, an actual function, an",
    "  actual situation — and only generalise once it has been seen working.",
    "- Build in one direction. Every scene depends on the one before it, and",
    "  nothing appears that hasn't been earned yet.",
    "- Say the why, not just the what. A rule with no reason behind it is the",
    "  thing students forget.",
    "- Warm and plain. No lecturing, no 'as we can see', no throat-clearing.",
    "",
    "Structure: a title card, then 3-5 scenes. Each scene teaches exactly one",
    "idea and shows its work.",
    "",
    "The narration is the lesson — it does the explaining. The words on screen",
    "are what you'd write on the board while talking: short, and never a",
    "transcript of the sentence being spoken over them.",
    "",
    "Narration is read aloud by a speech model, so write for the ear: no",
    "markdown, no bullet characters, no LaTeX, no parentheses full of symbols.",
    "Say 'a sub n plus one over a sub n', not 'a_(n+1)/a_n'. Spell out symbols",
    "and short formulas as words.",
    "",
    "Graphs: any scene about a function, a curve, a rate of change, or a shape",
    "gets a Desmos graph — set `graph` with the real expressions and a window",
    "that makes the behaviour obvious. This is a plot of the actual function,",
    "so it is always better than a picture of one. Set graph to null on scenes",
    "that aren't about something graphable.",
    "",
    "Teach the concept so they can do the work themselves. Never just give the",
    "answer to an assignment.",
    images
      ? "For scenes that need a *physical* picture — an apparatus, a setup, a scene from a text — write imagePrompt as a short description of a clean, simple illustration on a dark background. Never use it for graphs or plots."
      : "Leave imagePrompt as an empty string on every scene. Graphs are unaffected — keep using `graph` where a plot belongs.",
    "",
    context ? `The student's board, for reference — use their real courses and assignments where it fits:\n${context}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const { object } = await generateObject({
    model: openai("gpt-5.6-sol"),
    schema: SCRIPT,
    system,
    prompt: `Write a teaching video that explains: ${topic}`,
  });

  // The model is asked for an empty string rather than an omitted field —
  // optional keys are the thing structured output is least reliable about —
  // so normalise it back to "absent" here.
  return {
    ...object,
    scenes: object.scenes.map((scene) => ({
      ...scene,
      // A graph always wins: the scene has a real plot, so a drawing of one
      // would be a second, worse version of the same thing.
      graph: scene.graph ?? undefined,
      imagePrompt:
        !scene.graph && images && scene.imagePrompt?.trim() ? scene.imagePrompt.trim() : undefined,
    })),
  };
}

/** A rough spoken length, used only to warn before a long render starts. */
export function estimateSpokenSeconds(script: LessonScript): number {
  const words = [script.intro, ...script.scenes.map((s) => s.narration)]
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.round((words / WORDS_PER_MINUTE) * 60);
}
