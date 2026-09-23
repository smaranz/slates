import { z } from "zod";

import { countWords } from "./ai-signals";
import { essayObject } from "./essay-model";
import type { LineReview, SentenceCheck } from "./types";

/**
 * The line-by-line essay read, ported from EssayLens.
 *
 * One pass over the draft that has to place every sentence in one of three
 * buckets — carrying the essay, doing its job, or padding — and say what to do
 * about the ones that aren't working. Whole-essay numbers fall out of that
 * pass rather than being asked for separately, so the score and the sentences
 * behind it can't disagree.
 *
 * Runs on whatever lib/counselor/essay-model.ts pins, like every other essay
 * pass, so the score and the sentences behind it always come from one model.
 */

const LINE = z.object({
  index: z
    .number()
    .int()
    .describe("The number printed beside the sentence in the draft. Judge every numbered sentence exactly once."),
  verdict: z
    .enum(["strong", "okay", "weak"])
    .describe("strong: excellent as written. okay: does its job, could be sharper. weak: vague, flat, or padding."),
  note: z
    .string()
    .describe("One or two sentences: why it lands there. For strong, what makes it work. For weak, what's wrong."),
  steps: z
    .array(z.string())
    .describe("Ordered steps to improve it. Empty for a strong sentence; two to five for a weak one."),
});

const REVIEW = z.object({
  score: z.number().int().min(0).max(100).describe("Against college-level writing. Score rigorously."),
  impression: z.string().describe("Two or three sentences on where this draft actually stands and what it could be."),
  categories: z
    .array(
      z.object({
        name: z.string().describe("Use exactly the four names given in the instructions, in that order."),
        score: z.number().int().min(0).max(25),
      })
    )
    .min(4)
    .max(4),
  strengths: z
    .array(z.object({ title: z.string(), detail: z.string() }))
    .min(2)
    .max(4)
    .describe("What is genuinely working, specifically enough that a revision won't destroy it."),
  improvements: z
    .array(z.object({ title: z.string(), detail: z.string() }))
    .min(2)
    .max(4)
    .describe("What to change and why. Name the thing; 'add more detail' is not one of these."),
  lines: z.array(LINE).min(1).describe("Every sentence of the body, in the order it appears in the draft."),
});

/**
 * The draft, cut into sentences.
 *
 * Deliberately plain: a split on sentence-ending punctuation followed by
 * whitespace, with the common abbreviations that would otherwise cut a
 * sentence in half held back. It only has to agree with itself — the numbers
 * go out and come back, and the text the student sees is spliced from this
 * same array, so a slightly odd break is a slightly odd highlight rather than
 * a mismatch.
 */
const ABBREVIATIONS =
  /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|Fig|No|Vol|approx|pg|pp?|ch|sec|ed|trans|cf|al)\.$/i;

/**
 * True while a citation is still open.
 *
 * "(Hurst Pg. 5)." is one sentence with two full stops in it, and splitting on
 * the first left "5)." stranded as an entry of its own. A period inside an
 * unclosed bracket never ends a sentence.
 */
function insideBracket(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
  }
  return depth > 0;
}

export function splitSentences(text: string): string[] {
  const out: string[] = [];

  /*
   * A line that carries no sentence-ending punctuation and is short is a
   * heading, a name, a course, a date — the top of an MLA paper. Left out of
   * the numbering entirely; joined to the following text it would arrive glued
   * to the first real sentence and be judged as though the student wrote it
   * that way.
   */
  const isHeaderish = (line: string) => line.length < 60 && !/[.!?]["'\u201d\u2019)\]]*$/.test(line);

  const flush = (paragraph: string) => {
    const trimmed = paragraph.replace(/\s+/g, " ").trim();
    if (!trimmed) return;

    let buffer = "";
    for (const piece of trimmed.split(/(?<=[.!?]["'\u201d\u2019)\]]*)\s+/)) {
      buffer = buffer ? `${buffer} ${piece}` : piece;
      // An abbreviation's full stop is not the end of anything, and neither is
      // one inside a half-open citation.
      if (ABBREVIATIONS.test(buffer) || insideBracket(buffer)) continue;
      out.push(buffer);
      buffer = "";
    }
    if (buffer.trim()) out.push(buffer.trim());
  };

  let paragraph = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();

    if (!line) {
      flush(paragraph);
      paragraph = "";
      continue;
    }

    if (isHeaderish(line)) {
      /*
       * Dropped, not numbered. These are the student's name, the course, the
       * date, the title — the original instruction was to skip them, and a
       * numbered list has no way to express "judge this one but not that one".
       * A real sentence ends in punctuation, so this only ever catches the
       * header block.
       */
      flush(paragraph);
      paragraph = "";
      continue;
    }

    paragraph = paragraph ? `${paragraph} ${line}` : line;
  }
  flush(paragraph);

  return out.filter((sentence) => sentence.length > 1);
}

const SENTENCE = z.object({
  verdict: z.enum(["strong", "okay", "weak"]),
  summary: z.string().describe("One short line: the problem, or what makes it work."),
  steps: z.array(z.string()).describe("One or two steps for a strong sentence, up to five for a weak one."),
  example: z
    .string()
    .describe(
      "One improved sentence demonstrating the same technique on a COMPLETELY DIFFERENT subject than the student's — if theirs is about music, write about a kitchen or a bus route. It teaches the move without handing them a line they can paste in."
    ),
});

/** The four things the read scores, out of 25 each. */
const CATEGORIES = ["Thesis & Argument", "Evidence & Examples", "Structure & Flow", "Style & Clarity"];

const RULES = [
  "You are an experienced college essay coach reading a student's draft sentence by sentence. You are honest, specific, and on their side.",
  "",
  "HOW TO READ IT:",
  "- The draft is printed with a number beside every sentence. Judge each one and give its number back; never retype the sentence itself.",
  "- Return them in order, one entry per number, every number exactly once.",
  "- Be willing to call a sentence weak. A student who keeps a padded paragraph because you were kind is worse off than one you told plainly.",
  "- Do not praise reflexively. If a sentence is filler, say so and say what it was trying to do.",
  "",
  "THE LINE YOU DO NOT CROSS:",
  "You do not write or rewrite their sentences. Say what is wrong and what a stronger version would do; never hand them replacement prose for their own narrative. An essay in your words is not theirs, and admissions officers are reading for them.",
  "",
  `SCORE THESE FOUR, out of 25 each, with exactly these names in this order: ${CATEGORIES.join(", ")}.`,
].join("\n");

export interface LineReviewContext {
  /** The prompt as the application prints it, when there is one. */
  prompt?: string;
  /** The label for this kind of essay, e.g. "Personal statement". */
  kind?: string;
  wordLimit?: number | null;
}

export async function lineReview(content: string, ctx: LineReviewContext = {}): Promise<LineReview> {
  const words = countWords(content);
  const over = ctx.wordLimit != null && words > ctx.wordLimit;

  const system = [
    RULES,
    ctx.kind ? `\nWHAT THIS IS: ${ctx.kind}.` : "",
    ctx.prompt ? `\nTHE PROMPT THEY ARE ANSWERING:\n${ctx.prompt}` : "",
    ctx.wordLimit
      ? `\nWord limit: ${ctx.wordLimit}. This draft is ${words}.${over ? " It is OVER — the sentences that should go are the ones to mark weak." : ""}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  /*
   * Numbered, so the model answers with an index instead of a copy.
   *
   * It used to be asked to quote each sentence back verbatim, which the app
   * then string-matched to highlight. That made every report a full
   * reproduction of the draft — and OpenAI's filter stopped generation
   * part-way through an essay about "The Scarlet Ibis" (`finishReason:
   * "content-filter"`), which took the whole report down with it. A student's
   * literary analysis is not going to stop being about the thing it is about.
   *
   * Numbering is better on its own terms too: the highlight is exact by
   * construction rather than by matching, the output is a fraction of the
   * size, and a paraphrase can no longer lose a sentence.
   */
  const sentences = splitSentences(content);
  if (sentences.length === 0) {
    throw new Error("There are no full sentences in this draft yet.");
  }

  const numbered = sentences.map((sentence, i) => `${i + 1}. ${sentence}`).join("\n");

  const output = await essayObject(
    REVIEW,
    system,
    `Read this draft sentence by sentence. Answer with each sentence's number.\n\n---\n${numbered}\n---`
  );

  return {
    score: output.score,
    impression: output.impression,
    // The names come back from the model; the denominator is ours, not its.
    categories: output.categories.map((c) => ({ name: c.name, score: c.score, max: 25 })),
    strengths: output.strengths,
    improvements: output.improvements,
    /*
     * The text is put back from our own array, so what the student sees is the
     * sentence as they wrote it rather than as a model retyped it. An index
     * outside the draft is dropped instead of trusted.
     */
    lines: output.lines
      .filter((line) => line.index >= 1 && line.index <= sentences.length)
      .map((line) => ({
        text: sentences[line.index - 1],
        verdict: line.verdict,
        note: line.note,
        steps: line.steps,
      })),
    at: Date.now(),
    words,
  };
}

/**
 * One sentence, re-read after the student retyped it.
 *
 * They have to type it themselves — that is the point of the round trip. What
 * comes back is a verdict, steps, and the technique shown on someone else's
 * subject.
 */
export async function sentenceCheck(sentence: string, grade?: string): Promise<SentenceCheck> {
  const system = [
    "You are an experienced college essay coach evaluating a single sentence a student has just rewritten.",
    "",
    "Say where it lands and what would make it better. Do not rewrite their sentence for them.",
    "The example you give must be about a different subject than theirs — same technique, different world — so they learn the move instead of pasting your line into their essay.",
    grade ? `\nThe student is in ${grade}. Pitch the guidance there.` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return essayObject(SENTENCE, system, `The sentence:\n\n${sentence}`);
}
