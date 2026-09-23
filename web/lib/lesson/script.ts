import { openaiModel } from "@/lib/ai-usage/clients";
import { noteFromUsage } from "@/lib/ai-usage/note";
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
 * Limits here are guard rails against nonsense, not a target length.
 *
 * They used to be tight enough to be the thing deciding how long a lesson ran:
 * narration was capped at 420 characters and real scripts came back with two
 * scenes sitting exactly on that number, which is a model being cut off
 * mid-explanation rather than one that had finished. A lesson should be as
 * long as its topic needs.
 *
 * Heading and bullet lengths stay tight for a different reason — they are what
 * the 1920x1080 board actually fits, and past this text either shrinks below
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
    .max(900)
    .describe(
      "What the voice says over this scene, working it out aloud. Say what the " +
        "idea actually needs — a step that takes four sentences gets four."
    ),
  emphasis: z
    .string()
    .max(34)
    .describe(
      "The one run of words in this scene worth leaving with, copied EXACTLY out of the heading " +
        "or one of the bullets so it can be matched and ringed. Two or three words — a ring drawn " +
        "round half a line is a highlighter, not a circle. Empty string when nothing stands out."
    ),
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
  intro: z.string().min(20).max(400).describe("Spoken over the title card. One or two sentences."),
  scenes: z.array(SCENE).min(2).max(12),
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
    "Structure: a title card, then as many scenes as the topic genuinely needs —",
    "often 4 to 6, but take 8 or 10 for something with real ground to cover, and",
    "stop at 3 when that is the whole idea. Length follows the material: don't",
    "pad a simple topic to fill time, and don't compress a hard one to save it.",
    "Each scene teaches exactly one idea and shows its work.",
    "",
    "When a scene starts running long, split it into two rather than writing one",
    "very long one. Each block of writing stays on the board while you talk over",
    "it, so a scene that runs a minute is a minute looking at the same lines.",
    "",
    "The narration is the lesson — it does the explaining. The words on screen",
    "are what you'd write on the board while talking: short, and never a",
    "transcript of the sentence being spoken over them.",
    "",
    "This is a board, not a slide deck. Everything you write is drawn onto one",
    "dark board by hand, a word at a time, as the voice says it — and it stays",
    "there. Nothing is ever wiped, so the lesson reads as one page filling up",
    "rather than a set of slides replacing each other. Two consequences worth",
    "writing for: a line has to be short enough to be written in the time the",
    "sentence over it takes to say, and a later scene can point back at what is",
    "still visible above it instead of restating it.",
    "",
    "Emphasis: on a scene that has a single thing worth leaving with, set",
    "`emphasis` to that run of words copied character for character out of the",
    "heading or one of the bullets — it is matched against them to draw a ring",
    "round it, so an approximation matches nothing. Two or three words, not half",
    "a line. Leave it empty where nothing stands out; a ring on every scene is a",
    "ring on nothing.",
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

  const { object, usage } = await generateObject({
    model: openaiModel("gpt-5.6-sol"),
    schema: SCRIPT,
    system,
    prompt: `Write a teaching video that explains: ${topic}`,
  });
  noteFromUsage("lesson", "gpt-5.6-sol", "openai", usage);

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
      emphasis: scene.emphasis?.trim() || undefined,
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
