import "server-only";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Agent, JsonlLocalAgentStore, type SDKImage } from "@cursor/sdk";

import { noteUsage } from "@/lib/ai-usage/note";
import { renderBooks } from "@/lib/learning/memory";
import { planReview, startReview, type ReviewTurn } from "@/lib/learning/review";
import { agentBrowserMcp } from "./browser";
import { publish } from "./hub";
import { listModels, REPLACED } from "./models";
import { hasCutOffTurn } from "./runs";
import { generalAgentPrompt } from "./prompt";
import { nextRunAfter } from "./schedule";
import {
  agents, chatEvents, ensureDirs, FILES_DIR, findAgentByName, getAgent, groups, newId, putEvent, routines, RUNTIME_DIR, updateAgent, WORKSPACE, writeChat,
} from "./store";
import { chatTarget, getThread, groupOfChat, membersOfChat, updateThread } from "./threads";
import { agentNotes, buildTools, speakToFile } from "./tools";
import { readState } from "@/lib/whirl-server/state";
import { DEFAULT_MODEL, type AgentProfile, type AgentState, type ChatEvent } from "./types";

export { listModels };

/**
 * Runs agents on the host.
 *
 * Each agent is a persistent Cursor SDK agent (its working context survives
 * between turns and restarts) with the host's shell, files and browser, plus
 * the Slates tools. One turn at a time per agent; everything else queues.
 * Turns run here, not in the window that asked, so closing the laptop or the
 * phone doesn't stop anything.
 */

export interface Job {
  agentId: string;
  chatId: string;
  text: string;
  images?: SDKImage[];
  source: "user" | "agent" | "routine";
  from?: string;
  replyTo?: { agentId: string; chatId: string };
  routineId?: string;
  /** Speak the reply (talk mode), whatever the agent's own setting. */
  speak?: boolean;
  /** Passed on by the School tutor rather than written by the student or a teammate. */
  viaTutor?: boolean;
  hops: number;
}

interface Worker {
  queue: Job[];
  active: { job: Job; cancel?: () => Promise<void>; stopped: boolean } | null;
}

const MAX_HOPS = 6;
// Start general agents in a new store so old school tools and context are not resumed.
const runtimeStore = new JsonlLocalAgentStore(path.join(RUNTIME_DIR, "general-v1"));

const state = globalThis as typeof globalThis & {
  __slatesAgentWorkers?: Map<string, Worker>;
  __slatesAgentNotes?: Map<string, string[]>;
};
const workers: Map<string, Worker> = (state.__slatesAgentWorkers ??= new Map());
/** Things that happened since an agent's last turn (drafts sent or discarded). */
const notes: Map<string, string[]> = (state.__slatesAgentNotes ??= new Map());

/* ---------- events and state ---------- */

export function post(chatId: string, event: ChatEvent, persist = true): void {
  putEvent(chatId, event, persist);
  publish({ kind: "event", chatId, event });
}

function worker(agentId: string): Worker {
  let w = workers.get(agentId);
  if (!w) workers.set(agentId, (w = { queue: [], active: null }));
  return w;
}

export function agentState(agentId: string): { state: AgentState; queued: number } {
  const w = workers.get(agentId);
  if (!w) return { state: "idle", queued: 0 };
  return { state: w.active ? "working" : w.queue.length ? "queued" : "idle", queued: w.queue.length };
}

function announce(agentId: string): void {
  publish({ kind: "state", agentId, ...agentState(agentId) });
}

export function addNote(agentId: string, note: string): void {
  notes.set(agentId, [...(notes.get(agentId) ?? []), note].slice(-10));
}

/* ---------- queueing ---------- */

export function enqueue(job: Job): void {
  const w = worker(job.agentId);
  w.queue.push(job);
  announce(job.agentId);
  if (!w.active) void drain(job.agentId);
}

export async function stop(agentId: string): Promise<void> {
  const w = workers.get(agentId);
  if (!w) return;
  w.queue = [];
  if (w.active) {
    w.active.stopped = true;
    await w.active.cancel?.().catch(() => {});
  }
  announce(agentId);
}

export async function stopChat(chatId: string): Promise<void> {
  // Only the turns for this chat: the same agent may be busy in another thread.
  await Promise.all(membersOfChat(chatId).map((id) => stopIn(id, chatId)));
}

async function stopIn(agentId: string, chatId: string): Promise<void> {
  const w = workers.get(agentId);
  if (!w) return;
  w.queue = w.queue.filter((job) => job.chatId !== chatId);
  if (w.active && w.active.job.chatId === chatId) {
    w.active.stopped = true;
    await w.active.cancel?.().catch(() => {});
  }
  announce(agentId);
}

/** Chats with a turn running or waiting, for the sidebar's "working" marks. */
export function busyChats(): Map<string, "working" | "queued"> {
  const busy = new Map<string, "working" | "queued">();
  for (const w of workers.values()) {
    for (const job of w.queue) if (!busy.has(job.chatId)) busy.set(job.chatId, "queued");
    if (w.active) busy.set(w.active.job.chatId, "working");
  }
  return busy;
}

/** A message from the student into a chat. */
export function userMessage(chatId: string, text: string, images: SDKImage[] = [], imageFiles: string[] = [], speak = false): string {
  const target = chatTarget(chatId);
  if (!target) throw new Error(chatId.startsWith("grp_") ? "That group doesn't exist." : "That agent doesn't exist.");
  if (target.kind === "agent" && !getAgent(target.id)) throw new Error("That agent doesn't exist.");
  const eventId = newId("evt");
  post(chatId, { id: eventId, at: Date.now(), type: "user", text, images: imageFiles.length ? imageFiles : undefined });
  dispatch(chatId, text, images, speak);
  return eventId;
}

/** Hand a student message in a chat to whoever should answer it. */
function dispatch(chatId: string, text: string, images: SDKImage[], speak: boolean): void {
  const target = chatTarget(chatId);
  if (!target) throw new Error("That conversation doesn't exist.");
  if (target.kind === "agent") {
    enqueue({ agentId: target.id, chatId, text, images, source: "user", speak, hops: 0 });
    return;
  }
  const group = groups.all().find((g) => g.id === target.id);
  if (!group) throw new Error("That group doesn't exist.");
  const members = group.members.map((id) => getAgent(id)).filter((a): a is AgentProfile => !!a);
  if (!members.length) throw new Error("This group has no agents in it.");
  const everyone = /(^|\s)@everyone\b/i.test(text);
  const mentioned = everyone ? members : mentionsIn(text, members);
  for (const agent of mentioned.length ? mentioned : [members[0]!]) {
    enqueue({ agentId: agent.id, chatId, text, images, source: "user", speak, hops: 0 });
  }
}

/**
 * Answer a student message again: everything after it is dropped and the
 * turn runs fresh. Retry, and editing a sent message, both land here.
 */
export async function rerun(chatId: string, userEventId: string, text?: string): Promise<void> {
  await stopChat(chatId);
  const events = chatEvents(chatId, 100_000);
  const at = events.findIndex((e) => e.id === userEventId && e.type === "user");
  if (at < 0) throw new Error("That message isn't in this chat anymore.");
  const original = events[at] as Extract<ChatEvent, { type: "user" }>;
  const edited = { ...original, text: text ?? original.text };
  writeChat(chatId, [...events.slice(0, at), edited]);
  publish({ kind: "event", chatId, event: edited });
  const images: SDKImage[] = [];
  for (const name of edited.images ?? []) {
    try {
      const ext = name.split(".").pop() ?? "png";
      images.push({ data: fs.readFileSync(path.join(FILES_DIR, name)).toString("base64"), mimeType: ext === "jpg" ? "image/jpeg" : `image/${ext}` });
    } catch {
      // A missing image costs that image, not the retry.
    }
  }
  dispatch(chatId, edited.text, images, false);
}

function mentionsIn(text: string, candidates: AgentProfile[]): AgentProfile[] {
  return candidates.filter((agent) => new RegExp(`(^|[^\\w])@${agent.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
}

function handoff(fromId: string, fromChat: string, toName: string, message: string, hops: number): string {
  const from = getAgent(fromId);
  const target = findAgentByName(toName);
  if (!target) return `There's no agent named "${toName}". Use list_agents.`;
  if (target.id === fromId) return "That's you.";
  if (hops >= MAX_HOPS) return "Too many handoffs in a row; finish this yourself or ask the student.";
  const event: ChatEvent = { id: newId("evt"), at: Date.now(), type: "handoff", from: fromId, to: target.id, text: message };
  post(target.id, event);
  if (fromChat !== target.id) post(fromChat, { ...event, id: newId("evt") });
  enqueue({
    agentId: target.id,
    chatId: target.id,
    text: message,
    source: "agent",
    from: from?.name,
    replyTo: { agentId: fromId, chatId: fromChat },
    hops: hops + 1,
  });
  return `Sent to ${target.name}. Their answer will come back to you as a new message; end your turn unless you have other work.`;
}

/**
 * Work the School tutor passes to an agent: done in the agent's own chat,
 * where the student follows it, since the tutor's reply has already gone out.
 */
export function tutorHandoff(toName: string, message: string): string {
  const target = findAgentByName(toName);
  const team = agents.all();
  if (!target) return team.length ? `There's no agent named "${toName}". The agents are: ${team.map((a) => `${a.name} (${a.job || "general"})`).join("; ")}.` : "The student has no agents yet; they can make one in the Agent app.";
  const text = message.trim();
  if (!text) return "Say what the agent should do.";
  post(target.id, { id: newId("evt"), at: Date.now(), type: "handoff", from: "tutor", to: target.id, text });
  enqueue({ agentId: target.id, chatId: target.id, text, source: "agent", from: "the tutor", viaTutor: true, hops: 1 });
  return `Sent to ${target.name}. They'll do it in their own chat in the Agent app, where the student can follow along; tell the student that's where the result will be.`;
}

/* ---------- a turn ---------- */

async function drain(agentId: string): Promise<void> {
  const w = worker(agentId);
  while (!w.active && w.queue.length) {
    const job = w.queue.shift()!;
    w.active = { job, stopped: false };
    announce(agentId);
    try {
      await runJob(job, w.active);
    } catch (error) {
      post(job.chatId, { id: newId("evt"), at: Date.now(), type: "notice", tone: "error", text: `${getAgent(agentId)?.name ?? "Agent"} hit an error: ${error instanceof Error ? error.message : String(error)}` });
      if (job.routineId) recordRoutine(job.routineId, false, error instanceof Error ? error.message : String(error));
    } finally {
      w.active = null;
      announce(agentId);
    }
  }
}

function localNow(): string {
  const now = new Date();
  return `${now.toLocaleString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`;
}

interface Line {
  who: string;
  text: string;
}

/** The chat as plain turns, oldest first: what a model reads back and what recall and review search. */
function chatLines(chatId: string, limit: number): Line[] {
  const names = new Map(agents.all().map((a) => [a.id, a.name]));
  return chatEvents(chatId, 400)
    .filter((e) => e.type === "user" || (e.type === "agent" && !e.streaming && e.text.trim() !== "PASS") || e.type === "handoff")
    .slice(-limit)
    .map((e) =>
      e.type === "user"
        ? { who: "User", text: e.text }
        : e.type === "agent"
          ? { who: names.get(e.agentId) ?? "Agent", text: e.text }
          : e.type === "handoff"
            ? { who: `${e.from === "tutor" ? "Tutor" : names.get(e.from) ?? "Agent"} → ${names.get(e.to) ?? "Agent"}`, text: e.text }
            : { who: "", text: "" },
    );
}

function transcriptTail(chatId: string, limit = 14, skipLast = false): string {
  const lines = chatLines(chatId, limit + (skipLast ? 1 : 0));
  return (skipLast ? lines.slice(0, -1) : lines).map((line) => `${line.who}: ${line.text}`).join("\n\n").slice(-8000);
}

/** The Agent app's Personalization preferences, shared by every agent. */
function userStyle(): string {
  return readState().preferences?.text.trim().slice(0, 4000) ?? "";
}

function buildPrompt(profile: AgentProfile, job: Job, browser: boolean, fresh: boolean): string {
  const team = agents.all().filter((a) => a.id !== profile.id);
  const pending = notes.get(profile.id) ?? [];
  notes.delete(profile.id);
  const lines = [
    "<slates_context>",
    generalAgentPrompt({
      name: profile.name,
      job: profile.job,
      rules: profile.rules,
      style: userStyle(),
      platform: os.type(),
      workspace: WORKSPACE,
      browser,
    }),
    `It is ${localNow()}.`,
    `<memory>\n${renderBooks([agentNotes(profile.id)])}\n</memory>`,
    'Keep useful preferences and working conventions in your own notes with memory (target "self"). Replace duplicates; skip one-off task details. Never save passwords, codes or keys.',
    team.length ? `Teammates (message_agent, or @Name in a group chat): ${team.map((a) => `${a.name} (${a.job || "general"})`).join("; ")}` : "",
    pending.length ? `Since your last turn:\n${pending.map((n) => `- ${n}`).join("\n")}` : "",
  ];
  // A runtime that couldn't be resumed starts with no idea what was said; the chat still has it.
  const group = groupOfChat(job.chatId);
  if (fresh && !group) {
    // The message being answered is already the chat's last line, except on a routine run.
    const earlier = transcriptTail(job.chatId, 16, job.source !== "routine");
    if (earlier) lines.push(`Your working context was reset, so here is how this chat went before this message:\n${earlier}`);
  }
  if (group) {
    const members = (group?.members ?? []).map((id) => getAgent(id)?.name).filter(Boolean).join(", ");
    lines.push(`This message is in the group chat "${group?.name ?? "Group"}" with ${members}. Recent messages:\n${transcriptTail(job.chatId)}\nReply to the group. To bring in a teammate, @mention them by name in your reply. Stay silent on things another member owns: reply with just "PASS" if you have nothing to add.`);
  } else if (job.viaTutor) {
    lines.push("Another assistant passed you this task. Complete it using the supplied information and post the result in this chat.");
  } else if (job.source === "agent") {
    lines.push(`This is a handoff from your teammate ${job.from ?? "another agent"}. Do the work, then reply with the answer for them.`);
  } else if (job.source === "routine") {
    const routine = routines.all().find((r) => r.id === job.routineId);
    lines.push(`This is a scheduled run of your routine "${routine?.name ?? "routine"}". The user isn't watching; post the result for them to read later. If a source is unavailable, report that instead of using stale data.`);
  }
  lines.push("</slates_context>");
  return `${lines.filter(Boolean).join("\n\n")}\n\n${job.text}`;
}

function toolView(toolCall: { type?: string; args?: Record<string, unknown> } | undefined): { label: string; detail?: string } {
  const args = (toolCall?.args ?? {}) as Record<string, unknown>;
  const file = (p: unknown) => (typeof p === "string" ? path.basename(p) : "");
  switch (toolCall?.type) {
    case "shell": return { label: "Ran a command", detail: String(args.command ?? "").slice(0, 300) };
    case "read": return { label: `Read ${file(args.path) || "a file"}` };
    case "edit": case "write": return { label: `Edited ${file(args.path) || "a file"}` };
    case "delete": return { label: `Deleted ${file(args.path) || "a file"}` };
    case "glob": case "ls": case "grep": case "semSearch": return { label: "Looked through files" };
    case "task": return { label: "Worked on a sub-task" };
    case "updateTodos": return { label: "Updated the plan" };
    case "generateImage": return { label: "Made an image" };
    case "mcp": {
      const name = String(args.toolName ?? "tool");
      const inner = (args.args ?? {}) as Record<string, unknown>;
      if (name === "browser_navigate") return { label: "Opened a page", detail: String(inner.url ?? "") };
      if (name.startsWith("browser_")) return { label: `Browser: ${name.slice(8).replace(/_/g, " ")}` };
      if (name === "memory") return { label: "Updated its memory", detail: String(inner.content ?? inner.old_text ?? "") };
      if (name === "search_chats") return { label: "Searched past chats", detail: String(inner.query ?? inner.chat ?? "") };
      if (name === "get_skill") return { label: "Opened a skill", detail: String(inner.name ?? "") };
      if (name === "save_skill" || name === "patch_skill") return { label: "Saved a skill", detail: String(inner.name ?? "") };
      if (name === "send_file") return { label: "Sent you a file", detail: String(inner.path ?? "") };
      return { label: name.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase()) };
    }
    default: {
      const type = String(toolCall?.type ?? "tool");
      if (/web.?search/i.test(type)) return { label: "Searched the web", detail: String(args.query ?? args.searchTerm ?? "") };
      if (/web.?fetch/i.test(type)) return { label: "Read a web page", detail: String(args.url ?? "") };
      return { label: type.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^\w/, (c) => c.toUpperCase()) };
    }
  }
}

function plain(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, " ").replace(/[#*_`>|[\]()-]+/g, " ").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
}

async function runJob(job: Job, active: NonNullable<Worker["active"]>): Promise<void> {
  ensureDirs();
  const profile = getAgent(job.agentId);
  if (!profile) return;
  const models = await listModels();
  const thread = job.chatId.startsWith("thr_") ? getThread(job.chatId) : undefined;
  // A thread can run on its own model; otherwise the agent's.
  const chosen = thread?.model ?? profile.model;
  const wanted = REPLACED[chosen] ?? chosen;
  const modelId = models.some((m) => m.id === wanted) ? wanted : DEFAULT_MODEL;

  // A Chrome of its own: its own tabs, and its own sign-ins.
  const mcp = await agentBrowserMcp(profile.id, path.join(WORKSPACE, "browser"));

  // What this turn saved by itself, so the review afterwards doesn't redo it.
  const wrote = { memory: false, skill: false };
  const tools = buildTools({
    agentId: profile.id,
    chatId: job.chatId,
    post: (event) => post(job.chatId, event),
    handoff: (to, message) => handoff(profile.id, job.chatId, to, message, job.hops),
    onLearned: (item) => {
      wrote[item.kind === "memory" ? "memory" : "skill"] = true;
      post(job.chatId, { id: newId("evt"), at: Date.now(), type: "learned", agentId: profile.id, items: [item] });
    },
  });
  const options = {
    model: { id: modelId },
    local: { cwd: WORKSPACE, store: runtimeStore, customTools: tools },
    ...(mcp ? { mcpServers: { browser: mcp } } : {}),
  };

  // A thread carries its own context per agent; the agent's own chat uses the agent's.
  const savedRuntimeId = thread ? thread.runtimes[profile.id] : profile.runtimeId;
  const runtimeId = savedRuntimeId && await runtimeStore.agents.get({ agentId: savedRuntimeId }).catch(() => null)
    ? savedRuntimeId
    : undefined;
  const keepRuntime = (id: string) =>
    thread
      ? updateThread(thread.id, (t) => ({ ...t, runtimes: { ...t.runtimes, [profile.id]: id } }))
      : updateAgent(profile.id, (agent) => ({ ...agent, runtimeId: id }));
  let sdk = runtimeId
    ? await Agent.resume(runtimeId, options).catch((error: unknown) => {
        console.error(`[agent] couldn't resume ${profile.name}'s context, starting a new one:`, error instanceof Error ? error.message : error);
        return null;
      })
    : null;
  const fresh = !sdk;
  if (!sdk) {
    sdk = await Agent.create(options);
    keepRuntime(sdk.agentId);
  }

  // A turn the host's restart cut off still counts as going, and the SDK
  // refuses this one until it's expired. The student and the agent both hear
  // why the work stopped, and the send below forces past it.
  const cutOff = runtimeId === sdk.agentId && (await hasCutOffTurn(runtimeStore, sdk.agentId));
  if (cutOff) {
    addNote(profile.id, "Your previous turn was cut off partway through: Slates restarted on the PC. Anything it was doing may be unfinished, and programs it started may have stopped. Check before carrying on.");
    post(job.chatId, { id: newId("evt"), at: Date.now(), type: "notice", text: `${profile.name}'s last turn was cut off when Slates restarted on the PC, so it's picking up from here.` });
  }

  const segments: string[] = [];
  let text: Extract<ChatEvent, { type: "agent" }> | null = null;
  let thinking: Extract<ChatEvent, { type: "thinking" }> | null = null;
  let lastPublish = 0;
  const flush = (force = false) => {
    const now = Date.now();
    if (!force && now - lastPublish < 120) return;
    lastPublish = now;
    if (text) post(job.chatId, text, false);
    if (thinking) post(job.chatId, thinking, false);
  };
  const closeText = () => {
    if (text) {
      text = { ...text, streaming: false };
      if (text.text.trim()) {
        segments.push(text.text);
        post(job.chatId, text);
      }
    }
    text = null;
  };
  const closeThinking = () => {
    if (thinking) {
      thinking = { ...thinking, streaming: false };
      if (thinking.text.trim()) post(job.chatId, thinking);
    }
    thinking = null;
  };

  const steps: string[] = [];
  const message = { text: buildPrompt(profile, job, !!mcp, fresh), images: job.images?.length ? job.images : undefined };
  const onDelta = ({ update }: { update: unknown }) => {
    const u = update as { type: string; text?: string; callId?: string; toolCall?: { type?: string; args?: Record<string, unknown>; result?: { error?: unknown; status?: string } } };
    if (u.type === "text-delta" && u.text) {
      closeThinking();
      text ??= { id: newId("evt"), at: Date.now(), type: "agent", agentId: profile.id, text: "", streaming: true };
      text = { ...text, text: text.text + u.text };
      flush();
    } else if (u.type === "thinking-delta" && u.text) {
      // Text after a stretch of thinking is a new paragraph, not the same sentence.
      if (!thinking) closeText();
      thinking ??= { id: newId("evt"), at: Date.now(), type: "thinking", agentId: profile.id, text: "", streaming: true };
      thinking = { ...thinking, text: thinking.text + u.text };
      flush();
    } else if (u.type === "thinking-completed") {
      closeThinking();
    } else if ((u.type === "tool-call-started" || u.type === "tool-call-completed") && u.callId) {
      closeText();
      closeThinking();
      const view = toolView(u.toolCall);
      if (u.type === "tool-call-started") steps.push(view.detail ? `${view.label}: ${view.detail.slice(0, 120)}` : view.label);
      const failed = u.type === "tool-call-completed" && (u.toolCall?.result?.error !== undefined || u.toolCall?.result?.status === "error");
      post(job.chatId, {
        id: `tool_${u.callId}`.replace(/[^\w-]/g, "").slice(0, 80),
        at: Date.now(),
        type: "tool",
        agentId: profile.id,
        label: view.label,
        detail: view.detail,
        status: u.type === "tool-call-started" ? "running" : failed ? "error" : "done",
      }, u.type === "tool-call-completed");
    }
  };

  const send = (force: boolean) => sdk!.send(message, { mode: "agent", onDelta, ...(force ? { local: { force: true } } : {}) });
  let run;
  try {
    run = await send(cutOff);
  } catch (error) {
    // One turn per agent runs here, so a turn the SDK still thinks is going is a leftover.
    if (!/busy|already has active run/i.test(error instanceof Error ? error.message : String(error))) throw error;
    run = await send(true);
  }
  active.cancel = () => run.cancel();
  const result = await run.wait();
  closeThinking();
  closeText();
  flush(true);

  try {
    const usage = await sdk.getUsage();
    noteUsage({
      agent: "agent", model: modelId, backend: "cursor", covered: true,
      inputTokens: usage.usage.inputTokens, outputTokens: usage.usage.outputTokens,
      reasoningTokens: usage.usage.reasoningTokens ?? 0, cacheReadTokens: usage.usage.cacheReadTokens,
    });
  } catch {
    noteUsage({ agent: "agent", model: modelId, backend: "cursor", inputTokens: 0, outputTokens: 0, covered: true });
  }
  sdk.close();

  if (active.stopped) {
    post(job.chatId, { id: newId("evt"), at: Date.now(), type: "notice", text: `Stopped ${profile.name}.` });
    return;
  }
  if (result.status === "error") throw new Error((result as { error?: { message?: string } }).error?.message ?? "The run failed.");

  const reply = segments.join("\n\n").trim();
  if (job.routineId) recordRoutine(job.routineId, true, plain(reply).slice(0, 160) || "Finished.");
  if (reply && reply !== "PASS") learnFrom(profile, job, steps, wrote);

  const current = getAgent(profile.id);
  if ((current?.voiceReplies || job.speak) && reply && reply !== "PASS") {
    try {
      const file = await speakToFile(plain(reply).slice(0, 1500));
      post(job.chatId, { id: newId("evt"), at: Date.now(), type: "voice", agentId: profile.id, file, transcript: plain(reply).slice(0, 1500) });
    } catch (error) {
      post(job.chatId, { id: newId("evt"), at: Date.now(), type: "notice", tone: "error", text: `Couldn't speak the reply: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  const replyGroup = groupOfChat(job.chatId);
  if (replyGroup && reply && job.hops < MAX_HOPS) {
    const group = replyGroup;
    const others = (group?.members ?? []).filter((id) => id !== profile.id).map((id) => getAgent(id)).filter((a): a is AgentProfile => !!a);
    for (const agent of mentionsIn(reply, others)) {
      enqueue({ agentId: agent.id, chatId: job.chatId, text: `${profile.name} said: ${reply}`, source: "agent", from: profile.name, hops: job.hops + 1 });
    }
  }

  if (job.replyTo && reply && job.hops < MAX_HOPS) {
    const back = job.replyTo;
    post(back.chatId, { id: newId("evt"), at: Date.now(), type: "handoff", from: profile.id, to: back.agentId, text: reply });
    enqueue({
      agentId: back.agentId,
      chatId: back.chatId,
      text: `${profile.name} replied to your handoff:\n\n${reply}\n\nContinue the task with this.`,
      source: "agent",
      from: profile.name,
      hops: job.hops + 1,
    });
  }
}

/* ---------- learning ---------- */

/** After a reply: count the turn toward a review, and start one in the background when it's due. */
function learnFrom(profile: AgentProfile, job: Job, steps: string[], wrote: { memory: boolean; skill: boolean }): void {
  try {
    const turn: ReviewTurn = {
      helper: { key: `agent:${profile.id}`, name: profile.name, kind: "agent", job: profile.job },
      notes: agentNotes(profile.id),
      selfOnly: true,
      transcript: chatLines(job.chatId, 16),
      steps,
      wroteMemory: wrote.memory,
      wroteSkill: wrote.skill,
      fromStudent: job.source === "user",
    };
    const plan = planReview(turn);
    if (!plan.memory && !plan.skills) return;
    startReview(newId("rev"), turn, plan, (items) => post(job.chatId, { id: newId("evt"), at: Date.now(), type: "learned", agentId: profile.id, items }));
  } catch (error) {
    console.error("[agent] couldn't start a review:", error instanceof Error ? error.message : error);
  }
}

/* ---------- routines ---------- */

function recordRoutine(id: string, ok: boolean, note: string): void {
  const all = routines.all();
  const routine = all.find((r) => r.id === id);
  if (!routine) return;
  routine.runs = [{ at: Date.now(), ok, note }, ...routine.runs].slice(0, 20);
  routines.save(all);
  publish({ kind: "roster" });
}

export function runRoutine(id: string, manual: boolean): boolean {
  const all = routines.all();
  const routine = all.find((r) => r.id === id);
  if (!routine || !getAgent(routine.agentId)) return false;
  if (!manual) {
    routine.nextRun = nextRunAfter(routine.schedule, Date.now());
    routines.save(all);
  }
  post(routine.agentId, { id: newId("evt"), at: Date.now(), type: "notice", text: `Routine "${routine.name}" ${manual ? "started by you" : "started"}.` });
  enqueue({ agentId: routine.agentId, chatId: routine.agentId, text: routine.prompt, source: "routine", routineId: routine.id, hops: 0 });
  return true;
}

export function tickRoutines(): void {
  const now = Date.now();
  for (const routine of routines.all()) {
    if (!routine.enabled) continue;
    if (routine.nextRun === null || !Number.isFinite(routine.nextRun)) {
      const all = routines.all();
      const r = all.find((x) => x.id === routine.id);
      if (r) {
        r.nextRun = nextRunAfter(r.schedule, now);
        routines.save(all);
      }
      continue;
    }
    if (routine.nextRun <= now) runRoutine(routine.id, false);
  }
}

/** Forget an agent's working context so its next turn starts fresh. */
export async function resetRuntime(agentId: string): Promise<void> {
  await stop(agentId);
  const agent = getAgent(agentId);
  if (agent?.runtimeId) await Agent.delete(agent.runtimeId, { cwd: WORKSPACE, store: runtimeStore }).catch(() => {});
  updateAgent(agentId, (a) => ({ ...a, runtimeId: undefined }));
}

export function workspaceUpload(name: string, bytes: Buffer): string {
  const safe = path.basename(name).replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";
  const dir = path.join(WORKSPACE, "uploads");
  fs.mkdirSync(dir, { recursive: true });
  let target = path.join(dir, safe);
  for (let n = 2; fs.existsSync(target); n += 1) target = path.join(dir, safe.replace(/(\.[^.]*)?$/, ` (${n})$1`));
  fs.writeFileSync(target, bytes);
  return target;
}
