import "server-only";

import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openInTerminal, planName } from "../coding/accounts";
import { USAGE_DIR } from "../store";
import {
  bufferBytes,
  chromiumDecrypt,
  chromiumKey,
  claudeAccountPart,
  claudeEmail,
  claudeOauth,
  devinSession,
  emailFromAgyToken,
  fromGoKeyring,
  toGoKeyring,
  withClaudeAccount,
  type DevinPlan,
} from "./core";
import { readSecret, removeSecret, writeSecret } from "./keychain";
import type { Adapter, LiveLogin, StoredSession } from "./switcher";
import type { SwitchTool } from "./types";

/**
 * Where each tool keeps its everyday sign-in, and how to put another in its
 * place:
 * - Claude Code: a keychain item plus the account's share of ~/.claude.json.
 * - Antigravity (agy): a go-keyring keychain item and the same token in a file.
 * - The Devin app: its encrypted login in VS Code's state database, which only
 *   changes while Devin is closed. It's moved as it is and never decrypted.
 */

const HOME = os.homedir();

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** Writes through a temp file and rename, so a crash leaves the old file, not half a new one. */
function writeAtomic(file: string, text: string, mode: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.slates-${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode });
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, file);
}

function modeOf(file: string, fallback: number): number {
  try {
    return fs.statSync(file).mode & 0o777;
  } catch {
    return fallback;
  }
}

/** Interactive sessions of a CLI. One-shot `-p` runs, like Slates' own usage checks, finish on their own. */
function openSessions(pattern: RegExp): Promise<number> {
  return new Promise((resolve) => {
    execFile("/bin/ps", ["-axww", "-o", "args="], { timeout: 5_000, maxBuffer: 8 << 20 }, (err, out) => {
      if (err) return resolve(0);
      resolve(out.split("\n").filter((line) => pattern.test(line) && !/\s(-p|--print)(\s|$)/.test(line)).length);
    });
  });
}

function places(n: number): string {
  return n === 1 ? "1 place" : `${n} places`;
}

// ── Claude Code ───────────────────────────────────────────────────────────

const CLAUDE_SERVICE = "Claude Code-credentials";
const USER = os.userInfo().username;

function claudeSettingsFile(): string {
  return process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, ".claude.json") : path.join(HOME, ".claude.json");
}

async function claudeLive(): Promise<LiveLogin | null> {
  const credentials = (await readSecret(CLAUDE_SERVICE, USER)) ?? (await readSecret(CLAUDE_SERVICE));
  const oauth = credentials ? claudeOauth(credentials) : null;
  if (!credentials || !oauth) return null;
  const extra = claudeAccountPart(readText(claudeSettingsFile()) ?? "{}");
  const email = claudeEmail(extra);
  if (!email) return null;
  return {
    email,
    plan: planName(oauth.subscriptionType ? `claude_${oauth.subscriptionType}` : null),
    session: { secret: { credentials }, extra },
  };
}

export const claude: Adapter = {
  name: "Claude Code",
  restartNote: "Claude Code uses it from the next time it starts.",
  readLive: claudeLive,
  async install(session: StoredSession) {
    const credentials = session.secret.credentials;
    if (!credentials || !claudeOauth(credentials)) throw new Error("That saved Claude Code login can't be read.");
    const previous = await readSecret(CLAUDE_SERVICE, USER);
    await writeSecret(CLAUDE_SERVICE, USER, credentials);
    try {
      const file = claudeSettingsFile();
      writeAtomic(file, withClaudeAccount(readText(file) ?? "{}", session.extra), modeOf(file, 0o600));
    } catch (err) {
      // A login from one account with the other's settings is worse than no change.
      if (previous) await writeSecret(CLAUDE_SERVICE, USER, previous).catch(() => {});
      throw err;
    }
  },
  async running() {
    const n = await openSessions(/(^|\/)claude(\s|$)|\/\.local\/share\/claude\/versions\/|@anthropic-ai\/claude-code\//);
    return n ? `Claude Code is open in ${places(n)}.` : null;
  },
  async signIn() {
    await openInTerminal("claude auth login");
    return "Terminal is signing Claude Code in. Sign in as the other account and it appears here.";
  },
};

// ── Antigravity ───────────────────────────────────────────────────────────

const AGY_SERVICE = "gemini";
const AGY_ACCOUNT = "antigravity";
const AGY_TOKEN_FILE = path.join(HOME, ".gemini", "antigravity-cli", "antigravity-oauth-token");

function agyBinary(): string {
  const local = path.join(HOME, ".local", "bin", "agy");
  return fs.existsSync(local) ? local : "agy";
}

export const antigravity: Adapter = {
  name: "Antigravity",
  restartNote: "agy uses it from the next time it starts.",
  async readLive() {
    const keychain = await readSecret(AGY_SERVICE, AGY_ACCOUNT);
    const file = readText(AGY_TOKEN_FILE);
    const email = (keychain && emailFromAgyToken(fromGoKeyring(keychain))) || (file && emailFromAgyToken(file)) || null;
    if (!email) return null;
    return { email, plan: null, session: { secret: { keychain: keychain ?? "", file: file ?? "" }, extra: {} } };
  },
  async install(session) {
    const { keychain, file } = session.secret;
    const kcValue = keychain || (file ? toGoKeyring(file) : "");
    const fileText = file || (keychain ? fromGoKeyring(keychain) : "");
    if (!kcValue || !emailFromAgyToken(fileText)) throw new Error("That saved Antigravity login can't be read.");
    const previousKc = await readSecret(AGY_SERVICE, AGY_ACCOUNT);
    const previousFile = readText(AGY_TOKEN_FILE);
    await writeSecret(AGY_SERVICE, AGY_ACCOUNT, kcValue);
    try {
      writeAtomic(AGY_TOKEN_FILE, fileText, 0o600);
    } catch (err) {
      if (previousKc) await writeSecret(AGY_SERVICE, AGY_ACCOUNT, previousKc).catch(() => {});
      if (previousFile != null) writeAtomic(AGY_TOKEN_FILE, previousFile, 0o600);
      throw err;
    }
  },
  async running() {
    const n = await openSessions(/(^|\/)agy(\s|$)/);
    return n ? `agy is open in ${places(n)}.` : null;
  },
  async signIn() {
    // The login is saved by now; agy offers a sign-in once it has none.
    await removeSecret(AGY_SERVICE, AGY_ACCOUNT);
    fs.rmSync(AGY_TOKEN_FILE, { force: true });
    await openInTerminal(agyBinary());
    return "Terminal opened agy. Open the link it prints, sign in as the other account, then quit agy.";
  },
};

// ── the Devin app ─────────────────────────────────────────────────────────

/** Overridable so the tests can switch a copy rather than the app in use. */
export function devinStateDb(): string {
  return process.env.SLATES_DEVIN_STATE_DB || path.join(HOME, "Library", "Application Support", "Devin", "User", "globalStorage", "state.vscdb");
}

const SESSIONS_KEY = 'secret://{"extensionId":"codeium.windsurf","key":"windsurf_auth.sessions"}';
const API_URL_KEY = 'secret://{"extensionId":"codeium.windsurf","key":"windsurf_auth.apiServerUrl"}';
const STATE_KEY = "codeium.windsurf";
const PLAN_PREFIX = "windsurf.reactSettings.cachedPlanInfoData:";

function sqliteRead(db: string, sql: string): Promise<Record<string, string>[] | null> {
  return new Promise((resolve) => {
    execFile("/usr/bin/sqlite3", ["-readonly", "-json", db, sql], { timeout: 8_000, maxBuffer: 16 << 20 }, (err, out) => {
      if (err) return resolve(null);
      try {
        resolve(out.trim() ? (JSON.parse(out) as Record<string, string>[]) : []);
      } catch {
        resolve(null);
      }
    });
  });
}

/** The SQL goes on stdin, so no part of a login is ever an argument. */
function sqliteWrite(db: string, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/sqlite3", [db], { stdio: ["pipe", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (b: Buffer) => (err += b.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 && !err.trim() ? resolve() : reject(new Error(`Couldn't write Devin's settings: ${err.trim() || `exit ${code}`}`))));
    child.stdin.end(sql);
  });
}

const sqlText = (s: string) => `'${s.replace(/'/g, "''")}'`;
const sqlValue = (s: string) => `CAST(X'${Buffer.from(s, "utf8").toString("hex")}' AS TEXT)`;

async function devinRows(): Promise<{ items: Map<string, string>; plans: Map<string, DevinPlan> } | null> {
  const rows = await sqliteRead(
    devinStateDb(),
    `select key, value from ItemTable where key in (${[SESSIONS_KEY, API_URL_KEY, STATE_KEY].map(sqlText).join(",")}) or key like '${PLAN_PREFIX}%'`
  );
  if (!rows) return null;
  const items = new Map<string, string>();
  const plans = new Map<string, DevinPlan>();
  for (const row of rows) {
    if (row.key.startsWith(PLAN_PREFIX)) {
      try {
        plans.set(row.key.slice(PLAN_PREFIX.length), JSON.parse(row.value) as DevinPlan);
      } catch {
        // skip a plan we can't read
      }
    } else {
      items.set(row.key, row.value);
    }
  }
  return { items, plans };
}

/** Every plan the Devin app has cached, one per account it has been signed in as. */
export async function devinPlans(): Promise<DevinPlan[]> {
  return [...((await devinRows())?.plans.values() ?? [])];
}

/**
 * The key Devin encrypts its login with, from its keychain item. macOS asks
 * before `security` may read it, and a refresh in the background must never
 * put a dialog on screen, so it's only read unasked once the student has
 * allowed it from the Switch accounts screen. Until then, and after a
 * refusal, Devin is identified by its last sign-in and shows cached limits.
 */
const KEY_ALLOWED_FILE = path.join(USAGE_DIR, "switch", "devin-key-allowed");
let cipher: { key: Buffer | null; at: number } | null = null;

async function devinKey(ask = false): Promise<Buffer | null> {
  if (cipher?.key) return cipher.key;
  if (!ask && (!fs.existsSync(KEY_ALLOWED_FILE) || (cipher && Date.now() - cipher.at < 10 * 60_000))) return null;
  const password = await readSecret("Devin Safe Storage", "Devin Key", ask ? 90_000 : 8_000);
  cipher = { key: password ? chromiumKey(password) : null, at: Date.now() };
  try {
    if (password) {
      fs.mkdirSync(path.dirname(KEY_ALLOWED_FILE), { recursive: true, mode: 0o700 });
      fs.writeFileSync(KEY_ALLOWED_FILE, "", { mode: 0o600 });
    } else {
      fs.rmSync(KEY_ALLOWED_FILE, { force: true });
    }
  } catch {
    // Remembered for this run either way.
  }
  return cipher.key;
}

/** Asks macOS for Devin's key now, waiting for the student to answer the prompt. */
export async function allowDevinKey(): Promise<boolean> {
  return !!(await devinKey(true));
}

export function devinKeyAccess(): "allowed" | "ask" {
  return cipher?.key || fs.existsSync(KEY_ALLOWED_FILE) ? "allowed" : "ask";
}

export async function openDevinSecret(text: string | undefined): Promise<string | null> {
  if (!text) return null;
  const key = await devinKey();
  return key ? chromiumDecrypt(text, key) : null;
}

function identityEmail(plan: DevinPlan | undefined): string | null {
  const email = (plan?.accountIdentityText ?? "").split(/\s+-\s+/)[0]?.trim() ?? "";
  return email.includes("@") ? email : null;
}

const devinVersion = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync("/Applications/Devin.app/Contents/Resources/app/extensions/windsurf/package.json", "utf8")) as { version?: string };
    return pkg.version || "1.0.0";
  } catch {
    return "1.0.0";
  }
})();

/**
 * Asks Devin's server who a saved or live login is and how much of its plan
 * is left, with that login's own API key, the way the app's status bar does.
 */
export async function devinUserStatus(secret: Record<string, string>): Promise<{ status: number; body: unknown } | null> {
  const opened = await openDevinSecret(secret.sessions);
  const session = opened ? devinSession(opened) : null;
  if (!session) return null;
  let api = "https://server.codeium.com";
  const apiOpened = await openDevinSecret(secret.apiServerUrl);
  if (apiOpened) {
    try {
      const url = JSON.parse(apiOpened) as unknown;
      if (typeof url === "string" && url.startsWith("https://")) api = url;
    } catch {
      if (apiOpened.startsWith("https://")) api = apiOpened;
    }
  }
  const res = await fetch(`${api.replace(/\/$/, "")}/exa.seat_management_pb.SeatManagementService/GetUserStatus`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Connect-Protocol-Version": "1" },
    body: JSON.stringify({
      metadata: { apiKey: session.apiKey, ideName: "windsurf", ideVersion: devinVersion, extensionName: "windsurf", extensionVersion: devinVersion, locale: "en" },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

function devinOpen(): Promise<boolean> {
  return new Promise((resolve) => execFile("/usr/bin/pgrep", ["-x", "Devin"], (err, out) => resolve(!err && !!out.trim())));
}

function parseObject(text: string | undefined): Record<string, unknown> {
  try {
    const v = JSON.parse(text ?? "") as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const devin: Adapter = {
  name: "Devin",
  async readLive() {
    const rows = await devinRows();
    const sessions = rows?.items.get(SESSIONS_KEY);
    // Signed out, the app keeps an encrypted empty list: a few dozen bytes.
    if (!rows || bufferBytes(sessions) < 64) return null;
    const state = parseObject(rows.items.get(STATE_KEY));
    // Who the login belongs to is inside it; "lastLoginEmail" is only who last went through a sign-in.
    const opened = await openDevinSecret(sessions);
    const accountId = opened ? devinSession(opened)?.accountId : undefined;
    const cached = accountId ? rows.plans.get(accountId) : undefined;
    const email = identityEmail(cached) ?? (typeof state.lastLoginEmail === "string" && state.lastLoginEmail ? state.lastLoginEmail : null);
    if (!email) return null;
    return {
      email,
      plan: cached?.planName ?? null,
      session: {
        secret: { sessions: sessions!, apiServerUrl: rows.items.get(API_URL_KEY) ?? "" },
        extra: { lastLoginEmail: email, apiServerUrl: typeof state.apiServerUrl === "string" ? state.apiServerUrl : null },
      },
    };
  },
  async install(session) {
    // A test's copy of the database can be switched with the app open; the app's own can't.
    if (!process.env.SLATES_DEVIN_STATE_DB && (await devinOpen())) throw new Error("Quit Devin first; it keeps its sign-in while it's open.");
    const { sessions, apiServerUrl } = session.secret;
    if (bufferBytes(sessions) < 64) throw new Error("That saved Devin login can't be read.");
    const db = devinStateDb();
    const rows = await devinRows();
    if (!rows) throw new Error("Couldn't open Devin's settings.");
    const state = parseObject(rows.items.get(STATE_KEY));
    state.lastLoginEmail = session.extra.lastLoginEmail;
    if (typeof session.extra.apiServerUrl === "string") state.apiServerUrl = session.extra.apiServerUrl;
    const put = (key: string, value: string) => `INSERT OR REPLACE INTO ItemTable(key, value) VALUES (${sqlText(key)}, ${sqlValue(value)});`;
    // One transaction: the app never opens on half a switch.
    await sqliteWrite(
      db,
      [
        ".bail on",
        "BEGIN IMMEDIATE;",
        put(SESSIONS_KEY, sessions!),
        apiServerUrl ? put(API_URL_KEY, apiServerUrl) : `DELETE FROM ItemTable WHERE key = ${sqlText(API_URL_KEY)};`,
        put(STATE_KEY, JSON.stringify(state)),
        "COMMIT;",
        "",
      ].join("\n")
    );
  },
  async running() {
    return (await devinOpen()) ? "Devin is open." : null;
  },
  app: {
    async quit() {
      await new Promise<void>((resolve) => execFile("/usr/bin/osascript", ["-e", 'tell application "Devin" to quit'], { timeout: 15_000 }, () => resolve()));
      for (let i = 0; i < 60; i++) {
        if (!(await devinOpen())) return;
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error("Devin didn't close. Save your work, quit Devin, then switch again.");
    },
    async open() {
      // Slates' own Electron sets ELECTRON_RUN_AS_NODE, which would start Devin as plain Node.
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      await new Promise<void>((resolve, reject) =>
        execFile("/usr/bin/open", ["-a", "Devin"], { env, timeout: 15_000 }, (err) => (err ? reject(err) : resolve()))
      );
    },
  },
};

export const ADAPTERS: Record<SwitchTool, Adapter> = { claude, antigravity, devin };
