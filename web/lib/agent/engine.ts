import "server-only";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Agent, Cursor, JsonlLocalAgentStore, type SDKImage } from "@cursor/sdk";

import { noteUsage } from "@/lib/ai-usage/note";
import { browserMcp, ensureBrowser } from "./browser";
import { publish } from "./hub";
import { nextRunAfter } from "./schedule";
import {
  agents, chatEvents, ensureDirs, findAgentByName, getAgent, groups, newId, putEvent, routines, RUNTIME_DIR, skills, updateAgent, WORKSPACE,
} from "./store";
import { buildTools, speakToFile } from "./tools";
import { DEFAULT_MODEL, type AgentProfile, type AgentState, type ChatEvent, type ModelChoice } from "./types";

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
  hops: number;
}

interface Worker {
  queue: Job[];
  active: { job: Job; cancel?: () => Promise<void>; stopped: boolean } | null;
}

const MAX_HOPS = 6;
const runtimeStore = new JsonlLocalAgentStore(RUNTIME_DIR);

const state = globalThis as typeof globalThis & {
  __slatesAgentWorkers?: Map<string, Worker>;
  __slatesAgentNotes?: Map<string, string[]>;
  __slatesAgentModels?: { at: number; list: ModelChoice[] };
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

/* ---------- models ---------- */

const PREFERRED = ["grok-4.7", "claude-opus-5-5", "claude-sonnet-5", "gpt-5.6-sol", "gemini-3.1-pro", "composer-2.5", "kimi-k3", "claude-haiku-4-5", "gpt-5.6-luna", "gemini-3.8-flash"];
/** Models Slates has moved past: hidden from the picker, and agents still set to one run on its successor. */
const REPLACED: Record<string, string> = { "claude-opus-5": "claude-opus-5-5" };

export async function listModels(): Promise<ModelChoice[]> {
  const cached = state.__slatesAgentModels;
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.list;
  try {
    const raw = await Cursor.models.list();
    const list = raw
      .filter((model) => model.id !== "default" && !REPLACED[model.id])
      .map((model) => ({ id: model.id, label: model.displayName || model.id }))
      .sort((a, b) => {
        const ia = PREFERRED.indexOf(a.id);
        const ib = PREFERRED.indexOf(b.id);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
    state.__slatesAgentModels = { at: Date.now(), list };
    return list;
  } catch {
    return [{ id: DEFAULT_MODEL, label: "Grok 4.7" }];
  }
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
  const ids = chatId.startsWith("grp_") ? groups.all().find((g) => g.id === chatId)?.members ?? [] : [chatId];
  await Promise.all(ids.map((id) => stop(id)));
}

/** A message from the student into a chat. */
export function userMessage(chatId: string, text: string, images: SDKImage[] = [], imageFiles: string[] = [], speak = false): void {
  if (chatId.startsWith("agt_") && !getAgent(chatId)) throw new Error("That agent doesn't exist.");
  post(chatId, { id: newId("evt"), at: Date.now(), type: "user", text, images: imageFiles.length ? imageFiles : undefined });
  if (chatId.startsWith("agt_")) {
    enqueue({ agentId: chatId, chatId, text, images, source: "user", speak, hops: 0 });
    return;
  }
  const group = groups.all().find((g) => g.id === chatId);
  if (!group) throw new Error("That group doesn't exist.");
  const members = group.members.map((id) => getAgent(id)).filter((a): a is AgentProfile => !!a);
  if (!members.length) throw new Error("This group has no agents in it.");
  const everyone = /(^|\s)@everyone\b/i.test(text);
  const mentioned = everyone ? members : mentionsIn(text, members);
  for (const agent of mentioned.length ? mentioned : [members[0]!]) {
    enqueue({ agentId: agent.id, chatId, text, images, source: "user", speak, hops: 0 });
  }
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

function transcriptTail(chatId: string, limit = 14): string {
  const names = new Map(agents.all().map((a) => [a.id, a.name]));
  return chatEvents(chatId, 200)
    .filter((e) => e.type === "user" || (e.type === "agent" && !e.streaming) || e.type === "handoff")
    .slice(-limit)
    .map((e) => e.type === "user" ? `Student: ${e.text}` : e.type === "agent" ? `${names.get(e.agentId) ?? "Agent"}: ${e.text}` : e.type === "handoff" ? `${names.get(e.from) ?? "Agent"} → ${names.get(e.to) ?? "Agent"}: ${e.text}` : "")
    .join("\n\n")
    .slice(-8000);
}

function buildPrompt(profile: AgentProfile, job: Job, browser: boolean): string {
  const team = agents.all().filter((a) => a.id !== profile.id);
  const pending = notes.get(profile.id) ?? [];
  notes.delete(profile.id);
  const lines = [
    "<slates_context>",
    `You are ${profile.name}, one of the student's AI teammates in Slates (the Agent app). Your job: ${profile.job || "general help"}.`,
    profile.rules.trim() ? `Standing rules from the student:\n${profile.rules.trim()}` : "",
    `You run on the student's always-on PC (${os.type()}), with full access to it: shell, files and apps. Your working folder is ${WORKSPACE}, shared with the other agents; keep project files in clear subfolders there.`,
    browser
      ? "You also have a real Chrome browser (the browser_* tools) whose sign-ins persist between tasks. When a site needs a password, 2FA or a CAPTCHA, ask the student to take over in the Computer panel and wait. Never ask for passwords in chat."
      : "",
    "Slates tools: slates_board (their Schoology classes, grades, assignments, messages), slates_find_person, slates_draft_message and slates_draft_reply (drafts only; the student sends them), remember/forget, list_skills/get_skill/save_skill, create_routine/list_routines/update_routine, list_agents/message_agent, send_voice_memo, ask_user.",
    "Help the student learn and stay organized; never produce graded work for them to hand in as their own. Be concise; lead with the result. Link sources for facts from the web.",
    `It is ${localNow()}.`,
    profile.memory.length ? `What you remember:\n${profile.memory.map((m) => `- ${m.text}`).join("\n")}` : "",
    team.length ? `Teammates (message_agent, or @Name in a group chat): ${team.map((a) => `${a.name} (${a.job || "general"})`).join("; ")}` : "",
    skills.all().length ? `Saved skills: ${skills.all().map((s) => s.name).join(", ")}. If the student names one with /, call get_skill first.` : "",
    pending.length ? `Since your last turn:\n${pending.map((n) => `- ${n}`).join("\n")}` : "",
  ];
  if (job.chatId.startsWith("grp_")) {
    const group = groups.all().find((g) => g.id === job.chatId);
    const members = (group?.members ?? []).map((id) => getAgent(id)?.name).filter(Boolean).join(", ");
    lines.push(`This message is in the group chat "${group?.name ?? "Group"}" with ${members}. Recent messages:\n${transcriptTail(job.chatId)}\nReply to the group. To bring in a teammate, @mention them by name in your reply. Stay silent on things another member owns: reply with just "PASS" if you have nothing to add.`);
  } else if (job.source === "agent") {
    lines.push(`This is a handoff from your teammate ${job.from ?? "another agent"}. Do the work, then reply with the answer for them.`);
  } else if (job.source === "routine") {
    const routine = routines.all().find((r) => r.id === job.routineId);
    lines.push(`This is a scheduled run of your routine "${routine?.name ?? "routine"}". The student isn't watching; post the result for them to read later. If a source is unavailable, report that instead of using stale data.`);
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
      if (name === "slates_board") return { label: "Read your Schoology board" };
      if (name.startsWith("slates_draft")) return { label: "Drafted a message for you" };
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
  const wanted = REPLACED[profile.model] ?? profile.model;
  const modelId = models.some((m) => m.id === wanted) ? wanted : DEFAULT_MODEL;

  let mcp = browserMcp();
  if (mcp) {
    try {
      await ensureBrowser();
    } catch {
      mcp = null;
    }
  }

  const tools = buildTools({
    agentId: profile.id,
    chatId: job.chatId,
    post: (event) => post(job.chatId, event),
    handoff: (to, message) => handoff(profile.id, job.chatId, to, message, job.hops),
  });
  const options = {
    model: { id: modelId },
    local: { cwd: WORKSPACE, store: runtimeStore, customTools: tools },
    ...(mcp ? { mcpServers: { browser: mcp } } : {}),
  };

  let sdk = profile.runtimeId ? await Agent.resume(profile.runtimeId, options).catch(() => null) : null;
  if (!sdk) {
    sdk = await Agent.create(options);
    updateAgent(profile.id, (agent) => ({ ...agent, runtimeId: sdk!.agentId }));
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

  const message = { text: buildPrompt(profile, job, !!mcp), images: job.images?.length ? job.images : undefined };
  const onDelta = ({ update }: { update: unknown }) => {
    const u = update as { type: string; text?: string; callId?: string; toolCall?: { type?: string; args?: Record<string, unknown>; result?: { error?: unknown; status?: string } } };
    if (u.type === "text-delta" && u.text) {
      closeThinking();
      text ??= { id: newId("evt"), at: Date.now(), type: "agent", agentId: profile.id, text: "", streaming: true };
      text = { ...text, text: text.text + u.text };
      flush();
    } else if (u.type === "thinking-delta" && u.text) {
      thinking ??= { id: newId("evt"), at: Date.now(), type: "thinking", agentId: profile.id, text: "", streaming: true };
      thinking = { ...thinking, text: thinking.text + u.text };
      flush();
    } else if (u.type === "thinking-completed") {
      closeThinking();
    } else if ((u.type === "tool-call-started" || u.type === "tool-call-completed") && u.callId) {
      closeText();
      closeThinking();
      const view = toolView(u.toolCall);
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
    run = await send(false);
  } catch (error) {
    if (!/busy/i.test(error instanceof Error ? error.message : String(error))) throw error;
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

  const current = getAgent(profile.id);
  if ((current?.voiceReplies || job.speak) && reply && reply !== "PASS") {
    try {
      const file = await speakToFile(plain(reply).slice(0, 1500));
      post(job.chatId, { id: newId("evt"), at: Date.now(), type: "voice", agentId: profile.id, file, transcript: plain(reply).slice(0, 1500) });
    } catch (error) {
      post(job.chatId, { id: newId("evt"), at: Date.now(), type: "notice", tone: "error", text: `Couldn't speak the reply: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  if (job.chatId.startsWith("grp_") && reply && job.hops < MAX_HOPS) {
    const group = groups.all().find((g) => g.id === job.chatId);
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
