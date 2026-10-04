import "server-only";

import type { SDKCustomTool, SDKJsonValue } from "@cursor/sdk";
import { tool, type ToolSet } from "ai";
import { z } from "zod";

import { editBook, studentBook, type Book } from "./memory";
import { recall } from "./recall";
import { patchSkill, saveSkill, skillIndex, viewSkill } from "./skills";
import type { Learned } from "./types";

/**
 * The tools that make a helper learn, defined once for every runtime Slates
 * drives: the agents and the tutor's Cursor backend take them as Cursor SDK
 * custom tools, the tutor's API backends as AI SDK tools, and its Claude
 * Code backend as an in-process MCP server built from those.
 */

export interface Capability<S extends z.ZodObject = z.ZodObject> {
  description: string;
  schema: S;
  /** A method rather than a property, so a tool with its own arguments still fits a record of tools. */
  run(args: z.infer<S>): Promise<string> | string;
}

export function capability<S extends z.ZodObject>(description: string, schema: S, run: (args: z.infer<S>) => Promise<string> | string): Capability<S> {
  return { description, schema, run };
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function asCursorTools(caps: Record<string, Capability>): Record<string, SDKCustomTool> {
  return Object.fromEntries(
    Object.entries(caps).map(([name, cap]) => {
      const { $schema: _schema, ...inputSchema } = z.toJSONSchema(cap.schema) as Record<string, SDKJsonValue>;
      void _schema;
      const custom: SDKCustomTool = {
        description: cap.description,
        inputSchema,
        execute: async (args) => {
          try {
            return await cap.run(cap.schema.parse(args));
          } catch (error) {
            return { content: [{ type: "text", text: message(error) }], isError: true };
          }
        },
      };
      return [name, custom];
    }),
  );
}

export function asAiTools(caps: Record<string, Capability>): ToolSet {
  return Object.fromEntries(
    Object.entries(caps).map(([name, cap]) => [name, tool({ description: cap.description, inputSchema: cap.schema, execute: async (args) => cap.run(args) })]),
  );
}

export interface Helper {
  /** How memory and skills credit it: an agent's name, or "Tutor". */
  name: string;
  /** General agents only keep their own notes; no shared profile, recall or skills. */
  selfOnly?: boolean;
  /** Its own notes. */
  notes: Book;
  /** The chat it's in, left out of recall since it's already in context. */
  chatId?: string;
  /** Told of every change, so the student sees what it learned. */
  onLearned?: (item: Learned) => void;
}

/** Memory, recall and skills: the same for every helper. */
export function learningTools(helper: Helper): Record<string, Capability> {
  const learned = (item: Learned) => {
    try {
      helper.onLearned?.(item);
    } catch {
      // Showing it is a courtesy; the change is already saved.
    }
  };

  if (helper.selfOnly) {
    return {
      memory: capability(
        "Save, change or remove your own notes for future tasks. Use target self. Replace and remove find an entry by a short piece of its text.",
        z.object({
          action: z.enum(["add", "replace", "remove"]),
          target: z.literal("self"),
          content: z.string().optional(),
          old_text: z.string().optional(),
        }),
        (args) => {
          const outcome = editBook(helper.notes, args, helper.name);
          if (!outcome.ok) throw new Error(outcome.message);
          if (outcome.change) learned(outcome.change);
          return outcome.message;
        },
      ),
    };
  }

  return {
    memory: capability(
      "Save, change or remove a memory. Memory lasts between chats and is shown to you at the start of every turn, so there's no reading it back. target student: the profile of the student that every agent and the tutor share. target self: your own notes. Replace and remove find the entry by a short piece of its text.",
      z.object({
        action: z.enum(["add", "replace", "remove"]),
        target: z.enum(["student", "self"]).describe("student: the shared student profile. self: your own notes."),
        content: z.string().optional().describe("The entry to save, one short sentence (add, replace)."),
        old_text: z.string().optional().describe("A short piece of the entry to change or remove (replace, remove)."),
      }),
      (args) => {
        const outcome = editBook(args.target === "student" ? studentBook() : helper.notes, args, helper.name);
        if (!outcome.ok) throw new Error(outcome.message);
        if (outcome.change) learned(outcome.change);
        return outcome.message;
      },
    ),

    search_chats: capability(
      "Search past conversations: earlier tutor chats and the student's chats with their agents. Use it when the student refers to something from before, or you think it came up already, instead of asking them to repeat it. With chat, reads more of one chat.",
      z.object({
        query: z.string().optional().describe("Words to look for. Leave it out to list the latest chats."),
        chat: z.string().optional().describe("A chat id from an earlier result, to read that chat."),
      }),
      (args) => recall({ query: args.query, chat: args.chat, exclude: helper.chatId }),
    ),

    list_skills: capability("List the saved skills with one line on when to use each.", z.object({}), () => skillIndex() || "No skills are saved yet."),

    get_skill: capability(
      "Open a saved skill to follow it. Do this before a task one of the skills covers.",
      z.object({ name: z.string() }),
      (args) => viewSkill(args.name),
    ),

    save_skill: capability(
      "Save a new skill, or rewrite one completely: a procedure any helper can follow next time. Write when to use it, the steps, how to check the result, and what to hand back. Keep it general enough to reuse.",
      z.object({
        name: z.string().describe("Short and general, e.g. \"Weekly study plan\"."),
        description: z.string().describe("One line on when to use it."),
        instructions: z.string(),
      }),
      (args) => {
        const { skill, created } = saveSkill(args, helper.name);
        learned({ kind: "skill", action: created ? "created" : "patched", text: skill.name });
        return `${created ? "Saved" : "Rewrote"} the skill "${skill.name}".`;
      },
    ),

    patch_skill: capability(
      "Fix or extend part of a saved skill in place, when following it showed a step was wrong, missing or out of date. old_text must appear in the skill exactly once; read it with get_skill first.",
      z.object({
        name: z.string(),
        old_text: z.string().describe("The exact text to replace."),
        new_text: z.string().describe("What to put there instead."),
      }),
      (args) => {
        const skill = patchSkill({ name: args.name, oldText: args.old_text, newText: args.new_text }, helper.name);
        learned({ kind: "skill", action: "patched", text: skill.name });
        return `Updated the skill "${skill.name}".`;
      },
    ),
  };
}

export const RECALL_GUIDANCE =
  "search_chats looks through past conversations (earlier tutor chats and the student's agents' chats). When the student refers to something from before, or you suspect it came up already, search before asking them to repeat themselves.";

export const SKILL_GUIDANCE =
  "Skills are saved procedures shared by every agent and the tutor. Before a task one of them covers, open it with get_skill and follow it. When you work out a new multi-step way of doing something the student will want again, save it with save_skill; when a skill turns out wrong or incomplete, fix it with patch_skill.";
