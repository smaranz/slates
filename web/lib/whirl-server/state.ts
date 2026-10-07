import "server-only";

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { AGENT_HOME } from "@/lib/agent/store";

/**
 * What the Agent app's interface remembers that the agents themselves don't:
 * sidebar folders, the "how should agents talk to me" preferences, favourite
 * models, the composer's last toggles, answers given to agents' questions.
 * One small JSON file beside the agents' own data.
 */

export interface Folder {
  id: string;
  name: string;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export type Starter = { prompt: string; icon: string };

export interface UiState {
  folders: Folder[];
  preferences: { text: string; updatedAt: number } | null;
  favorites: string[] | null;
  gates: { search: boolean; thinking: string } | null;
  /** Answers to agents' ask_user questions, by event id. */
  answers: Record<string, unknown[]>;
  /** Home starter cards: the two showing, and the queue behind them. */
  starters?: { visible: Starter[]; reserve: Starter[] };
  /** Uploaded attachments waiting to be sent: storage id → file on disk. */
  uploads: Record<string, { file: string; type: string; size: number; at: number }>;
}

const FILE = path.join(AGENT_HOME, "whirl.json");
export const UPLOADS_DIR = path.join(AGENT_HOME, "uploads");

const EMPTY: UiState = { folders: [], preferences: null, favorites: null, gates: null, answers: {}, uploads: {} };

export function readState(): UiState {
  try {
    return { ...EMPTY, ...(JSON.parse(fs.readFileSync(FILE, "utf8")) as Partial<UiState>) };
  } catch {
    return { ...EMPTY };
  }
}

export function writeState(patch: (state: UiState) => UiState): UiState {
  const next = patch(readState());
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  fs.renameSync(tmp, FILE);
  return next;
}

export function newKey(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${randomBytes(5).toString("hex")}`;
}

/** Uploads not sent within a day are dropped. */
export function pruneUploads(): void {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const state = readState();
  const stale = Object.entries(state.uploads).filter(([, u]) => u.at < cutoff);
  if (!stale.length) return;
  for (const [, upload] of stale) fs.rmSync(path.join(UPLOADS_DIR, upload.file), { force: true });
  writeState((s) => ({ ...s, uploads: Object.fromEntries(Object.entries(s.uploads).filter(([, u]) => u.at >= cutoff)) }));
}
