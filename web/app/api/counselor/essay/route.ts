import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";

import { aiSignals, countWords, verdictFor } from "@/lib/counselor/ai-signals";
import { RUBRICS } from "@/lib/counselor/rubric";
import type { AiCheck, EssayFeedback, EssayKind } from "@/lib/counselor/types";

/**
 * Reviewing an essay, and estimating how machine-written it reads.
 *
 * Two jobs behind one route because they are asked together and read together.
 *
 * The review scores against a rubric with `generateObject`, so every criterion
 * comes back with a quote from the essay behind it. That constraint is the
 * whole point: feedback that can't cite a line is feedback about essays in
 * general, which the student can get anywhere and can't act on.
 *
 * The AI check is computed locally first (see lib/counselor/ai-signals.ts for
 * why it isn't ten detector sites averaged), then a model pass names the
 * specific sentences that read as generated. Real third-party detectors are
 * blended in only when an API key is configured — never scraped.
 */

export const maxDuration = 120;

const MODEL = process.env.SLATES_COUNSELOR_MODEL || "gpt-5.6-sol";

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

const FLAGGED = z.object({
  flagged: z
    .array(
      z.object({
        quote: z.string().describe("A sentence copied exactly from the essay."),
        why: z.string().max(160).describe("What makes it read as generated, in one clause."),
      })
    )
    .max(6),
});

interface Body {
  action: "feedback" | "ai-check";
  content: string;
  kind?: EssayKind;
  prompt?: string;
  wordLimit?: number | null;
  /** So the review can tell whether the essay is actually about this student. */
  studentContext?: string;
}

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: "No OPENAI_API_KEY set. Add one to web/.env.local and restart." }, { status: 500 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }

  const content = body?.content?.trim();
  if (!content) return Response.json({ error: "Nothing to read." }, { status: 400 });
  if (countWords(content) < 40) {
    return Response.json({ error: "That's too short to review — write a real draft first." }, { status: 400 });
  }

  try {
    if (body.action === "ai-check") return Response.json(await aiCheck(content));
    return Response.json(await review(content, body));
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Something went wrong." },
      { status: 502 }
    );
  }
}

async function review(content: string, body: Body): Promise<EssayFeedback> {
  const rubric = RUBRICS[body.kind ?? "other"] ?? RUBRICS.other;
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

  const { object } = await generateObject({
    model: openai(MODEL),
    schema: FEEDBACK,
    system,
    prompt: `Review this draft.\n\n---\n${content}\n---`,
  });

  return {
    scores: object.scores.map((s) => ({ ...s, max: 5 })),
    strengths: object.strengths,
    cuts: object.cuts,
    verdict: object.verdict,
    at: Date.now(),
    words,
  };
}

async function aiCheck(content: string): Promise<AiCheck> {
  const { signals, score } = aiSignals(content);
  const words = countWords(content);

  // The local pass says how machine-like the prose reads; this says where.
  // Run in parallel with the detectors so neither waits on the other.
  const [flagged, external] = await Promise.all([
    flagPassages(content),
    externalDetectors(content),
  ]);

  // A real detector, when one is configured, is worth more than the local
  // statistics — but not enough to overrule them, since detectors are exactly
  // as unreliable on polished student prose as the module comment says.
  const blended = external.length
    ? Math.round(score * 0.6 + (external.reduce((sum, d) => sum + d.score, 0) / external.length) * 0.4)
    : score;

  return { score: blended, verdict: verdictFor(blended), signals, flagged, external, at: Date.now(), words };
}

async function flagPassages(content: string): Promise<{ quote: string; why: string }[]> {
  try {
    const { object } = await generateObject({
      model: openai(MODEL),
      schema: FLAGGED,
      system: [
        "You read student essays and point at the sentences that read as machine-written.",
        "",
        "What you are looking for: abstract nouns doing the work a concrete detail should do; a claim",
        "about growth with nothing behind it; transitions that announce structure ('Moreover',",
        "'In conclusion'); the even, unvaried rhythm of generated prose; phrasing anyone could have",
        "written about anyone.",
        "",
        "Quote sentences exactly as they appear. Say in one clause what makes each read that way.",
        "",
        "Return an empty list when the writing genuinely reads as a person's. Do not manufacture flags to",
        "look thorough — a false accusation about a student's own sentence is worse than missing one,",
        "and this is advisory, not evidence.",
      ].join("\n"),
      prompt: `Essay:\n\n---\n${content}\n---`,
    });
    return object.flagged;
  } catch {
    // The statistics stand on their own; a failed model pass shouldn't take
    // the whole check down with it.
    return [];
  }
}

/**
 * Third-party detectors, when the student has configured one.
 *
 * Only services with a real API and a key the student supplied. Nothing here
 * scrapes a website, and nothing runs unless a key exists — an essay is not
 * posted to a company that never agreed to receive it, by default or by
 * accident.
 */
async function externalDetectors(content: string): Promise<{ name: string; score: number }[]> {
  const out: { name: string; score: number }[] = [];

  const gptzero = process.env.SLATES_GPTZERO_API_KEY;
  if (gptzero) {
    try {
      const res = await fetch("https://api.gptzero.me/v2/predict/text", {
        method: "POST",
        headers: { "x-api-key": gptzero, "Content-Type": "application/json" },
        body: JSON.stringify({ document: content }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          documents?: { class_probabilities?: { ai?: number; mixed?: number } }[];
        };
        const p = data.documents?.[0]?.class_probabilities;
        if (p?.ai != null) out.push({ name: "GPTZero", score: Math.round((p.ai + (p.mixed ?? 0) / 2) * 100) });
      }
    } catch {
      // A detector being down is not a reason to fail the check.
    }
  }

  const sapling = process.env.SLATES_SAPLING_API_KEY;
  if (sapling) {
    try {
      const res = await fetch("https://api.sapling.ai/api/v1/aidetect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: sapling, text: content }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        const data = (await res.json()) as { score?: number };
        if (typeof data.score === "number") out.push({ name: "Sapling", score: Math.round(data.score * 100) });
      }
    } catch {
      // Same.
    }
  }

  return out;
}
