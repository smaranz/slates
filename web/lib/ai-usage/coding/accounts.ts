import "server-only";

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { USAGE_DIR } from "../store";
import type { HomeTool, LinkableTool } from "./types";

/**
 * Accounts for the coding CLIs.
 *
 * Every CLI keeps its login in one directory, and every CLI lets you point it
 * at another one: CLAUDE_CONFIG_DIR, CODEX_HOME, and for Antigravity's `agy`
 * and `cursor-agent`, HOME itself — both keep their login in the keychain,
 * and macOS's `security` follows HOME to a separate keychain file. So a second
 * account is just a second home. Slates makes one under ~/.slates/usage/homes,
 * opens Terminal on that CLI's login, and from then on reads both homes — the
 * one you use every day never gets signed out.
 *
 * The default home can change hands (you log out and in as someone else), so
 * we note who it belonged to over time and attribute its logs by date.
 */

const HOME = os.homedir();
const HOMES_DIR = path.join(USAGE_DIR, "homes");
const ACCOUNTS_FILE = path.join(USAGE_DIR, "coding-accounts.json");

export interface Home {
  id: string;
  tool: HomeTool;
  /** CLAUDE_CONFIG_DIR / CODEX_HOME, or the HOME that Antigravity and Gemini CLI run under. */
  dir: string;
  owned: boolean;
  createdAt: number;
}

export interface Identity {
  email: string;
  plan: string | null;
  name: string | null;
  /** Claude: seat and rate-limit tier, which say how big the plan is. */
  seatTier?: string | null;
  rateTier?: string | null;
}

/**
 * Claude plans relative to Pro, as Anthropic sizes them: Team Standard seats
 * get 1.25× Pro, Team Premium 6.25×, Max 5× and 20×.
 */
export function claudeScale(id: Identity | null): { scale: number; label: string } | null {
  if (!id) return null;
  const seat = id.seatTier ?? "";
  const tier = id.rateTier ?? "";
  if (/max_20x/.test(tier)) return { scale: 20, label: "Max 20×" };
  if (/max_5x/.test(tier)) return { scale: 5, label: "Max 5×" };
  if (seat === "team_premium") return { scale: 6.25, label: "Team Premium" };
  if (seat === "team_standard") return { scale: 1.25, label: "Team Standard" };
  if (id.plan === "Pro") return { scale: 1, label: "Pro" };
  return null;
}

interface AccountsFile {
  homes: Omit<Home, "owned">[];
  meta: Record<string, { label?: string }>;
  timeline: Partial<Record<HomeTool, { at: number; email: string }[]>>;
}

function readFile(): AccountsFile {
  try {
    const raw = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8")) as Partial<AccountsFile>;
    return { homes: raw.homes ?? [], meta: raw.meta ?? {}, timeline: raw.timeline ?? {} };
  } catch {
    return { homes: [], meta: {}, timeline: {} };
  }
}

function writeFile(data: AccountsFile): void {
  fs.mkdirSync(USAGE_DIR, { recursive: true });
  const tmp = `${ACCOUNTS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, ACCOUNTS_FILE);
}

export const DEFAULT_HOMES: Home[] = [
  { id: "default-claude", tool: "claude", dir: process.env.CLAUDE_CONFIG_DIR || path.join(HOME, ".claude"), owned: false, createdAt: 0 },
  { id: "default-codex", tool: "codex", dir: process.env.CODEX_HOME || path.join(HOME, ".codex"), owned: false, createdAt: 0 },
  { id: "default-antigravity", tool: "antigravity", dir: HOME, owned: false, createdAt: 0 },
  { id: "default-cursor", tool: "cursor", dir: HOME, owned: false, createdAt: 0 },
  { id: "default-gemini", tool: "gemini", dir: HOME, owned: false, createdAt: 0 },
];

export function allHomes(): Home[] {
  // Gemini CLI can no longer sign personal accounts in, so a linked Gemini
  // home could only ever sit waiting; its history is read from ~ regardless.
  const linked = readFile()
    .homes.filter((h) => h.tool !== "gemini")
    .map((h) => ({ ...h, owned: true }));
  return [...DEFAULT_HOMES, ...linked];
}

export function isDefault(home: Home): boolean {
  return !home.owned;
}

/** Where the tool keeps its dotfiles inside a home. */
export function dotDir(home: Home): string {
  if (home.tool === "gemini") return path.join(home.dir, ".gemini");
  if (home.tool === "antigravity") return path.join(home.dir, ".gemini", "antigravity-cli");
  if (home.tool === "cursor") return path.join(home.dir, ".cursor");
  return home.dir;
}

/**
 * `agy` keeps no account file; its login lives in the keychain. It does log
 * "authenticated successfully as <email>" on every start, so the newest log
 * that says so names the account.
 */
function antigravityIdentity(home: Home): Identity | null {
  const dir = path.join(dotDir(home), "log");
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".log")).sort().reverse().slice(0, 8);
  } catch {
    return null;
  }
  for (const f of files) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(dir, f), "utf8");
    } catch {
      continue;
    }
    const all = [...text.matchAll(/authenticated successfully as ([^\s,]+@[^\s,]+)/g)];
    const email = all[all.length - 1]?.[1];
    if (email) return { email, plan: null, name: null };
  }
  return null;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function jwtClaims(token: string | undefined): Record<string, unknown> | null {
  if (!token) return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const PLAN_NAMES: Record<string, string> = {
  claude_pro: "Pro",
  claude_max: "Max",
  claude_team: "Team",
  claude_enterprise: "Enterprise",
  plus: "Plus",
  pro: "Pro",
  team: "Team",
  business: "Business",
  enterprise: "Enterprise",
  free: "Free",
};

export function planName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return PLAN_NAMES[raw] ?? raw.replace(/^claude_/, "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Who is signed into a home right now, from the CLI's own files. */
export function identityOf(home: Home): Identity | null {
  if (home.tool === "claude") {
    // The default install keeps .claude.json beside ~/.claude, not inside it.
    const file = home.owned || process.env.CLAUDE_CONFIG_DIR
      ? path.join(home.dir, ".claude.json")
      : path.join(HOME, ".claude.json");
    const cfg = readJson<{
      oauthAccount?: {
        emailAddress?: string;
        organizationType?: string;
        displayName?: string;
        seatTier?: string | null;
        organizationRateLimitTier?: string | null;
        userRateLimitTier?: string | null;
      };
    }>(file);
    const acct = cfg?.oauthAccount;
    if (!acct?.emailAddress) return null;
    return {
      email: acct.emailAddress,
      plan: planName(acct.organizationType),
      name: acct.displayName ?? null,
      seatTier: acct.seatTier ?? null,
      rateTier: acct.userRateLimitTier ?? acct.organizationRateLimitTier ?? null,
    };
  }
  if (home.tool === "codex") {
    const auth = readJson<{ tokens?: { id_token?: string } }>(path.join(home.dir, "auth.json"));
    const claims = jwtClaims(auth?.tokens?.id_token);
    const email = typeof claims?.email === "string" ? claims.email : null;
    if (!email) return null;
    const oa = (claims?.["https://api.openai.com/auth"] ?? {}) as { chatgpt_plan_type?: string };
    return { email, plan: planName(oa.chatgpt_plan_type), name: null };
  }
  if (home.tool === "antigravity") return antigravityIdentity(home);
  if (home.tool === "cursor") {
    // cursor-agent caches who it's signed in as beside its settings.
    const cfg = readJson<{ authInfo?: { email?: string; displayName?: string } }>(path.join(dotDir(home), "cli-config.json"));
    return cfg?.authInfo?.email ? { email: cfg.authInfo.email, plan: null, name: cfg.authInfo.displayName ?? null } : null;
  }
  const accts = readJson<{ active?: string }>(path.join(dotDir(home), "google_accounts.json"));
  if (accts?.active) return { email: accts.active, plan: null, name: null };
  // Older gemini builds only wrote the id token.
  const creds = readJson<{ id_token?: string }>(path.join(dotDir(home), "oauth_creds.json"));
  const claims = jwtClaims(creds?.id_token);
  return typeof claims?.email === "string" ? { email: claims.email, plan: null, name: null } : null;
}

export function accountKey(tool: string, email: string): string {
  return `${tool}:${email.toLowerCase()}`;
}

/**
 * Record who the default homes belong to now. Called on every snapshot, so a
 * switch shows up the next time the screen is opened.
 */
export function noteDefaultOwners(): void {
  const data = readFile();
  let changed = false;
  for (const home of DEFAULT_HOMES) {
    const id = identityOf(home);
    if (!id) continue;
    const list = (data.timeline[home.tool] ??= []);
    const last = list[list.length - 1];
    if (!last || last.email.toLowerCase() !== id.email.toLowerCase()) {
      list.push({ at: Date.now(), email: id.email });
      changed = true;
    }
  }
  if (changed) writeFile(data);
}

/** Which email owned a default home at a moment. Earliest owner covers history before we started watching. */
export function defaultOwnerAt(tool: HomeTool, at: number, timeline = readFile().timeline): string | null {
  const list = timeline[tool];
  if (!list?.length) return null;
  let owner = list[0]!.email;
  for (const entry of list) {
    if (entry.at <= at) owner = entry.email;
    else break;
  }
  return owner;
}

export function timeline(): AccountsFile["timeline"] {
  return readFile().timeline;
}

export function accountMeta(): AccountsFile["meta"] {
  return readFile().meta;
}

export function setAccountMeta(key: string, patch: { label?: string }): void {
  const data = readFile();
  const cur = data.meta[key] ?? {};
  if (patch.label !== undefined) {
    const label = patch.label.trim().slice(0, 40);
    if (label) cur.label = label;
    else delete cur.label;
  }
  data.meta[key] = cur;
  writeFile(data);
}

/**
 * A name typed while linking is saved against the home, since the
 * email isn't known until the login finishes. Carry them over once it is.
 */
export function adoptHomeMeta(homeId: string, key: string): void {
  const data = readFile();
  const pending = data.meta[`home:${homeId}`];
  if (!pending) return;
  data.meta[key] = { ...pending, ...data.meta[key] };
  delete data.meta[`home:${homeId}`];
  writeFile(data);
}

/** Make a fresh home for a second account. */
export function createHome(tool: LinkableTool): Home {
  const data = readFile();
  const id = `${tool}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const dir = path.join(HOMES_DIR, id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Antigravity and Cursor run with this folder as HOME, so their shell tools would lose
  // your git identity, SSH keys and tool config. Point those back at the real ones.
  if (tool === "antigravity" || tool === "cursor") {
    for (const name of [".gitconfig", ".ssh", ".config", ".npmrc", ".zshrc", ".zprofile"]) {
      const src = path.join(HOME, name);
      if (!fs.existsSync(src)) continue;
      try {
        fs.symlinkSync(src, path.join(dir, name));
      } catch {
        // Already there, or not ours to link.
      }
    }
  }
  const home = { id, tool, dir, createdAt: Date.now() };
  data.homes.push(home);
  writeFile(data);
  return { ...home, owned: true };
}

/**
 * Forget a linked home. The directory goes to the Trash rather than being
 * deleted, since it holds that account's session history.
 */
export function removeHome(id: string): boolean {
  const data = readFile();
  const home = data.homes.find((h) => h.id === id);
  if (!home) return false;
  data.homes = data.homes.filter((h) => h.id !== id);
  writeFile(data);
  if (home.dir.startsWith(HOMES_DIR)) {
    const trash = path.join(HOME, ".Trash", `slates-${id}-${Date.now()}`);
    try {
      fs.renameSync(home.dir, trash);
    } catch {
      // Leaving the folder behind is harmless.
    }
  }
  return true;
}

export function homeById(id: string): Home | null {
  return allHomes().find((h) => h.id === id) ?? null;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function envPrefix(home: Home): string {
  if (!home.owned) return "";
  if (home.tool === "claude") return `CLAUDE_CONFIG_DIR=${shellQuote(home.dir)} `;
  if (home.tool === "codex") return `CODEX_HOME=${shellQuote(home.dir)} `;
  return `HOME=${shellQuote(home.dir)} `;
}

const BIN: Record<HomeTool, string> = { claude: "claude", codex: "codex", antigravity: "agy", cursor: "cursor-agent", gemini: "gemini" };

/** The command that runs the CLI as this home's account. */
export function runCommand(home: Home): string {
  return `${envPrefix(home)}${BIN[home.tool]}`;
}

export function loginCommand(home: Home): string {
  if (home.tool === "claude") return `${envPrefix(home)}claude auth login`;
  if (home.tool === "codex") return `${envPrefix(home)}codex login`;
  if (home.tool === "cursor") return `${envPrefix(home)}cursor-agent login`;
  // agy asks you to sign in on first start (it prints a link); exit once you're in.
  return `${envPrefix(home)}agy`;
}

/** Open Terminal.app and run a command in a new window. */
export function openInTerminal(command: string): Promise<void> {
  const script = `tell application "Terminal"
  activate
  do script ${JSON.stringify(command)}
end tell`;
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/osascript", ["-e", script], { timeout: 10_000 }, (err) => {
      if (err) reject(new Error("Couldn't open Terminal. Allow Slates to control Terminal in System Settings → Privacy & Security → Automation."));
      else resolve();
    });
  });
}
