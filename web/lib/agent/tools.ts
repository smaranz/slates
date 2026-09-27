import "server-only";

import fs from "node:fs";
import path from "node:path";

import type { SDKCustomTool, SDKJsonValue } from "@cursor/sdk";

import { noteUsage } from "@/lib/ai-usage/note";
import { tts } from "@/lib/media/elevenlabs";
import { DEFAULT_SPEECH_MODEL, DEFAULT_SPEECH_VOICE } from "@/lib/media/catalog";
import { SCRAPER_URL } from "@/lib/ports";
import { describeSchedule, nextRunAfter, normalizeSchedule } from "./schedule";
import { agents, FILES_DIR, getAgent, newId, routines, skills, updateAgent } from "./store";
import type { ChatEvent, Recipient, Routine } from "./types";

/**
 * What an agent can do inside Slates, as in-process tools.
 *
 * Reads are free. Anything that speaks for the student to another person —
 * a new message or a reply to a teacher — only ever becomes a draft card the
 * student sends or discards; there is deliberately no tool that submits work.
 */

export interface ToolContext {
  agentId: string;
  chatId: string;
  post: (event: ChatEvent) => void;
  handoff: (to: string, message: string) => string;
}

type Args = Record<string, SDKJsonValue>;

const str = (value: SDKJsonValue | undefined): string => (typeof value === "string" ? value : value == null ? "" : String(value));

function tool(description: string, properties: Record<string, SDKJsonValue>, required: string[], execute: (args: Args) => Promise<string> | string): SDKCustomTool {
  return {
    description,
    inputSchema: { type: "object", properties, required },
    execute: async (args) => {
      try {
        return await execute(args);
      } catch (error) {
        return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
      }
    },
  };
}

/* ---------- Slates ---------- */

interface Snapshot {
  courses?: { id: string; name: string; period?: string }[];
  assignments?: { id: string; courseId: string; title: string; due?: string; dueAt?: string | null; completed?: boolean; kind?: string; url?: string; points?: string }[];
  courseGrades?: Record<string, { pct: number; letter: string }>;
  messages?: { id: string; from: string; courseId?: string; subject: string; body?: string; time?: string; unread?: boolean }[];
  syncedAt?: number;
}

async function scraper<T>(pathAndQuery: string, init?: RequestInit, timeout = 60_000): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${SCRAPER_URL}${pathAndQuery}`, { ...init, signal: AbortSignal.timeout(timeout), cache: "no-store" });
  } catch {
    throw new Error("The Schoology service isn't running on the host.");
  }
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok || body.error) throw new Error(body.error ?? `The Schoology service answered ${response.status}.`);
  return body;
}

function boardText(snap: Snapshot, section: string, course: string): string {
  const courses = new Map((snap.courses ?? []).map((c) => [c.id, c]));
  const matchCourse = (id?: string) => !course || (courses.get(id ?? "")?.name ?? "").toLowerCase().includes(course.toLowerCase());
  const out: string[] = [];
  if (snap.syncedAt) out.push(`Synced ${new Date(snap.syncedAt).toLocaleString()}.`);

  if (section === "all" || section === "grades") {
    out.push("## Classes and grades");
    for (const c of snap.courses ?? []) {
      if (!matchCourse(c.id)) continue;
      const grade = snap.courseGrades?.[c.id];
      out.push(`- ${c.name}${c.period ? ` (period ${c.period})` : ""}: ${grade ? `${grade.pct}% ${grade.letter}` : "no grade yet"}`);
    }
  }
  if (section === "all" || section === "assignments") {
    const items = (snap.assignments ?? []).filter((a) => matchCourse(a.courseId));
    const open = items.filter((a) => !a.completed).sort((a, b) => (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9"));
    out.push(`## Assignments (${open.length} open, ${items.length - open.length} done)`);
    for (const a of open.slice(0, 60)) {
      const due = a.dueAt ? new Date(a.dueAt).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : a.due || "no due date";
      out.push(`- ${a.title} — ${courses.get(a.courseId)?.name ?? "?"} — due ${due}${a.kind ? ` — ${a.kind}` : ""}${a.points ? ` — ${a.points}` : ""}${a.url ? ` — ${a.url}` : ""}`);
    }
  }
  if (section === "all" || section === "messages") {
    const messages = (snap.messages ?? []).filter((m) => matchCourse(m.courseId) || !m.courseId).slice(0, 25);
    out.push(`## Messages (${messages.filter((m) => m.unread).length} unread)`);
    for (const m of messages) {
      out.push(`- [thread ${m.id}] ${m.unread ? "UNREAD " : ""}${m.time ?? ""} from ${m.from}: ${m.subject}${m.body ? ` — ${m.body.replace(/\s+/g, " ").slice(0, 220)}` : ""}`);
    }
  }
  return out.join("\n");
}

/* ---------- the toolset ---------- */

export function buildTools(ctx: ToolContext): Record<string, SDKCustomTool> {
  const self = () => {
    const agent = getAgent(ctx.agentId);
    if (!agent) throw new Error("This agent no longer exists.");
    return agent;
  };

  const draft = (action: Extract<ChatEvent, { type: "approval" }>["action"]) => {
    ctx.post({ id: newId("evt"), at: Date.now(), type: "approval", agentId: ctx.agentId, action, status: "pending" });
    return "Saved as a draft card in the chat. The student will send or discard it; do not try to send it any other way.";
  };

  return {
    slates_board: tool(
      "Read the student's Schoology board as Slates last synced it: classes and grades, open assignments with due dates, and recent messages (with thread ids for replies).",
      {
        section: { type: "string", enum: ["all", "assignments", "grades", "messages"], description: "Which part to read. Default all." },
        course: { type: "string", description: "Only this class (part of its name)." },
        fresh: { type: "boolean", description: "Sync with Schoology first (slower). Default false." },
      },
      [],
      async (args) => {
        const data = await scraper<{ snapshot?: Snapshot }>(`/snapshot${args.fresh === true ? "?fresh=1" : ""}`, undefined, 110_000);
        if (!data.snapshot) throw new Error("There's no synced board yet.");
        return boardText(data.snapshot, str(args.section) || "all", str(args.course));
      },
    ),

    slates_find_person: tool(
      "Look someone up in the school's Schoology directory to get the uid needed to address a message.",
      { query: { type: "string", description: "Part of their name, at least 2 letters." } },
      ["query"],
      async (args) => {
        const { people } = await scraper<{ people: { uid: string; name: string; school?: string }[] }>(`/message/recipients?q=${encodeURIComponent(str(args.query))}`);
        return people.length ? people.map((p) => `- uid ${p.uid}: ${p.name}${p.school ? ` (${p.school})` : ""}`).join("\n") : "No one matched.";
      },
    ),

    slates_draft_message: tool(
      "Draft a new Schoology message for the student to review. It is NOT sent: it appears as a card the student sends or discards.",
      {
        recipients: { type: "array", items: { type: "object", properties: { uid: { type: "string" }, name: { type: "string" } }, required: ["uid", "name"] }, description: "People from slates_find_person." },
        subject: { type: "string" },
        body: { type: "string" },
      },
      ["recipients", "subject", "body"],
      (args) => {
        const recipients = (Array.isArray(args.recipients) ? args.recipients : []) as unknown as Recipient[];
        if (!recipients.length || !recipients.every((r) => /^\d+$/.test(String(r?.uid ?? "")) && r?.name)) {
          throw new Error("Each recipient needs a numeric uid and a name from slates_find_person.");
        }
        return draft({ kind: "message", recipients: recipients.map((r) => ({ uid: String(r.uid), name: String(r.name) })), subject: str(args.subject), body: str(args.body) });
      },
    ),

    slates_draft_reply: tool(
      "Draft a reply in an existing Schoology message thread for the student to review. It is NOT sent until they approve it.",
      {
        threadId: { type: "string", description: "The thread id from slates_board's messages." },
        subject: { type: "string", description: "The thread's subject, for the card." },
        body: { type: "string" },
      },
      ["threadId", "body"],
      (args) => {
        if (!/^\d+$/.test(str(args.threadId))) throw new Error("threadId must be the numeric id shown in slates_board.");
        return draft({ kind: "reply", threadId: str(args.threadId), subject: str(args.subject) || undefined, body: str(args.body) });
      },
    ),

    remember: tool(
      "Save a durable fact or preference about the student or how they like work done. It is shown to you at the start of every task.",
      { fact: { type: "string" } },
      ["fact"],
      (args) => {
        const fact = str(args.fact).trim();
        if (!fact) throw new Error("Nothing to remember.");
        updateAgent(ctx.agentId, (agent) => ({
          ...agent,
          memory: [...agent.memory.filter((m) => m.text.toLowerCase() !== fact.toLowerCase()), { id: newId("mem"), text: fact, at: Date.now() }].slice(-60),
        }));
        return "Remembered.";
      },
    ),

    forget: tool(
      "Remove a saved memory by its id or exact text.",
      { memory: { type: "string" } },
      ["memory"],
      (args) => {
        const key = str(args.memory).trim().toLowerCase();
        const before = self().memory.length;
        const after = updateAgent(ctx.agentId, (agent) => ({ ...agent, memory: agent.memory.filter((m) => m.id !== key && m.text.toLowerCase() !== key) }));
        return (after?.memory.length ?? before) < before ? "Forgotten." : "No memory matched.";
      },
    ),

    list_skills: tool("List the saved skills (reusable instructions) every agent can use.", {}, [], () => {
      const all = skills.all();
      return all.length ? all.map((s) => `- ${s.name}: ${s.instructions.split("\n")[0]!.slice(0, 120)}`).join("\n") : "No skills saved yet.";
    }),

    get_skill: tool("Read a saved skill's full instructions.", { name: { type: "string" } }, ["name"], (args) => {
      const skill = skills.all().find((s) => s.name.toLowerCase() === str(args.name).trim().toLowerCase());
      return skill ? `# ${skill.name}\n\n${skill.instructions}` : "No skill by that name.";
    }),

    save_skill: tool(
      "Save or update a reusable skill: when to use it, inputs, steps, how to check the result, what to return, and what needs approval.",
      { name: { type: "string" }, instructions: { type: "string" } },
      ["name", "instructions"],
      (args) => {
        const name = str(args.name).trim().slice(0, 60);
        const instructions = str(args.instructions).trim();
        if (!name || !instructions) throw new Error("A skill needs a name and instructions.");
        const all = skills.all();
        const existing = all.find((s) => s.name.toLowerCase() === name.toLowerCase());
        if (existing) Object.assign(existing, { name, instructions, updatedAt: Date.now() });
        else all.push({ id: newId("skl"), name, instructions, updatedAt: Date.now() });
        skills.save(all);
        return `Saved the skill "${name}".`;
      },
    ),

    create_routine: tool(
      "Schedule recurring work for yourself. It runs on the host even when the student's laptop is closed, and the result posts in your chat.",
      {
        name: { type: "string" },
        prompt: { type: "string", description: "Exactly what to do each run, including the output format and what to do if data is missing." },
        days: { type: "string", description: "daily, weekdays, weekends, or names like mon,wed,fri. Ignored with everyMinutes." },
        time: { type: "string", description: "Local time like 07:30 or 7:30 pm." },
        everyMinutes: { type: "number", description: "Run on an interval instead (minimum 5)." },
      },
      ["name", "prompt"],
      (args) => {
        const schedule = normalizeSchedule({ days: args.days, time: args.time, everyMinutes: args.everyMinutes });
        const all = routines.all();
        const routine: Routine = {
          id: newId("rtn"),
          agentId: ctx.agentId,
          name: str(args.name).trim().slice(0, 80) || "Routine",
          prompt: str(args.prompt).trim(),
          schedule,
          enabled: true,
          createdAt: Date.now(),
          nextRun: nextRunAfter(schedule, Date.now()),
          runs: [],
        };
        routines.save([...all, routine]);
        return `Created "${routine.name}" (${routine.id}): ${describeSchedule(schedule)}. Next run ${new Date(routine.nextRun!).toLocaleString()}.`;
      },
    ),

    list_routines: tool("List your routines with their schedules and recent results.", {}, [], () => {
      const mine = routines.all().filter((r) => r.agentId === ctx.agentId);
      if (!mine.length) return "You have no routines.";
      return mine.map((r) => `- ${r.id} "${r.name}": ${describeSchedule(r.schedule)}${r.enabled ? "" : " (paused)"}; last: ${r.runs[0] ? `${r.runs[0].ok ? "ok" : "failed"} ${new Date(r.runs[0].at).toLocaleString()}` : "never"}`).join("\n");
    }),

    update_routine: tool(
      "Pause, resume, reschedule, or rewrite one of your routines.",
      {
        id: { type: "string" },
        enabled: { type: "boolean" },
        prompt: { type: "string" },
        days: { type: "string" },
        time: { type: "string" },
        everyMinutes: { type: "number" },
        delete: { type: "boolean", description: "Delete it instead." },
      },
      ["id"],
      (args) => {
        const all = routines.all();
        const routine = all.find((r) => r.id === str(args.id) && r.agentId === ctx.agentId);
        if (!routine) throw new Error("You have no routine with that id.");
        if (args.delete === true) {
          routines.save(all.filter((r) => r !== routine));
          return `Deleted "${routine.name}".`;
        }
        if (typeof args.enabled === "boolean") routine.enabled = args.enabled;
        if (str(args.prompt)) routine.prompt = str(args.prompt);
        if (args.days !== undefined || args.time !== undefined || args.everyMinutes !== undefined) {
          routine.schedule = normalizeSchedule({ days: args.days, time: args.time, everyMinutes: args.everyMinutes });
        }
        routine.nextRun = nextRunAfter(routine.schedule, Date.now());
        routines.save(all);
        return `"${routine.name}": ${describeSchedule(routine.schedule)}${routine.enabled ? "" : " (paused)"}.`;
      },
    ),

    list_agents: tool("List the other agents on the team and their jobs.", {}, [], () =>
      agents.all().filter((a) => a.id !== ctx.agentId).map((a) => `- ${a.name}: ${a.job}`).join("\n") || "You're the only agent.",
    ),

    message_agent: tool(
      "Hand work to another agent. They wake up, do it in their own chat, and their answer comes back to you. Give them everything they need.",
      { to: { type: "string", description: "Their name." }, message: { type: "string" } },
      ["to", "message"],
      (args) => ctx.handoff(str(args.to), str(args.message)),
    ),

    send_voice_memo: tool(
      "Send the student a short spoken voice memo (in addition to your text reply).",
      { text: { type: "string", description: "What to say, under about 800 characters." } },
      ["text"],
      async (args) => {
        const text = str(args.text).trim().slice(0, 2500);
        if (!text) throw new Error("Nothing to say.");
        const file = await speakToFile(text);
        ctx.post({ id: newId("evt"), at: Date.now(), type: "voice", agentId: ctx.agentId, file, transcript: text });
        return "Voice memo sent.";
      },
    ),

    ask_user: tool(
      "Ask the student a question when you need a decision. Offer short options when there are clear choices. Then end your turn; their answer arrives as the next message.",
      { question: { type: "string" }, options: { type: "array", items: { type: "string" } } },
      ["question"],
      (args) => {
        const options = (Array.isArray(args.options) ? args.options : []).map(str).filter(Boolean).slice(0, 6);
        ctx.post({ id: newId("evt"), at: Date.now(), type: "question", agentId: ctx.agentId, question: str(args.question), options });
        return "Asked. End your turn now and wait for the answer.";
      },
    ),
  };
}

/** A voice memo as an MP3 in the agent files folder. Returns the file name. */
export async function speakToFile(text: string): Promise<string> {
  const voice = process.env.ELEVENLABS_VOICE_ID || DEFAULT_SPEECH_VOICE;
  const model = process.env.ELEVENLABS_MODEL_ID || DEFAULT_SPEECH_MODEL;
  const { bytes } = await tts(voice, text, model);
  const name = `${newId("voice")}.mp3`;
  fs.mkdirSync(FILES_DIR, { recursive: true });
  fs.writeFileSync(path.join(FILES_DIR, name), bytes);
  noteUsage({ agent: "agent", model, backend: "elevenlabs", inputTokens: text.length, unit: "characters", covered: false });
  return name;
}

/** Send an approved draft through the Schoology service. */
export async function sendApproved(action: Extract<ChatEvent, { type: "approval" }>["action"]): Promise<string> {
  if (action.kind === "message") {
    const result = await scraper<{ message?: string }>("/message/compose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipients: action.recipients, subject: action.subject, body: action.body }),
    }, 120_000);
    return result.message ?? `Sent to ${action.recipients.map((r) => r.name).join(", ")}.`;
  }
  const result = await scraper<{ message?: string }>("/message/reply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ threadId: action.threadId, body: action.body }),
  }, 120_000);
  return result.message ?? "Reply sent.";
}
