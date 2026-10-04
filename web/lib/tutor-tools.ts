import "server-only";

import fs from "node:fs";
import path from "node:path";

import type { SDKCustomTool } from "@cursor/sdk";
import type { ToolSet } from "ai";
import { createAiSdkMcpServer } from "ai-sdk-provider-claude-code";
import { z } from "zod";

import { tutorHandoff } from "@/lib/agent/engine";
import { agents } from "@/lib/agent/store";
import { readBoard } from "@/lib/agent/tools";
import { memoryPrompt, studentBook, tutorBook } from "@/lib/learning/memory";
import { skillIndex } from "@/lib/learning/skills";
import { asAiTools, asCursorTools, capability, learningTools, RECALL_GUIDANCE, SKILL_GUIDANCE, type Capability } from "@/lib/learning/tools";
import type { Learned } from "@/lib/learning/types";
import { OUTPUT_DIR, WORKSPACE, ensureWorkspace } from "./tutor-skills";

/**
 * What makes the tutor an agent rather than a chat box: the same memory,
 * recall and skills the agents have, a browser like theirs, the Schoology
 * board, a way to hand work to an agent, and a way to write a file. Defined
 * once and handed to whichever backend the student picked.
 *
 * Deliberately not here: a shell, or writing anywhere but the tutor's own
 * output folder. Work that needs the PC itself goes to an agent.
 */

/** Where the tutor's browser puts screenshots it takes to see a page: not files for the student. */
export const TUTOR_BROWSER_DIR = path.join(WORKSPACE, "browser");

const TEXT_FILES = new Set([".md", ".txt", ".csv", ".tsv", ".json", ".tex", ".ics"]);
const FILE_LIMIT = 2 * 1024 * 1024;

function saveTutorFile(name: string, content: string): string {
  ensureWorkspace();
  const base = path.basename(name.replace(/\\/g, "/")).replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "_").replace(/^\.+/, "").trim().slice(0, 120);
  const ext = path.extname(base).toLowerCase();
  if (!base || !TEXT_FILES.has(ext)) throw new Error(`Name the file with one of these endings: ${[...TEXT_FILES].join(", ")}. A study guide or worksheet is better written as a document, which downloads as Word.`);
  if (Buffer.byteLength(content) > FILE_LIMIT) throw new Error("That's over 2 MB; split it into smaller files.");
  let target = path.join(OUTPUT_DIR, base);
  for (let n = 2; fs.existsSync(target); n += 1) target = path.join(OUTPUT_DIR, base.replace(/(\.[^.]*)$/, ` (${n})$1`));
  fs.writeFileSync(target, content);
  return `Saved ${path.basename(target)}. It shows under your reply for the student to open; say in a line what it's for.`;
}

export interface TutorToolContext {
  chatId: string;
  onLearned: (item: Learned) => void;
}

export function tutorCapabilities(ctx: TutorToolContext): Record<string, Capability> {
  return {
    ...learningTools({ name: "Tutor", notes: tutorBook(), chatId: ctx.chatId, onLearned: ctx.onLearned }),

    slates_board: capability(
      "Read the student's Schoology board as Slates last synced it, or sync it first with fresh: classes and grades, open assignments with due dates, messages, and the updates teachers posted (a test moved or cancelled).",
      z.object({
        section: z.enum(["all", "assignments", "grades", "messages", "updates"]).optional(),
        course: z.string().optional().describe("Only this class (part of its name)."),
        fresh: z.boolean().optional().describe("Sync with Schoology first (slower)."),
      }),
      (args) => readBoard(args.section ?? "all", args.course ?? "", args.fresh === true),
    ),

    message_agent: capability(
      "Hand a job to one of the student's agents in the Agent app. They work on the student's PC with a full computer and can run things on a schedule. They do it in their own chat, not here, so give them everything they need.",
      z.object({ to: z.string().describe("The agent's name."), message: z.string() }),
      (args) => tutorHandoff(args.to, args.message),
    ),

    save_file: capability(
      "Write a text file the student can download: Markdown, plain text, CSV (for flashcard apps like Quizlet or Anki), TSV, JSON, LaTeX, or an .ics calendar. It appears under your reply.",
      z.object({ name: z.string().describe('A name they would recognise, e.g. "bio-unit-4-flashcards.csv".'), content: z.string() }),
      (args) => saveTutorFile(args.name, args.content),
    ),
  };
}

export const tutorAiTools = (ctx: TutorToolContext): ToolSet => asAiTools(tutorCapabilities(ctx));
export const tutorCursorTools = (ctx: TutorToolContext): Record<string, SDKCustomTool> => asCursorTools(tutorCapabilities(ctx));
export const tutorClaudeServer = (ctx: TutorToolContext) => createAiSdkMcpServer("slates", tutorAiTools(ctx));

/** What the tutor is told about acting, with what it remembers. */
export function tutorAgentPrompt(options: { browser: boolean }): string {
  const team = agents.all();
  const skills = skillIndex();
  return [
    memoryPrompt([studentBook(), tutorBook()]),
    "",
    "You're more than a chat window: you can act, the way the student's agents in Slates do. Reach for a tool when it makes the answer better; for an ordinary question, just answer.",
    options.browser
      ? "- A real Chrome browser on the student's always-on PC (the browser_* tools), shared with Study builds; each of their agents has its own. Its sign-ins persist. Use it for pages web search can't reach or doesn't summarise well: a teacher's site, a textbook page, an online practice set. Take a snapshot to read a page before clicking. If a page needs a password, 2FA or a CAPTCHA, stop and ask the student to take over in the Computer panel (the screen button at the top of this chat). Never ask for a password in chat, and never submit, post, buy or send anything."
      : "",
    "- slates_board: their Schoology board as last synced, or synced now with fresh: true.",
    `- ${RECALL_GUIDANCE}`,
    `- ${SKILL_GUIDANCE}${skills ? `\nSaved skills:\n${skills}` : ""}`,
    team.length
      ? `- message_agent hands a job to one of their agents, who work on the PC with a full computer and can run things on a schedule: for anything that needs a computer, runs long, or should happen later ("remind me every Sunday", "make me a spreadsheet of my grades"). Say you passed it on and that the result will be in that agent's chat in the Agent app. Their agents: ${team.map((a) => `${a.name} (${a.job || "general"})`).join("; ")}.`
      : "- The student has no agents yet. If they want something done on a schedule or on their computer, suggest making one in the Agent app.",
    "- save_file writes a text file (Markdown, CSV for flashcard apps, an .ics calendar, LaTeX) that appears under your reply to download.",
  ]
    .filter(Boolean)
    .join("\n");
}
