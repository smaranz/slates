/**
 * Shapes shared by the coding-usage server and the AI Usage screen.
 *
 * "Coding usage" is everything the CLIs on this machine did — Claude Code,
 * Codex, Gemini CLI, opencode — read straight from their own logs, plus
 * Slates' own ledger so the screen has one total. Nothing here carries a
 * secret; tokens stay inside lib/ai-usage/coding/limits.ts.
 */

export type CodingTool = "claude" | "codex" | "antigravity" | "cursor" | "gemini" | "opencode" | "slates";

/** Tools that support more than one signed-in account through a home dir. */
export type LinkableTool = "claude" | "codex" | "antigravity" | "cursor";

/**
 * Tools whose home we read. Gemini CLI stays a log source for its history,
 * but Google retired its personal sign-in in favour of Antigravity.
 */
export type HomeTool = LinkableTool | "gemini";

export type CodingRange = "today" | "7d" | "30d" | "month" | "all";

export const TOOL_LABEL: Record<CodingTool, string> = {
  claude: "Claude Code",
  codex: "Codex",
  antigravity: "Antigravity",
  cursor: "Cursor",
  gemini: "Gemini CLI",
  opencode: "opencode",
  slates: "Slates",
};

export const TOOL_ORDER: CodingTool[] = ["claude", "codex", "antigravity", "cursor", "gemini", "opencode", "slates"];

export const LINKABLE_TOOLS: LinkableTool[] = ["claude", "codex", "antigravity", "cursor"];

/** One model request, priced. */
export interface CodingRequest {
  id: string;
  at: number;
  tool: CodingTool;
  accountKey: string;
  model: string;
  project: string | null;
  /** Uncached input tokens. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  costUsd: number;
  /** True when the model wasn't on any price list and a family guess was used. */
  estimated: boolean;
}

export interface LimitWindow {
  id: string;
  label: string;
  /** 0–100. */
  usedPct: number;
  resetsAt: number | null;
  /** When the provider says the window opened, if it does (Cursor's billing cycle). */
  startsAt?: number | null;
  /** What the provider itself says was spent in the window, when it reports it. */
  spentUsd?: number | null;
}

export interface AccountLimits {
  windows: LimitWindow[];
  /** "live" from the provider, "log" from the last CLI log line, "none" when we have neither. */
  source: "live" | "log" | "none";
  fetchedAt: number | null;
  plan: string | null;
  /** Why live numbers are missing, in words a person can act on. */
  note: string | null;
}

export interface AccountHomeInfo {
  id: string;
  dir: string;
  owned: boolean;
}

export interface AccountRow {
  key: string;
  tool: CodingTool;
  label: string;
  email: string | null;
  plan: string | null;
  homes: AccountHomeInfo[];
  /** Signed into the tool's default home, i.e. what a plain `claude` uses. */
  inCli: boolean;
  /** A linked home whose login hasn't finished yet. */
  waiting: boolean;
  requests: number;
  tokens: number;
  costUsd: number;
  lastUsedAt: number | null;
  /** False when there are no token counts to show (Antigravity): the card shows limits only. */
  tracksTokens: boolean;
  /**
   * Claude plan size relative to Pro (Team Standard 1.25, Max 5x 5, ...), from
   * the seat and rate-limit tier the login reports. Null when unknown.
   */
  planScale: number | null;
  planScaleLabel: string | null;
  /** Shell command that runs the CLI as this account. */
  command: string | null;
  canLink: boolean;
}

export interface ToolRow {
  tool: CodingTool;
  requests: number;
  tokens: number;
  costUsd: number;
}

export interface CodingDay {
  day: string;
  costUsd: number;
  tokens: number;
  requests: number;
  byTool: Partial<Record<CodingTool, number>>;
}

export interface CodingModelRow {
  model: string;
  tool: CodingTool;
  requests: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
  estimated: boolean;
}

export interface CodingProjectRow {
  project: string;
  requests: number;
  tokens: number;
  costUsd: number;
}

export interface CodingSnapshot {
  range: CodingRange;
  generatedAt: number;
  totals: {
    requests: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    tokens: number;
    costUsd: number;
    avgUsd: number;
  };
  tools: ToolRow[];
  accounts: AccountRow[];
  days: CodingDay[];
  models: CodingModelRow[];
  projects: CodingProjectRow[];
  pricing: { source: "models.dev" | "litellm" | "built-in"; updatedAt: number | null };
  index: { files: number; ms: number };
}

export interface CodingRequestPage {
  total: number;
  rows: (CodingRequest & { accountLabel: string })[];
}

export function tokensOf(r: Pick<CodingRequest, "input" | "output" | "cacheRead" | "cacheWrite">): number {
  return r.input + r.output + r.cacheRead + r.cacheWrite;
}
