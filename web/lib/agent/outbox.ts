import "server-only";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AGENT_HOME, newId, WORKSPACE } from "./store";
import type { SentFile } from "./types";

/**
 * Files agents send from the host to the student's own devices.
 *
 * An agent that makes a document on the PC used to leave it there and say
 * where, which is no use from a laptop or a phone. Sending copies it here
 * (so later edits or clean-ups in the workspace don't change what was sent),
 * posts a card in the chat, and the Mac app saves it into Downloads › Slates
 * on its own. The workspace can also be browsed, for files an agent made but
 * didn't send.
 */

export const OUTBOX_DIR = path.join(AGENT_HOME, "outbox");
const INDEX = path.join(AGENT_HOME, "outbox.json");
const MAX_BYTES = 250 * 1024 * 1024;
const KEEP = 500;

function readIndex(): SentFile[] {
  try {
    const items = (JSON.parse(fs.readFileSync(INDEX, "utf8")) as { items?: SentFile[] }).items;
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function writeIndex(items: SentFile[]): void {
  fs.mkdirSync(AGENT_HOME, { recursive: true });
  const tmp = `${INDEX}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ items }, null, 2)}\n`);
  fs.renameSync(tmp, INDEX);
}

export function safeFileName(name: string): string {
  const base = path.basename(name.replace(/\\/g, "/")).replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "_").replace(/^\.+/, "").trim();
  return base.slice(0, 140) || "file";
}

/** Where an agent's path points, relative paths being inside its working folder. */
export function resolveAgentPath(input: string): string {
  const raw = input.trim().replace(/^["']|["']$/g, "");
  const expanded = raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw;
  return path.resolve(WORKSPACE, expanded);
}

/** Never the host's own secrets, whatever an agent is talked into. */
function forbidden(file: string): boolean {
  const home = os.homedir();
  const inside = (dir: string) => file === dir || file.startsWith(dir + path.sep);
  const name = path.basename(file).toLowerCase();
  return (
    name === ".env" ||
    name.startsWith(".env.") ||
    inside(path.join(home, ".ssh")) ||
    inside(path.join(home, ".slates", "devices.json")) ||
    inside(path.join(home, ".slates", "usage", "switch")) ||
    /\.(pem|key|p12|pfx)$/.test(name)
  );
}

export function sendFile(input: { path: string; agentId: string; from: string; chatId: string; note?: string }): SentFile {
  const source = resolveAgentPath(input.path);
  let real: string;
  try {
    real = fs.realpathSync(source);
  } catch {
    throw new Error(`There's no file at ${source}.`);
  }
  const stat = fs.statSync(real);
  if (!stat.isFile()) throw new Error(`${source} is a folder, not a file. Zip it first if the student needs all of it.`);
  if (stat.size > MAX_BYTES) throw new Error(`That file is ${Math.round(stat.size / 1024 / 1024)} MB; the limit is ${MAX_BYTES / 1024 / 1024} MB.`);
  if (forbidden(real)) throw new Error("That file holds the PC's own keys or settings, so it can't be sent.");

  const file: SentFile = {
    id: newId("out"),
    name: safeFileName(path.basename(real)),
    size: stat.size,
    at: Date.now(),
    agentId: input.agentId,
    from: input.from,
    chatId: input.chatId,
    note: input.note?.trim().slice(0, 300) || undefined,
  };
  const dir = path.join(OUTBOX_DIR, file.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(real, path.join(dir, file.name));

  const all = [file, ...readIndex()];
  for (const old of all.slice(KEEP)) fs.rmSync(path.join(OUTBOX_DIR, old.id), { recursive: true, force: true });
  writeIndex(all.slice(0, KEEP));
  return file;
}

/** Newest first. */
export function listSent(since = 0): SentFile[] {
  return readIndex().filter((file) => file.at > since);
}

export function sentFilePath(id: string): { file: SentFile; path: string } | null {
  if (!/^out_[a-z0-9]{6,40}$/.test(id)) return null;
  const file = readIndex().find((entry) => entry.id === id);
  if (!file) return null;
  const full = path.join(OUTBOX_DIR, file.id, file.name);
  return fs.existsSync(full) ? { file, path: full } : null;
}

/* ---------- the workspace ---------- */

export interface WorkspaceFile {
  /** Relative to the workspace, with forward slashes. */
  path: string;
  name: string;
  size: number;
  at: number;
}

const SKIP = new Set(["node_modules", ".git", ".venv", "venv", "__pycache__", ".next", ".cache", "dist", "build", ".playwright-mcp"]);

/** The files agents have made, newest first. */
export function workspaceFiles(limit = 150): WorkspaceFile[] {
  const out: WorkspaceFile[] = [];
  let seen = 0;
  const walk = (dir: string, depth: number) => {
    if (depth > 6 || seen > 5_000) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      seen += 1;
      if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile()) {
        try {
          const stat = fs.statSync(full);
          out.push({ path: path.relative(WORKSPACE, full).split(path.sep).join("/"), name: entry.name, size: stat.size, at: stat.mtimeMs });
        } catch {
          // Gone between listing and reading.
        }
      }
    }
  };
  walk(WORKSPACE, 0);
  return out.sort((a, b) => b.at - a.at).slice(0, limit);
}

/** A workspace file by its relative path, if it really is inside the workspace. */
export function workspaceFilePath(relative: string): string | null {
  if (!relative || relative.includes("\0")) return null;
  const full = path.resolve(WORKSPACE, relative);
  try {
    const real = fs.realpathSync(full);
    const root = fs.realpathSync(WORKSPACE);
    if (!(real === root || real.startsWith(root + path.sep)) || forbidden(real) || !fs.statSync(real).isFile()) return null;
    return real;
  } catch {
    return null;
  }
}
