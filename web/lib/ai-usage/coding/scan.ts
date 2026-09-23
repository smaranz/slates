import "server-only";

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readEvents, USAGE_DIR } from "../store";
import { allHomes, dotDir, type Home } from "./accounts";
import { appSession, fetchEvents } from "./cursor";

/**
 * Incremental index of every CLI's request log.
 *
 * Claude Code and Codex append JSONL forever — Codex alone is over a gigabyte
 * here — so each file remembers the byte offset it was read to, and only the
 * lines carrying usage are ever decoded. The index is kept in memory and
 * mirrored to ~/.slates/usage/index-v1.json so a restart doesn't re-read it all.
 */

const INDEX_FILE = path.join(USAGE_DIR, "index-v1.json");
const RESCAN_MS = 8_000;
const CHUNK = 16 * 1024 * 1024;

/**
 * [id, at, model, input, output, cacheRead, cacheWrite5m, cacheWrite1h, reasoning, fast, project, reportedUsd?]
 * The last slot is set when the provider itself priced the request (Cursor).
 */
export type RawReq = [string, number, string, number, number, number, number, number, number, 0 | 1, string | null, number?];

export interface RateLimitSnap {
  at: number;
  plan: string | null;
  windows: { minutes: number; usedPct: number; resetsAt: number | null }[];
}

interface FileEntry {
  tool: "claude" | "codex" | "gemini";
  homeId: string;
  size: number;
  mtime: number;
  offset: number;
  model: string | null;
  project: string | null;
  lastTotal: number | null;
  reqs: RawReq[];
}

interface CursorStore {
  fetchedAt: number;
  newest: number;
  reqs: RawReq[];
}

interface IndexData {
  version: 1;
  files: Record<string, FileEntry>;
  limits: Record<string, RateLimitSnap>;
  opencode: { stamp: number; reqs: RawReq[] };
  /** Cursor's dashboard events, by account email. */
  cursor?: Record<string, CursorStore>;
}

export interface ScanResult {
  /** Requests grouped by where they came from. */
  groups: {
    tool: "claude" | "codex" | "gemini" | "cursor" | "opencode" | "slates";
    homeId: string | null;
    /** Set when the source already knows the account (Cursor's dashboard). */
    accountKey?: string;
    reqs: RawReq[];
  }[];
  limits: Record<string, RateLimitSnap>;
  files: number;
  ms: number;
}

let data: IndexData | null = null;
let lastScan = 0;
let running: Promise<void> | null = null;
let dirty = false;

function load(): IndexData {
  if (data) return data;
  try {
    const raw = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8")) as IndexData;
    if (raw.version === 1 && raw.files) data = { ...raw, limits: raw.limits ?? {}, opencode: raw.opencode ?? { stamp: 0, reqs: [] } };
  } catch {
    // First run, or an index from an older build.
  }
  data ??= { version: 1, files: {}, limits: {}, opencode: { stamp: 0, reqs: [] } };
  return data;
}

let writing: Promise<void> = Promise.resolve();

/** Mirror the index to disk. Writes are chained so two scans never race on the rename. */
function persist(): Promise<void> {
  if (!dirty || !data) return writing;
  dirty = false;
  const snapshot = JSON.stringify(data);
  const tmp = `${INDEX_FILE}.${process.pid}.tmp`;
  writing = writing
    .then(() => fs.promises.mkdir(USAGE_DIR, { recursive: true }))
    .then(() => fs.promises.writeFile(tmp, snapshot))
    .then(() => fs.promises.rename(tmp, INDEX_FILE))
    .catch((err) => console.error("[ai-usage] index write failed", err));
  return writing;
}

/** Resolves once pending index writes have landed. */
export function flushIndex(): Promise<void> {
  return writing;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function listFiles(root: string, test: (name: string) => boolean): string[] {
  try {
    const names = fs.readdirSync(root, { recursive: true }) as string[];
    return names.filter(test).map((n) => path.join(root, n));
  } catch {
    return [];
  }
}

function filesFor(home: Home): string[] {
  // Antigravity keeps no token counts on disk; its cards show live limits only.
  if (home.tool === "antigravity" || home.tool === "cursor") return [];
  const dot = dotDir(home);
  if (home.tool === "claude") {
    const roots = [path.join(dot, "projects")];
    // Newer installs on XDG paths.
    if (!home.owned) roots.push(path.join(os.homedir(), ".config", "claude", "projects"));
    return roots.flatMap((r) => listFiles(r, (n) => n.endsWith(".jsonl")));
  }
  if (home.tool === "codex") {
    return [
      ...listFiles(path.join(dot, "sessions"), (n) => n.endsWith(".jsonl")),
      ...listFiles(path.join(dot, "archived_sessions"), (n) => n.endsWith(".jsonl")),
    ];
  }
  return listFiles(path.join(dot, "tmp"), (n) => /[/\\]chats[/\\][^/\\]+\.jsonl?$/.test(n));
}

const NL = 10;

/**
 * Walk complete lines from `start`, decoding only lines that contain a marker.
 * Returns the offset just past the last complete line.
 */
async function readLines(
  file: string,
  start: number,
  end: number,
  markers: Buffer[],
  onLine: (line: string) => void
): Promise<number> {
  const fh = await fs.promises.open(file, "r");
  try {
    let pos = start;
    let carry: Buffer | null = null;
    let consumed = start;
    while (pos < end) {
      const len = Math.min(CHUNK, end - pos);
      const chunk = Buffer.allocUnsafe(len);
      const { bytesRead } = await fh.read(chunk, 0, len, pos);
      if (bytesRead <= 0) break;
      pos += bytesRead;
      const buf: Buffer = carry ? Buffer.concat([carry, chunk.subarray(0, bytesRead)]) : chunk.subarray(0, bytesRead);
      let lineStart = 0;
      for (;;) {
        const nl = buf.indexOf(NL, lineStart);
        if (nl === -1) break;
        const line = buf.subarray(lineStart, nl);
        if (markers.some((m) => line.indexOf(m) !== -1)) onLine(line.toString("utf8"));
        consumed += nl + 1 - lineStart;
        lineStart = nl + 1;
      }
      carry = lineStart < buf.length ? Buffer.from(buf.subarray(lineStart)) : null;
    }
    return consumed;
  } finally {
    await fh.close();
  }
}

const CLAUDE_MARKERS = [Buffer.from('"output_tokens"')];
const CODEX_MARKERS = [Buffer.from('"token_count"'), Buffer.from('"turn_context"'), Buffer.from('"session_meta"')];

async function scanClaude(file: string, entry: FileEntry, end: number): Promise<void> {
  // One reply is written as several lines (one per content block) sharing a
  // message id; the last one carries the final output count.
  const byId = new Map<string, number>();
  entry.reqs.forEach((r, i) => byId.set(r[0], i));
  entry.offset = await readLines(file, entry.offset, end, CLAUDE_MARKERS, (line) => {
    let d: {
      type?: string;
      timestamp?: string;
      cwd?: string;
      requestId?: string;
      message?: { id?: string; model?: string; usage?: Record<string, unknown> };
    };
    try {
      d = JSON.parse(line);
    } catch {
      return;
    }
    if (d.type !== "assistant" || !d.message?.usage) return;
    const m = d.message;
    const model = m.model ?? "unknown";
    if (model === "<synthetic>") return;
    const u = m.usage as Record<string, unknown>;
    const cc = (u.cache_creation ?? {}) as Record<string, unknown>;
    const write = num(u.cache_creation_input_tokens);
    const w1h = num(cc.ephemeral_1h_input_tokens);
    const w5m = cc.ephemeral_5m_input_tokens != null ? num(cc.ephemeral_5m_input_tokens) : Math.max(0, write - w1h);
    const details = (u.output_tokens_details ?? {}) as Record<string, unknown>;
    const at = Date.parse(d.timestamp ?? "") || entry.mtime;
    if (d.cwd) entry.project = d.cwd;
    const id = m.id ?? d.requestId ?? `${path.basename(file)}:${at}`;
    const row: RawReq = [
      id,
      at,
      model,
      num(u.input_tokens),
      num(u.output_tokens),
      num(u.cache_read_input_tokens),
      w5m,
      w1h,
      num(details.thinking_tokens),
      u.speed === "fast" ? 1 : 0,
      d.cwd ?? entry.project,
    ];
    const prev = byId.get(id);
    if (prev != null) entry.reqs[prev] = row;
    else {
      byId.set(id, entry.reqs.length);
      entry.reqs.push(row);
    }
  });
}

async function scanCodex(file: string, entry: FileEntry, end: number, limits: IndexData["limits"]): Promise<void> {
  const base = path.basename(file, ".jsonl");
  entry.offset = await readLines(file, entry.offset, end, CODEX_MARKERS, (line) => {
    let d: { timestamp?: string; type?: string; payload?: Record<string, unknown> };
    try {
      d = JSON.parse(line);
    } catch {
      return;
    }
    const p = d.payload ?? {};
    if (d.type === "session_meta") {
      if (typeof p.cwd === "string") entry.project = p.cwd;
      if (typeof p.model === "string") entry.model = p.model;
      return;
    }
    if (d.type === "turn_context") {
      if (typeof p.model === "string") entry.model = p.model;
      if (typeof p.cwd === "string") entry.project = p.cwd;
      return;
    }
    if (p.type !== "token_count") return;
    const at = Date.parse(d.timestamp ?? "") || entry.mtime;
    const rl = p.rate_limits as
      | { plan_type?: string; primary?: Record<string, unknown>; secondary?: Record<string, unknown> }
      | undefined;
    if (rl && (rl.primary || rl.secondary)) {
      const prev = limits[entry.homeId];
      if (!prev || prev.at <= at) {
        limits[entry.homeId] = {
          at,
          plan: rl.plan_type ?? null,
          windows: [rl.primary, rl.secondary]
            .filter((w): w is Record<string, unknown> => !!w)
            .map((w) => ({
              minutes: num(w.window_minutes),
              usedPct: num(w.used_percent),
              resetsAt: w.resets_at ? num(w.resets_at) * 1000 : null,
            })),
        };
      }
    }
    const info = p.info as { total_token_usage?: Record<string, unknown>; last_token_usage?: Record<string, unknown> } | null;
    const last = info?.last_token_usage;
    if (!last) return;
    // The same count is re-emitted when only the rate limits changed.
    const total = num(info?.total_token_usage?.total_tokens);
    if (total && total === entry.lastTotal) return;
    entry.lastTotal = total || entry.lastTotal;
    const input = num(last.input_tokens);
    const cached = num(last.cached_input_tokens);
    entry.reqs.push([
      `${base}:${at}:${total}`,
      at,
      entry.model ?? "gpt-5-codex",
      Math.max(0, input - cached),
      num(last.output_tokens),
      cached,
      num(last.cache_write_input_tokens),
      0,
      num(last.reasoning_output_tokens),
      0,
      entry.project,
    ]);
  });
}

async function scanGemini(file: string, entry: FileEntry): Promise<void> {
  // Chat files are rewritten in place, so they are always read whole.
  const text = await fs.promises.readFile(file, "utf8");
  let msgs: Record<string, unknown>[] = [];
  let projectHash: string | null = null;
  try {
    const d = JSON.parse(text) as { messages?: Record<string, unknown>[]; projectHash?: string };
    msgs = d.messages ?? [];
    projectHash = d.projectHash ?? null;
  } catch {
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        msgs.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // skip
      }
    }
  }
  const byId = new Map<string, RawReq>();
  const project = projectHash ?? path.basename(path.dirname(path.dirname(file)));
  for (const m of msgs) {
    const t = m.tokens as Record<string, unknown> | undefined;
    if (!t || m.type !== "gemini") continue;
    const id = String(m.id ?? `${path.basename(file)}:${byId.size}`);
    const cached = num(t.cached);
    byId.set(id, [
      id,
      Date.parse(String(m.timestamp ?? "")) || entry.mtime,
      String(m.model ?? "gemini"),
      Math.max(0, num(t.input) - cached),
      num(t.output) + num(t.thoughts),
      cached,
      0,
      0,
      num(t.thoughts),
      0,
      // Gemini names folders by a hash of the path unless it has a short name.
      /^[0-9a-f]{64}$/.test(project) ? null : project,
    ]);
  }
  entry.reqs = [...byId.values()];
  entry.offset = entry.size;
}

async function scanHome(home: Home, idx: IndexData, seen: Set<string>): Promise<void> {
  // Antigravity keeps no token counts; Cursor's come from its dashboard instead.
  if (home.tool === "antigravity" || home.tool === "cursor") return;
  const tool = home.tool;
  for (const file of filesFor(home)) {
    seen.add(file);
    let st: fs.Stats;
    try {
      st = fs.statSync(file);
    } catch {
      continue;
    }
    let entry = idx.files[file];
    if (entry && entry.size === st.size && entry.mtime === st.mtimeMs) continue;
    if (!entry || st.size < entry.offset || entry.homeId !== home.id) {
      entry = {
        tool,
        homeId: home.id,
        size: 0,
        mtime: 0,
        offset: 0,
        model: null,
        project: null,
        lastTotal: null,
        reqs: [],
      };
      idx.files[file] = entry;
    }
    entry.size = st.size;
    entry.mtime = st.mtimeMs;
    try {
      if (tool === "claude") await scanClaude(file, entry, st.size);
      else if (tool === "codex") await scanCodex(file, entry, st.size, idx.limits);
      else await scanGemini(file, entry);
    } catch (err) {
      console.error("[ai-usage] scan failed", file, err);
    }
    dirty = true;
  }
}

const OPENCODE_DB = path.join(os.homedir(), ".local", "share", "opencode", "opencode.db");

function sqliteJson(db: string, sql: string): Promise<Record<string, unknown>[]> {
  return new Promise((resolve) => {
    execFile(
      "/usr/bin/sqlite3",
      ["-readonly", "-json", db, sql],
      { maxBuffer: 256 * 1024 * 1024, timeout: 20_000 },
      (err, stdout) => {
        if (err) return resolve([]);
        try {
          resolve(stdout.trim() ? (JSON.parse(stdout) as Record<string, unknown>[]) : []);
        } catch {
          resolve([]);
        }
      }
    );
  });
}

async function scanOpencode(idx: IndexData): Promise<void> {
  let stamp = 0;
  for (const f of [OPENCODE_DB, `${OPENCODE_DB}-wal`]) {
    try {
      stamp = Math.max(stamp, fs.statSync(f).mtimeMs);
    } catch {
      // absent
    }
  }
  if (!stamp || stamp === idx.opencode.stamp) return;
  const rows = await sqliteJson(
    OPENCODE_DB,
    `select id, time_created as at, json_extract(data,'$.modelID') as model, json_extract(data,'$.providerID') as provider,
       json_extract(data,'$.cost') as cost, json_extract(data,'$.path.cwd') as cwd,
       json_extract(data,'$.tokens.input') as input, json_extract(data,'$.tokens.output') as output,
       json_extract(data,'$.tokens.reasoning') as reasoning, json_extract(data,'$.tokens.cache.read') as cacheRead,
       json_extract(data,'$.tokens.cache.write') as cacheWrite
     from message where json_extract(data,'$.role') = 'assistant' and json_extract(data,'$.tokens') is not null`
  );
  idx.opencode = {
    stamp,
    reqs: rows
      .filter((r) => num(r.input) + num(r.output) + num(r.cacheRead) + num(r.cacheWrite) > 0)
      .map((r) => [
        String(r.id),
        num(r.at),
        String(r.model ?? "unknown"),
        num(r.input),
        num(r.output) + num(r.reasoning),
        num(r.cacheRead),
        num(r.cacheWrite),
        0,
        num(r.reasoning),
        0,
        typeof r.cwd === "string" ? r.cwd : null,
      ]),
  };
  dirty = true;
}

async function scan(): Promise<void> {
  const idx = load();
  const seen = new Set<string>();
  for (const home of allHomes()) await scanHome(home, idx, seen);
  for (const file of Object.keys(idx.files)) {
    if (!seen.has(file)) {
      delete idx.files[file];
      dirty = true;
    }
  }
  await scanOpencode(idx);
  void persist();
}

const CURSOR_EVERY_MS = 10 * 60_000;
let cursorRunning: Promise<void> | null = null;

/**
 * Pull new Cursor dashboard events for the account signed into the Cursor
 * app. Overlaps the last fetch by an hour, since events land late.
 */
function refreshCursor(idx: IndexData, force: boolean): Promise<void> {
  if (cursorRunning) return cursorRunning;
  cursorRunning = (async () => {
    const session = await appSession();
    if (!session) return;
    const key = session.email.toLowerCase();
    const store = (idx.cursor ??= {})[key];
    if (!force && store && Date.now() - store.fetchedAt < CURSOR_EVERY_MS) return;
    const since = store ? store.newest - 60 * 60_000 : 0;
    const fresh = await fetchEvents(session, since);
    if (!fresh) return;
    const byId = new Map((store?.reqs ?? []).map((r) => [r[0], r]));
    for (const r of fresh) byId.set(r[0], r);
    const reqs = [...byId.values()];
    idx.cursor![key] = { fetchedAt: Date.now(), newest: Math.max(store?.newest ?? 0, ...reqs.map((r) => r[1])), reqs };
    dirty = true;
    void persist();
  })()
    .catch((err) => console.error("[ai-usage] cursor fetch failed", err))
    .finally(() => {
      cursorRunning = null;
    });
  return cursorRunning;
}

/** Bring the index up to date (throttled) and return every request. */
export async function scanAll(force = false): Promise<ScanResult> {
  const started = Date.now();
  if (running) await running;
  else if (force || Date.now() - lastScan > RESCAN_MS) {
    running = scan().finally(() => {
      lastScan = Date.now();
      running = null;
    });
    await running;
  }
  const idx = load();
  // Cursor lives on the network: the Refresh button waits for it, and so does
  // the very first read (otherwise its card opens empty); polling doesn't.
  const firstCursor = !idx.cursor || Object.keys(idx.cursor).length === 0;
  const cursor = refreshCursor(idx, force);
  if (force || firstCursor) await cursor;

  const groups: ScanResult["groups"] = [];
  const byHome = new Map<string, RawReq[]>();
  for (const entry of Object.values(idx.files)) {
    const key = `${entry.tool}\u0000${entry.homeId}`;
    let list = byHome.get(key);
    if (!list) byHome.set(key, (list = []));
    for (const r of entry.reqs) list.push(r);
  }
  for (const [key, reqs] of byHome) {
    const [tool, homeId] = key.split("\u0000") as ["claude" | "codex" | "gemini", string];
    groups.push({ tool, homeId, reqs });
  }
  if (idx.opencode.reqs.length) groups.push({ tool: "opencode", homeId: null, reqs: idx.opencode.reqs });
  for (const [email, store] of Object.entries(idx.cursor ?? {})) {
    if (store.reqs.length) groups.push({ tool: "cursor", homeId: null, accountKey: `cursor:${email}`, reqs: store.reqs });
  }

  const slates = readEvents()
    .filter((e) => e.unit === "tokens")
    .map<RawReq>((e) => [
      e.id,
      e.at,
      e.model,
      Math.max(0, e.inputTokens - (e.cacheReadTokens ?? 0)),
      e.outputTokens,
      e.cacheReadTokens ?? 0,
      0,
      0,
      e.reasoningTokens ?? 0,
      0,
      null,
    ]);
  if (slates.length) groups.push({ tool: "slates", homeId: null, reqs: slates });

  return { groups, limits: idx.limits, files: Object.keys(idx.files).length, ms: Date.now() - started };
}
