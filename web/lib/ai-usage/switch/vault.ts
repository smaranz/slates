import "server-only";

import fs from "node:fs";
import path from "node:path";

import { USAGE_DIR } from "../store";
import { readSecret, removeSecret, writeSecret } from "./keychain";
import type { StoredSession, ToolRoster, Vault } from "./switcher";
import type { SwitchTool } from "./types";

/**
 * Where saved accounts are kept. Each login is a keychain item under "Slates
 * accounts", which macOS encrypts and locks with the Mac; what else travels
 * with the account (a slice of Claude Code's settings, say) and the list of
 * accounts are files in ~/.slates/usage/switch that only you can read.
 */

export const SWITCH_DIR = path.join(USAGE_DIR, "switch");
const ROSTER_FILE = path.join(SWITCH_DIR, "roster.json");
const SERVICE = "Slates accounts";

interface RosterFile {
  schema: 1;
  tools: Partial<Record<SwitchTool, ToolRoster>>;
}

function readRoster(): RosterFile {
  try {
    const raw = JSON.parse(fs.readFileSync(ROSTER_FILE, "utf8")) as Partial<RosterFile>;
    return { schema: 1, tools: raw.tools ?? {} };
  } catch {
    return { schema: 1, tools: {} };
  }
}

function writePrivate(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function extraFile(tool: SwitchTool, id: string): string {
  return path.join(SWITCH_DIR, tool, `${id.replace(/[^\w-]/g, "")}.json`);
}

const item = (tool: SwitchTool, id: string) => `${tool}:${id}`;

export const vault: Vault = {
  async roster(tool) {
    return readRoster().tools[tool] ?? { accounts: [], activeId: null };
  },

  async saveRoster(tool, roster) {
    const all = readRoster();
    all.tools[tool] = roster;
    writePrivate(ROSTER_FILE, `${JSON.stringify(all, null, 2)}\n`);
  },

  async load(tool, id): Promise<StoredSession | null> {
    let extra: Record<string, unknown>;
    try {
      extra = JSON.parse(fs.readFileSync(extraFile(tool, id), "utf8")) as Record<string, unknown>;
    } catch {
      return null;
    }
    const raw = await readSecret(SERVICE, item(tool, id));
    if (!raw) return null;
    try {
      // Kept as base64, so `security -w` hands back text whatever the login holds.
      return { secret: JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as Record<string, string>, extra };
    } catch {
      return null;
    }
  },

  async store(tool, id, session) {
    await writeSecret(SERVICE, item(tool, id), Buffer.from(JSON.stringify(session.secret), "utf8").toString("base64"));
    writePrivate(extraFile(tool, id), JSON.stringify(session.extra));
  },

  async discard(tool, id) {
    await removeSecret(SERVICE, item(tool, id));
    fs.rmSync(extraFile(tool, id), { force: true });
  },
};
