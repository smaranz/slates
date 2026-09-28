import type { AccountLimits } from "../coding/types";

/**
 * Switching the everyday sign-in of a coding tool, the way Janus does it for
 * Claude Code: each account's login is parked in a vault, and switching puts
 * another one where the tool looks for it. Shapes here reach the screen, so
 * nothing in them is a secret.
 */

export type SwitchTool = "claude" | "antigravity" | "devin";

export const SWITCH_TOOLS: SwitchTool[] = ["claude", "antigravity", "devin"];

export interface SwitchAccount {
  /** The saved account's id, or "live" for a sign-in that hasn't been saved yet. */
  id: string;
  email: string;
  label: string | null;
  plan: string | null;
  saved: boolean;
  /** Signed into the tool right now. */
  live: boolean;
  lastActiveAt: number | null;
  /** Null until they've been read; limits are slower than the list. */
  limits: AccountLimits | null;
}

export interface SwitchToolState {
  tool: SwitchTool;
  liveEmail: string | null;
  accounts: SwitchAccount[];
  /** Something open that a switch has to deal with, in words, e.g. "Claude Code is open in 2 places." */
  running: string | null;
  /** Devin only: whether Slates may read the key its login is encrypted with, or has to ask first. */
  keyAccess?: "allowed" | "ask";
}

export interface SwitchState {
  tools: SwitchToolState[];
  generatedAt: number;
}

export interface SwitchOutcome {
  headline: string;
  notes: string[];
}
