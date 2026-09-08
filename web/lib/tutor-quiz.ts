import { z } from "zod";

import { TutorGraphSchema, type TutorGraph } from "./tutor-graph";

/**
 * A practice set the tutor built on request — multiple choice and free
 * response, mixed or alone. Lives on the assistant message that produced it
 * (see `TutorChatMessage.quiz` in `lib/tutor-chats.ts`) so a student's picks
 * and reveals survive a reload the same way the rest of the chat does.
 */
export interface QuizMCQuestion {
  type: "mcq";
  prompt: string;
  choices: string[];
  /** Index into `choices`. */
  answer: number;
  explanation?: string;
  /** The student's pick, once made. */
  selected?: number;
  /** Set on a question about reading or comparing a graph. */
  graph?: TutorGraph;
}

export interface QuizFRQuestion {
  type: "frq";
  prompt: string;
  rubric?: string;
  sampleAnswer?: string;
  /** Whether "Show sample answer" has been clicked — gated so it isn't visible by default. */
  revealed?: boolean;
  /** Set on a question about reading or comparing a graph. */
  graph?: TutorGraph;
}

export type QuizQuestion = QuizMCQuestion | QuizFRQuestion;

export interface Quiz {
  title?: string;
  questions: QuizQuestion[];
}

const QuizQuestionSchema = z.union([
  z.object({
    type: z.literal("mcq"),
    prompt: z.string().min(1),
    choices: z.array(z.string().min(1)).min(2).max(6),
    answer: z.number().int().min(0),
    explanation: z.string().optional(),
    graph: TutorGraphSchema.optional(),
  }),
  z.object({
    type: z.literal("frq"),
    prompt: z.string().min(1),
    rubric: z.string().optional(),
    sampleAnswer: z.string().optional(),
    graph: TutorGraphSchema.optional(),
  }),
]);

const QuizSchema = z.object({
  title: z.string().optional(),
  questions: z.array(QuizQuestionSchema).min(1).max(20),
});

export const TUTOR_QUIZ_INSTRUCTIONS = `
When asked for practice problems, a quiz, a test, or specific question types
(multiple choice, free response/FRQ, or a mix), build them yourself from the
student's actual course material rather than describing what a quiz would
cover. Put the whole thing in exactly one block, on its own lines, in this
form (the block itself is invisible to the student — never mention it or
describe its syntax):
  [[quiz]]
  {"title":"...","questions":[
    {"type":"mcq","prompt":"...","choices":["...","...","...","..."],"answer":0,"explanation":"..."},
    {"type":"frq","prompt":"...","rubric":"what a full-credit answer covers","sampleAnswer":"..."}
  ]}
  [[/quiz]]
Requirements: valid JSON, no comments or trailing commas. "answer" is the
zero-based index of the correct choice. Write plausible wrong choices, not
throwaway ones. A rubric is what you'd grade against, not the answer itself —
never restate the sampleAnswer inside it. Keep any reply text outside the
block to one short sentence introducing the set; the questions themselves
carry the substance. A question about reading, sketching, or comparing a
graph gets its own "graph" field instead of describing the graph in the
prompt: {"type":"mcq","prompt":"...","graph":{"expressions":["y=x^2-4"]},
"choices":[...],"answer":0} — same {"expressions":[...]} shape as a
standalone [[graph]] block. Only include "graph" on a question that is
actually about a graph; leave the field off entirely otherwise; never send
it empty ({"expressions":[]}) as a placeholder.
`.trim();

const BLOCK_RE = /\[\[quiz\]\]([\s\S]*?)\[\[\/quiz\]\]/;
const GLOBAL_BLOCK_RE = /\[\[quiz\]\][\s\S]*?\[\[\/quiz\]\]/g;
const TRAILING_OPEN_RE = /\[\[quiz\]\][\s\S]*$/;

/**
 * Drops a question's `graph` field if it wouldn't validate on its own —
 * a model that tacks on `{"expressions":[]}` out of habit rather than because
 * the question actually needs one shouldn't cost the other seven questions
 * their whole quiz. Everything else about the question is untouched; only a
 * `graph` this broken is worth failing loudly over, and this isn't it.
 */
function dropInvalidGraphs(value: unknown): unknown {
  if (!value || typeof value !== "object" || !Array.isArray((value as { questions?: unknown }).questions)) {
    return value;
  }
  const { questions, ...rest } = value as { questions: unknown[] };
  return {
    ...rest,
    questions: questions.map((q) => {
      if (!q || typeof q !== "object" || !("graph" in q)) return q;
      const { graph, ...question } = q as Record<string, unknown>;
      return TutorGraphSchema.safeParse(graph).success ? q : question;
    }),
  };
}

/** Hides a quiz block — complete or still streaming in — from what the student reads. */
export function stripTutorQuiz(text: string): string {
  return text.replace(GLOBAL_BLOCK_RE, "").replace(TRAILING_OPEN_RE, "").trimEnd();
}

/**
 * Full parse, run once a reply finishes streaming. A block that fails to
 * parse or validate is left in place rather than silently dropped — losing a
 * quiz the student asked for is worse than showing them the raw block.
 */
export function parseTutorQuiz(text: string): { clean: string; quiz: Quiz | null } {
  const match = BLOCK_RE.exec(text);
  if (!match) return { clean: text, quiz: null };

  try {
    const parsed = QuizSchema.parse(dropInvalidGraphs(JSON.parse(match[1])));
    return { clean: (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim(), quiz: parsed };
  } catch {
    return { clean: text, quiz: null };
  }
}
