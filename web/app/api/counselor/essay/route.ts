import { z } from "zod";

import { aiSignals } from "@/lib/counselor/ai-signals";
import { countWords } from "@/lib/counselor/ai-signals";
import { detect } from "@/lib/counselor/detector";
import { hasSecret } from "@/lib/ai-usage/clients";
import { essayObject } from "@/lib/counselor/essay-model";
import { lineReview, sentenceCheck } from "@/lib/counselor/line-review";
import { ESSAY_KIND_LABEL, RUBRICS } from "@/lib/counselor/rubric";
import type { EssayFeedback, EssayKind, EssayReport, Rubric } from "@/lib/counselor/types";

/**
 * One pass over a draft, behind one button.
 *
 * Three things a student needs about an essay, produced together because they
 * are read together: a rubric review that has to quote the line it is scoring,
 * a sentence-by-sentence read where nothing goes unjudged, and an honest
 * measure of how machine-written the prose sounds. They used to be three
 * separate actions behind three tabs, which meant the usual outcome was one of
 * them run and the other two forgotten — and a 17/25 means something different
 * once you know a paragraph reads as generated.
 *
 * The two model passes run on GPT-5.6 Terra (lib/counselor/essay-model.ts).
 * Detection is a local model, MELD, and makes no network call at all
 * (lib/counselor/detector.ts) — an unpublished personal statement is not
 * something to post to a detector website, and the check keeps working when
 * the writing passes can't.
 */

/*
 * The three passes run in parallel, so the ceiling is the slowest of them:
 * ~45s for the rubric review and ~40s for the line read on a full-length
 * draft, with detection ~1s beside them. The headroom is for a 650-word essay
 * on a cold Claude Code session.
 */
export const maxDuration = 300;

/** A rubric line. The evidence quote is required, which is the point. */
const SCORE = z.object({
  criterion: z.string(),
  score: z.number().int().min(0).max(5),
  evidence: z
    .string()
    .describe("A short quote from the essay, copied exactly, that justifies this score. Never a paraphrase."),
  fix: z.string().describe("The single most valuable change for this criterion. Concrete, not 'add more detail'."),
});

const FEEDBACK = z.object({
  scores: z.array(SCORE).min(3).max(8),
  strengths: z
    .array(z.string())
    .min(1)
    .max(4)
    .describe("What is genuinely working, quoted or named specifically, so a revision doesn't destroy it."),
  cuts: z
    .array(z.string())
    .max(6)
    .describe("Sentences to cut, quoted exactly from the essay. Empty when nothing should go."),
  verdict: z
    .string()
    .max(400)
    .describe("The one thing to do next, in two or three sentences. Lead with the instruction."),
});

interface Body {
  action: "report" | "sentence";
  content: string;
  /** Only for "sentence": the one line the student just retyped. */
  sentence?: string;
  /** Only for "sentence": their grade, so the guidance is pitched right. */
  grade?: string;
  kind?: EssayKind;
  prompt?: string;
  wordLimit?: number | null;
  /** So the review can tell whether the essay is actually about this student. */
  studentContext?: string;
  /** A rubric read off the teacher's handout, replacing the built-in one. */
  rubric?: Rubric;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }

  // One sentence is its own request — it has no draft to word-count.
  if (body.action === "sentence") {
    const sentence = body.sentence?.trim();
    if (!sentence) return Response.json({ error: "Nothing to check." }, { status: 400 });
    try {
      return Response.json(await sentenceCheck(sentence, body.grade));
    } catch (err) {
      return Response.json({ error: message(err) }, { status: 502 });
    }
  }

  if (!hasSecret("openai")) {
    return Response.json(
      { error: "No OpenAI key. Link one in AI Usage, or add OPENAI_API_KEY to .env and restart." },
      { status: 500 }
    );
  }

  const content = body?.content?.trim();
  if (!content) return Response.json({ error: "Nothing to read." }, { status: 400 });
  if (countWords(content) < 40) {
    return Response.json({ error: "That's too short to review — write a real draft first." }, { status: 400 });
  }

  try {
    return Response.json(await report(content, body));
  } catch (err) {
    return Response.json({ error: message(err) }, { status: 502 });
  }
}

/** The provider's own message is the useful one — quota, schema, or network. */
function message(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

async function report(content: string, body: Body): Promise<EssayReport> {
  const words = countWords(content);

  /*
   * Detection is allowed to fail on its own — a missing local model shouldn't
   * cost the student their feedback — so it degrades inside `detect()` rather
   * than rejecting. The two model passes are the report; if one of them fails
   * the request fails, because a half-written report read as a whole one is
   * worse than an error.
   */
  const [rubric, lines, detection] = await Promise.all([
    review(content, body),
    lineReview(content, {
      prompt: body.prompt,
      kind: ESSAY_KIND_LABEL[body.kind ?? "other"],
      wordLimit: body.wordLimit,
    }).catch((err) => {
      /*
       * One pass failing no longer costs the student the other two.
       *
       * The rule used to be that a half report is worse than an error, which
       * is right when the missing half is invisible — but a filtered
       * line-by-line read took the rubric and the detection down with it and
       * returned nothing at all. Named as unavailable it is not a half report
       * pretending to be whole; it is three sections with one marked absent
       * and the reason on it.
       */
      console.error("[essay] line review failed:", err instanceof Error ? err.message : err);
      return {
        score: 0,
        impression: "",
        categories: [],
        strengths: [],
        improvements: [],
        lines: [],
        at: Date.now(),
        words,
        unavailable:
          "The sentence-by-sentence read didn't come back this time. The rubric and the detection above are unaffected — try the check again for the line notes.",
      };
    }),
    detect(content).catch(() => {
      const { signals, score } = aiSignals(content);
      return { signals, localScore: score, verdict: "", unavailable: "The local detector didn't answer." };
    }),
  ]);

  return { at: Date.now(), words, rubric, lines, detection };
}

async function review(content: string, body: Body): Promise<EssayFeedback> {
  /*
   * The teacher's own sheet wins when there is one. A school essay graded
   * against a built-in rubric is being scored on criteria nobody is actually
   * marking it against.
   */
  const rubric = body.rubric ?? RUBRICS[body.kind ?? "other"] ?? RUBRICS.other;
  const words = countWords(content);
  const over = body.wordLimit && words > body.wordLimit;

  const system = [
    "You are an experienced college counselor reading a student's draft. You are honest, specific, and on their side.",
    "",
    "HOW TO SCORE:",
    "Score each criterion 0-5 and quote the line from the essay that justifies the number. The quote is",
    "mandatory and must be copied exactly — if you cannot find a line to point at, the score is too high.",
    "",
    "HOW TO WRITE THE FIXES:",
    "- Name the sentence and say what to do with it. 'Cut the first paragraph and open on the hospital",
    "  waiting room' is a fix. 'Add more vivid detail' is not.",
    "- Be direct about what is not working. A student who submits a weak essay because you were kind is",
    "  worse off than one you told plainly.",
    "- Do not praise reflexively. If a paragraph is filler, say so.",
    "",
    "THE LINE YOU DO NOT CROSS:",
    "You do not write or rewrite their sentences. You may quote a line back and say what is wrong with it,",
    "you may describe what a stronger version would do, but you must not hand them replacement prose for",
    "their personal narrative. If they ask, say why: an essay in your words is not theirs, and admissions",
    "officers are reading for them.",
    "",
    `THE RUBRIC — score exactly these, using these names:`,
    ...rubric.criteria.map((c) => `- ${c.name}: ${c.detail}`),
    "",
    rubric.note,
    body.prompt ? `\nTHE PROMPT THEY ARE ANSWERING:\n${body.prompt}` : "",
    body.wordLimit ? `\nWord limit: ${body.wordLimit}. This draft is ${words}.${over ? " It is OVER — say what to cut." : ""}` : "",
    body.studentContext ? `\nWHAT YOU KNOW ABOUT THIS STUDENT (use it to judge whether the essay sounds like them):\n${body.studentContext}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const object = await essayObject(FEEDBACK, system, `Review this draft.\n\n---\n${content}\n---`);

  return {
    scores: object.scores.map((s) => ({ ...s, max: 5 })),
    strengths: object.strengths,
    cuts: object.cuts,
    verdict: object.verdict,
    at: Date.now(),
    words,
  };
}
