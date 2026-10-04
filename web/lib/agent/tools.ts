import "server-only";

import fs from "node:fs";
import path from "node:path";

import type { SDKCustomTool, SDKJsonValue } from "@cursor/sdk";

import { noteUsage } from "@/lib/ai-usage/note";
import { NOTES_LIMIT, type Book } from "@/lib/learning/memory";
import { asCursorTools, learningTools } from "@/lib/learning/tools";
import type { Learned } from "@/lib/learning/types";
import { tts } from "@/lib/media/elevenlabs";
import { DEFAULT_SPEECH_MODEL, DEFAULT_SPEECH_VOICE } from "@/lib/media/catalog";
import { SCRAPER_URL } from "@/lib/ports";
import { sendFile } from "./outbox";
import { describeSchedule, nextRunAfter, normalizeSchedule } from "./schedule";
import { agents, FILES_DIR, getAgent, newId, routines, updateAgent } from "./store";
import type { ChatEvent, Recipient, Routine } from "./types";

/**
 * What an agent can do inside Slates, as in-process tools.
 *
 * General agents get task tools and their own memory. School tools and
 * shared learning are available only to callers that explicitly opt in,
 * such as Study Studio. School messages remain drafts for user approval.
 */

export interface ToolContext {
  agentId: string;
  chatId: string;
  post: (event: ChatEvent) => void;
  handoff: (to: string, message: string) => string;
  /** Told when the agent saves a memory or a skill, to show the student. */
  onLearned?: (item: Learned) => void;
}

/** An agent's own notes, kept on its profile. */
export function agentNotes(agentId: string): Book {
  return {
    kind: "self",
    title: "YOUR NOTES (only you see these)",
    limit: NOTES_LIMIT,
    read: () => getAgent(agentId)?.memory ?? [],
    write: (entries) => void updateAgent(agentId, (agent) => ({ ...agent, memory: entries })),
  };
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
  updates?: { courseId?: string; realm: string; author: string; at: number; text: string; attachments?: { title: string; target?: string; url: string }[] }[];
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

/** The board as the scraper last synced it (or freshly, with `fresh`), as text for a model. */
export async function readBoard(section: string, course: string, fresh: boolean): Promise<string> {
  const data = await scraper<{ snapshot?: Snapshot }>(`/snapshot${fresh ? "?fresh=1" : ""}`, undefined, 110_000);
  if (!data.snapshot) throw new Error("There's no synced board yet.");
  return boardText(data.snapshot, section || "all", course);
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
  if (section === "all" || section === "updates") {
    const updates = (snap.updates ?? []).filter((u) => (u.courseId ? matchCourse(u.courseId) : !course || u.realm.toLowerCase().includes(course.toLowerCase()))).slice(0, 20);
    out.push(`## Updates teachers posted to classes (${updates.length} most recent)`);
    for (const u of updates) {
      const files = (u.attachments ?? []).map((a) => `${a.title} (${a.target || a.url})`).join("; ");
      out.push(`- ${new Date(u.at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} — ${u.realm} — ${u.author}: ${u.text.replace(/\s+/g, " ").slice(0, 600)}${files ? ` — attached: ${files}` : ""}`);
    }
  }
  return out.join("\n");
}

/* ---------- the toolset ---------- */

export function buildTools(ctx: ToolContext, options: { school?: boolean } = {}): Record<string, SDKCustomTool> {
  const self = () => {
    const agent = getAgent(ctx.agentId);
    if (!agent) throw new Error("This agent no longer exists.");
    return agent;
  };

  const draft = (action: Extract<ChatEvent, { type: "approval" }>["action"]) => {
    ctx.post({ id: newId("evt"), at: Date.now(), type: "approval", agentId: ctx.agentId, action, status: "pending" });
    return "Saved as a draft card in the chat. The student will send or discard it; do not try to send it any other way.";
  };

  const learning = asCursorTools(learningTools({ name: getAgent(ctx.agentId)?.name ?? "Agent", notes: agentNotes(ctx.agentId), selfOnly: !options.school, chatId: ctx.chatId, onLearned: ctx.onLearned }));

  return {
    ...learning,

    ...(options.school ? {
      slates_board: tool(
        "Read the student's Schoology board as Slates last synced it: classes and grades, open assignments with due dates, recent messages (with thread ids for replies), and the updates teachers posted to their classes (announcements such as a test moved or cancelled).",
        {
          section: { type: "string", enum: ["all", "assignments", "grades", "messages", "updates"], description: "Which part to read. Default all." },
          course: { type: "string", description: "Only this class (part of its name)." },
          fresh: { type: "boolean", description: "Sync with Schoology first (slower). Default false." },
        },
        [],
        (args) => readBoard(str(args.section), str(args.course), args.fresh === true),
      ),
    } : {}),

    send_file: tool(
      "Send a file from this PC to the user. It appears in this chat as a card they can open, and their Mac saves it to Downloads › Slates on its own. Use it for anything you make for them (documents, slides, spreadsheets, PDFs, images) instead of telling them a path on the PC, which they can't open from their laptop or phone.",
      {
        path: { type: "string", description: "The file, relative to your working folder or absolute." },
        note: { type: "string", description: "One line on what it is, shown on the card." },
      },
      ["path"],
      (args) => {
        const agent = self();
        const file = sendFile({ path: str(args.path), agentId: agent.id, from: agent.name, chatId: ctx.chatId, note: str(args.note) });
        ctx.post({ id: newId("evt"), at: Date.now(), type: "file", agentId: agent.id, file: file.id, name: file.name, size: file.size, note: file.note });
        return `Sent ${file.name} (${file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`}) to the user. It's in the chat and on their computer; don't paste its contents again.`;
      },
    ),

    ...(options.school ? {
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
    } : {}),

    create_routine: tool(
      "Schedule recurring work for yourself. It runs on the host even when the user's laptop is closed, and the result posts in your chat.",
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
      "Send the user a short spoken voice memo (in addition to your text reply).",
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
      "Ask the user a question when you need a decision. Offer short options when there are clear choices. Then end your turn; their answer arrives as the next message.",
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
