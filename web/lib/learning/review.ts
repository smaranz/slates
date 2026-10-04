import "server-only";

import fs from "node:fs";
import path from "node:path";

import { Agent, JsonlLocalAgentStore, type SDKCustomTool } from "@cursor/sdk";

import { pickModel } from "@/lib/agent/models";
import { noteUsage } from "@/lib/ai-usage/note";
import { MEMORY_HOME, renderBooks, studentBook, type Book } from "./memory";
import { skillIndex } from "./skills";
import { asCursorTools, learningTools } from "./tools";
import type { Learned } from "./types";

/**
 * The learning loop, after Hermes Agent's background review.
 *
 * A helper in the middle of someone's task rarely stops to save what it
 * learned, and nudging it inline costs the student's turn. So once a reply
 * has gone out, a second, small model reads the conversation with only the
 * memory and skill tools and a few steps to spend, and saves what the helper
 * didn't: things the student revealed about themselves, how they want to be
 * helped, and procedures worth keeping. It runs off the reply's path, so it
 * never makes anyone wait.
 *
 * It isn't run after every turn: a memory review every few of the student's
 * turns, or straight away when they say something that sounds like it should
 * be remembered; a skill review after enough tool work to have produced a
 * procedure. A helper that saved something itself resets that clock.
 */

export interface ReviewTurn {
  helper: { key: string; name: string; kind: "agent" | "tutor"; job?: string };
  notes: Book;
  /** General agents review only their own notes. */
  selfOnly?: boolean;
  /** The conversation, oldest first, ending with the reply just given. */
  transcript: { who: string; text: string }[];
  /** What the helper did this turn, by label. */
  steps: string[];
  wroteMemory: boolean;
  wroteSkill: boolean;
  /** False for a routine or a handoff: nothing the student said to learn from. */
  fromStudent: boolean;
}

export interface ReviewPlan {
  memory: boolean;
  skills: boolean;
}

export const MEMORY_EVERY = 4;
export const SKILLS_EVERY = 12;
export const BIG_TURN = 6;

/** The student said something that sounds like it should outlast this chat. */
export const MEMORY_SIGNAL =
  /\b(remember|don'?t forget|from now on|going forward|next time|always|never|i prefer|i'?d rather|i like|i love|i hate|i don'?t like|i can'?t stand|call me|my name|i'?m (?:in|taking|a|an|on|doing)\b|i have (?:a |an )?(?:job|practice|game|class|test|exam|appointment|club|tutor)|my (?:schedule|goal|teacher|coach|parents?|mom|dad|classes|major|dream)|stop (?:doing|using|saying|adding)|too (?:long|short|wordy|much)|instead of)/i;

const STATE_FILE = path.join(MEMORY_HOME, "state.json");

type Counters = Record<string, { turns: number; tools: number }>;

function readCounters(): Counters {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as Counters;
  } catch {
    return {};
  }
}

function writeCounters(counters: Counters): void {
  fs.mkdirSync(MEMORY_HOME, { recursive: true });
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(counters));
  fs.renameSync(tmp, STATE_FILE);
}

/** Whether this turn earns a review, and what kind. Counts the turn either way. */
export function planReview(turn: ReviewTurn): ReviewPlan {
  const counters = readCounters();
  const count = counters[turn.helper.key] ?? { turns: 0, tools: 0 };
  if (turn.fromStudent) count.turns += 1;
  count.tools += turn.steps.length;
  if (turn.wroteMemory) count.turns = 0;
  if (turn.wroteSkill) count.tools = 0;

  const lastStudent = [...turn.transcript].reverse().find((line) => line.who === (turn.selfOnly ? "User" : "Student"))?.text ?? "";
  const memory = turn.fromStudent && !turn.wroteMemory && (count.turns >= MEMORY_EVERY || MEMORY_SIGNAL.test(lastStudent));
  const skills = !turn.selfOnly && !turn.wroteSkill && (count.tools >= SKILLS_EVERY || turn.steps.length >= BIG_TURN);
  if (memory) count.turns = 0;
  if (skills) count.tools = 0;

  counters[turn.helper.key] = count;
  writeCounters(counters);
  return { memory, skills };
}

const MEMORY_REVIEW = (name: string) =>
  [
    "Review the conversation above and consider saving to memory.",
    "Focus on:",
    "1. Has the student revealed things about themselves worth knowing in later chats: their situation, classes, schedule, goals, what they find hard, what they like, personal details?",
    "2. Has the student said how they want to be helped (tone, length, format, what to always or never do), or corrected something?",
    `Save what stands out with the memory tool: target "student" for things about the student (every helper sees those), target "self" for how ${name} should do its job for them. Prefer changing an existing entry (replace) to adding a near-duplicate, and keep each entry to one short sentence.`,
    "Skip anything one-off (this assignment's details, what happened this turn), anything already on their Schoology board (grades, due dates), and anything already saved. Never save passwords, codes or keys.",
    'If nothing is worth saving, reply "Nothing to save." and stop.',
  ].join("\n");

const SKILL_REVIEW = [
  "Review the conversation above and consider updating the skill library. A skill is a saved procedure any helper can follow next time: when to use it, the steps, how to check the result, and what to hand back.",
  "Save or improve one when the conversation worked out a way of doing something the student is likely to want again: a multi-step task that succeeded, a workaround for a site or tool, a format they settled on after corrections. If a skill was followed and turned out wrong or incomplete, fix it now with patch_skill (open it with get_skill first).",
  'Prefer improving an existing skill to creating a near-duplicate, and keep skills general enough to reuse ("Weekly study plan", not "Plan for Oct 3"). A skill must never have a helper do graded work for the student.',
  'If nothing is worth saving, reply "Nothing to save." and stop.',
].join("\n");

const TRANSCRIPT_CHARS = 14_000;

function transcriptText(lines: ReviewTurn["transcript"]): string {
  const out: string[] = [];
  let used = 0;
  for (const line of [...lines].reverse().slice(0, 16)) {
    const text = `${line.who}: ${line.text.trim().slice(0, 1_500)}`;
    if (used + text.length > TRANSCRIPT_CHARS && out.length) break;
    out.unshift(text);
    used += text.length;
  }
  return out.join("\n\n");
}

export function reviewPrompt(turn: ReviewTurn, plan: ReviewPlan): string {
  const { name, kind, job } = turn.helper;
  const who = kind === "tutor" ? "their tutor (the chat in Slates' School app)" : `${name}, one of their AI agents in Slates${job ? ` (its job: ${job})` : ""}`;
  const notes = { ...turn.notes, title: `${name.toUpperCase()}'S NOTES (target "self")` };
  if (turn.selfOnly) {
    return [
      `Review the recent conversation with ${name}, a general-purpose agent${job ? ` assigned to ${job}` : ""}. You are maintaining its own notes for future tasks, not replying to the user.`,
      `<memory>\n${renderBooks([notes])}\n</memory>`,
      `<conversation>\n${transcriptText(turn.transcript)}\n</conversation>`,
      'Save useful user preferences, corrections and working conventions with memory (target "self"). Keep entries short; replace duplicates. Skip one-off details and never save passwords, codes or keys. If nothing is worth saving, stop.',
    ].join("\n\n");
  }
  const student = { ...studentBook(), title: 'STUDENT PROFILE (target "student", shared by every helper)' };
  return [
    `You look after the long-term memory of Slates, a high-school student's study app. Below is a recent conversation between the student and ${who}.\n` +
      "You are not talking to the student, and nobody reads your reply. Your only job is to keep what Slates remembers up to date with your tools. Be quick: a few tool calls at most, then stop.",
    `<memory>\n${renderBooks([student, notes])}\n</memory>`,
    plan.skills ? `<skills>\n${skillIndex() || "(none yet)"}\n</skills>` : "",
    `<conversation>\n${transcriptText(turn.transcript)}\n</conversation>`,
    plan.skills && turn.steps.length ? `<steps>\nWhat ${name} did in its last reply:\n${turn.steps.map((step) => `- ${step}`).join("\n")}\n</steps>` : "",
    plan.memory ? MEMORY_REVIEW(name) : "",
    plan.skills ? SKILL_REVIEW : "",
    'When you are done, reply with one line on what you changed, or "Nothing to save."',
  ]
    .filter(Boolean)
    .join("\n\n");
}

/* ---------- running one ---------- */

export type ReviewRunner = (prompt: string, tools: Record<string, SDKCustomTool>, turn: ReviewTurn) => Promise<void>;

/** Fast, cheap models first: this is housekeeping. */
const REVIEW_MODELS = ["composer-2.5", "claude-haiku-4-5", "gemini-3.8-flash", "gpt-5.6-luna"];
const REVIEW_DIR = path.join(MEMORY_HOME, "review");
const LIMIT_MS = 2 * 60_000;

let runtime: JsonlLocalAgentStore | null = null;

const runWithCursor: ReviewRunner = async (prompt, tools, turn) => {
  runtime ??= new JsonlLocalAgentStore(path.join(REVIEW_DIR, "runtime"));
  const store = runtime;
  fs.mkdirSync(REVIEW_DIR, { recursive: true });
  const model = await pickModel(REVIEW_MODELS);
  // Only the MCP family, which is where custom tools live: no shell, files or web.
  const sdk = await Agent.create({ model: { id: model }, local: { cwd: REVIEW_DIR, store, customTools: tools }, tools: ["mcp"] });
  try {
    const run = await sdk.send({ text: prompt }, { mode: "agent" });
    const timer = setTimeout(() => void run.cancel().catch(() => {}), LIMIT_MS);
    await run.wait().finally(() => clearTimeout(timer));
    const agent = turn.helper.kind === "tutor" ? "tutor" : "agent";
    try {
      const usage = await sdk.getUsage();
      noteUsage({
        agent, model, backend: "cursor", covered: true,
        inputTokens: usage.usage.inputTokens, outputTokens: usage.usage.outputTokens,
        reasoningTokens: usage.usage.reasoningTokens ?? 0, cacheReadTokens: usage.usage.cacheReadTokens,
      });
    } catch {
      noteUsage({ agent, model, backend: "cursor", inputTokens: 0, outputTokens: 0, covered: true });
    }
  } finally {
    sdk.close();
    await Agent.delete(sdk.agentId, { cwd: REVIEW_DIR, store }).catch(() => {});
  }
};

let runner: ReviewRunner = runWithCursor;

/** Swap the model out, for tests. `null` puts the real one back. */
export function setReviewRunner(next: ReviewRunner | null): void {
  runner = next ?? runWithCursor;
}

export async function review(turn: ReviewTurn, plan: ReviewPlan): Promise<Learned[]> {
  const learned: Learned[] = [];
  const all = learningTools({ name: turn.helper.name, notes: turn.notes, selfOnly: turn.selfOnly, onLearned: (item) => learned.push(item) });
  const keep = ["memory", ...(plan.skills ? ["get_skill", "save_skill", "patch_skill"] : [])];
  const tools = Object.fromEntries(Object.entries(all).filter(([name]) => keep.includes(name)));
  await runner(reviewPrompt(turn, plan), asCursorTools(tools), turn);
  return learned;
}

/* ---------- in the background ---------- */

const state = globalThis as typeof globalThis & {
  __slatesReviews?: Map<string, { at: number; done: Promise<Learned[]> }>;
  __slatesReviewQueue?: Map<string, Promise<unknown>>;
};
const jobs = (state.__slatesReviews ??= new Map<string, { at: number; done: Promise<Learned[]> }>());
/** One review at a time per helper, so two quick turns don't both save the same thing. */
const queues = (state.__slatesReviewQueue ??= new Map<string, Promise<unknown>>());

/**
 * Start a review without waiting for it. `onDone` hears what it changed;
 * `reviewResult` lets a page that has moved on ask later.
 */
export function startReview(id: string, turn: ReviewTurn, plan: ReviewPlan, onDone?: (items: Learned[]) => void): void {
  const key = turn.helper.key;
  const done: Promise<Learned[]> = (queues.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(() => review(turn, plan))
    .catch((error: unknown) => {
      console.error(`[learning] review for ${turn.helper.name} failed:`, error instanceof Error ? error.message : error);
      return [] as Learned[];
    });
  queues.set(key, done);
  jobs.set(id, { at: Date.now(), done });
  void done.then((items) => {
    if (queues.get(key) === done) queues.delete(key);
    if (items.length) onDone?.(items);
  });
  for (const [old, job] of jobs) if (Date.now() - job.at > 15 * 60_000) jobs.delete(old);
}

/** What a started review changed, waiting up to `waitMs` for it. Null for an unknown id or a review still going. */
export async function reviewResult(id: string, waitMs = 60_000): Promise<Learned[] | null> {
  const job = jobs.get(id);
  if (!job) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), waitMs)));
  try {
    return await Promise.race([job.done, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
