/** Shared shapes for the Agent app; safe to import in the browser and on the server. */

import type { Learned, MemoryBookView, MemoryEntry as MemoryItem } from "@/lib/learning/types";

export type { MemoryItem };

export interface AgentProfile {
  id: string;
  name: string;
  /** One line: what this agent owns. */
  job: string;
  /** Standing instructions that hold for every task. */
  rules: string;
  /** A model id from the Cursor catalog, e.g. "grok-4.7". */
  model: string;
  hue: number;
  /** Speak every reply as a voice memo. */
  voiceReplies: boolean;
  createdAt: number;
  memory: MemoryItem[];
  /** The Cursor SDK agent that carries this agent's working context between turns. */
  runtimeId?: string;
}

export interface AgentGroup {
  id: string;
  name: string;
  members: string[];
  createdAt: number;
}

export type Schedule =
  /** Local wall-clock time on the listed weekdays (0 = Sunday). */
  | { kind: "days"; days: number[]; time: string }
  | { kind: "every"; minutes: number };

export interface RoutineRun {
  at: number;
  ok: boolean;
  note: string;
}

export interface Routine {
  id: string;
  agentId: string;
  name: string;
  prompt: string;
  schedule: Schedule;
  enabled: boolean;
  createdAt: number;
  nextRun: number | null;
  /** Newest first, at most 20. */
  runs: RoutineRun[];
}

export interface Skill {
  id: string;
  name: string;
  /** One line on when to use it: what the helpers see before opening it. */
  description?: string;
  instructions: string;
  updatedAt: number;
  /** Who last wrote it: "You", an agent's name, or "Tutor". */
  by?: string;
  /** Times a helper opened it to follow it. */
  uses?: number;
}

/** A file an agent sent from the host to the student's own devices. */
export interface SentFile {
  id: string;
  name: string;
  size: number;
  at: number;
  agentId: string;
  /** The agent's name when it sent it, for a notification that outlives the agent. */
  from: string;
  chatId: string;
  note?: string;
}

export interface Recipient {
  uid: string;
  name: string;
}

export type ApprovalAction =
  | { kind: "message"; recipients: Recipient[]; subject: string; body: string }
  | { kind: "reply"; threadId: string; subject?: string; body: string };

export type ApprovalStatus = "pending" | "sending" | "sent" | "denied" | "failed";

export type ToolStatus = "running" | "done" | "error";

export type ChatEvent =
  | { id: string; at: number; type: "user"; text: string; images?: string[] }
  | { id: string; at: number; type: "agent"; agentId: string; text: string; streaming?: boolean }
  | { id: string; at: number; type: "thinking"; agentId: string; text: string; streaming?: boolean }
  | { id: string; at: number; type: "tool"; agentId: string; label: string; detail?: string; status: ToolStatus }
  | { id: string; at: number; type: "approval"; agentId: string; action: ApprovalAction; status: ApprovalStatus; result?: string }
  | { id: string; at: number; type: "voice"; agentId: string; file: string; transcript: string }
  | { id: string; at: number; type: "question"; agentId: string; question: string; options: string[] }
  | { id: string; at: number; type: "file"; agentId: string; file: string; name: string; size: number; note?: string }
  | { id: string; at: number; type: "learned"; agentId: string; items: Learned[] }
  /** `from` is an agent's id, or "tutor" for work the School tutor passed on. */
  | { id: string; at: number; type: "handoff"; from: string; to: string; text: string }
  | { id: string; at: number; type: "notice"; text: string; tone?: "info" | "error" };

export type AgentState = "idle" | "working" | "queued";

export interface RosterAgent extends AgentProfile {
  state: AgentState;
  queued: number;
}

export interface ModelChoice {
  id: string;
  label: string;
}

export interface Roster {
  agents: RosterAgent[];
  groups: AgentGroup[];
  routines: Routine[];
  skills: Skill[];
  models: ModelChoice[];
  browser: { running: boolean };
  workspace: string;
  /** The student profile every agent and the tutor share. */
  student: MemoryBookView;
}

/** What the live stream carries. */
export type HubMessage =
  | { kind: "event"; chatId: string; event: ChatEvent }
  | { kind: "state"; agentId: string; state: AgentState; queued: number }
  | { kind: "roster" };

export const DEFAULT_MODEL = "grok-4.7";

export function isChatId(value: string): boolean {
  return /^(agt|grp|thr)_[a-z0-9]{6,40}$/.test(value);
}
