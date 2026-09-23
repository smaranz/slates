/**
 * Shared shapes for the AI Usage ledger and linked plans.
 *
 * The ledger lives under ~/.slates/usage/ so it survives restarts the same way
 * lessons and the counseling library do. Secrets never leave the server.
 */

export type UsageProvider =
  | "openai"
  | "openrouter"
  | "elevenlabs"
  | "claude-code"
  | "cursor";

export type UsageAgent =
  | "tutor"
  | "counselor"
  | "essay"
  | "rubric"
  | "plan"
  | "study"
  | "estimate"
  | "dictation"
  | "voice"
  | "lesson"
  | "narration"
  | "image";

export type PlanKind = "api" | "subscription";

export type UsageUnit = "tokens" | "characters" | "images";

export type UsageRange = "today" | "7d" | "30d" | "all";

/** A linked plan as stored on disk — secrets live in secrets.json, not here. */
export interface UsagePlan {
  id: string;
  provider: UsageProvider;
  label: string;
  kind: PlanKind;
  monthlyUsd: number | null;
  keyHint: string | null;
  active: boolean;
  linkedAt: number;
  source: "linked";
}

/**
 * Synthetic rows the UI shows alongside linked plans — env keys and CLI
 * logins. They are never written to plans.json.
 */
export interface SyntheticPlan {
  id: string;
  provider: UsageProvider;
  label: string;
  kind: PlanKind;
  monthlyUsd: null;
  keyHint: string | null;
  active: boolean;
  linkedAt: null;
  source: "env" | "cli";
  removable: false;
}

export type PublicPlan = (UsagePlan & { removable: true }) | SyntheticPlan;

export interface UsageEvent {
  id: string;
  at: number;
  agent: UsageAgent;
  model: string;
  backend: UsageProvider;
  planId: string | null;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  listUsd: number;
  covered: boolean;
  unit: UsageUnit;
}

export interface AgentRow {
  agent: UsageAgent;
  label: string;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  costUsd: number;
  calls: number;
  providers: {
    provider: UsageProvider;
    label: string;
    status: "active" | "standby" | "missing";
  }[];
}

export interface ModelRow {
  model: string;
  tokens: number;
  costUsd: number;
  calls: number;
}

export interface DayBucket {
  day: string;
  tokens: number;
  costUsd: number;
  calls: number;
}

export interface ConnectionRow {
  agent: UsageAgent;
  label: string;
  providers: AgentRow["providers"];
}

export interface UsageSnapshot {
  range: UsageRange;
  totals: {
    inputTokens: number;
    outputTokens: number;
    tokens: number;
    costUsd: number;
    listUsd: number;
    calls: number;
  };
  monthlyUsd: number;
  byAgent: AgentRow[];
  byModel: ModelRow[];
  recent: UsageEvent[];
  days: DayBucket[];
  plans: PublicPlan[];
  connections: ConnectionRow[];
}

export const ALL_AGENTS: UsageAgent[] = [
  "tutor",
  "counselor",
  "essay",
  "rubric",
  "plan",
  "study",
  "estimate",
  "dictation",
  "voice",
  "lesson",
  "narration",
  "image",
];

export const AGENT_LABEL: Record<UsageAgent, string> = {
  tutor: "Tutor",
  counselor: "Counselor",
  essay: "Essay",
  rubric: "Rubric",
  plan: "Plan",
  study: "Study",
  estimate: "Estimate",
  dictation: "Dictation",
  voice: "Voice",
  lesson: "Lesson",
  narration: "Narration",
  image: "Image",
};

/** Which providers each agent can draw credentials from. */
export const AGENT_PROVIDERS: Record<UsageAgent, UsageProvider[]> = {
  tutor: ["openai", "claude-code", "openrouter", "cursor"],
  counselor: ["openai", "openrouter"],
  essay: ["openai"],
  rubric: ["openai"],
  plan: ["openai", "openrouter"],
  study: ["claude-code"],
  estimate: ["openai"],
  dictation: ["openai"],
  voice: ["openai"],
  lesson: ["openai"],
  narration: ["elevenlabs"],
  image: ["elevenlabs"],
};

export const PROVIDER_LABEL: Record<UsageProvider, string> = {
  openai: "OpenAI",
  openrouter: "OpenRouter",
  elevenlabs: "ElevenLabs",
  "claude-code": "Claude Code",
  cursor: "Cursor",
};

/** Map tutor/counselor backend ids onto usage providers. */
export function backendToProvider(backend: string): UsageProvider {
  if (backend === "cursor-agent") return "cursor";
  if (
    backend === "openai" ||
    backend === "openrouter" ||
    backend === "elevenlabs" ||
    backend === "claude-code" ||
    backend === "cursor"
  ) {
    return backend;
  }
  return "openai";
}
