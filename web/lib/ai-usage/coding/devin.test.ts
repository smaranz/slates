import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { devinReqs, devinSql } from "./devin";

/*
 * A miniature Devin session database with the real schema's relevant columns:
 * one reply split across two rows (thinking, then a tool call) that must count
 * once, a second reply, a user turn and a reply with no metrics.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slates-devin-"));
const db = path.join(dir, "sessions.db");
const msg = (role: string, meta: Record<string, unknown> | null) => JSON.stringify({ role, content: "…", ...(meta ? { metadata: meta } : {}) }).replace(/'/g, "''");
const metrics = { input_tokens: 4, output_tokens: 120, cache_read_tokens: 13076, cache_creation_tokens: 36783 };
execFileSync("/usr/bin/sqlite3", [db, `
  create table sessions (id text primary key, working_directory text not null);
  create table message_nodes (row_id integer primary key autoincrement, session_id text not null, node_id integer not null, chat_message text not null, created_at integer not null);
  insert into sessions values ('s1', '/Users/me/projects/slates');
  insert into message_nodes (session_id, node_id, chat_message, created_at) values
    ('s1', 1, '${msg("user", null)}', 1790483400),
    ('s1', 2, '${msg("assistant", { request_id: "r1", generation_model: "claude-opus-5-5-max", created_at: "2026-09-26T22:47:42.437Z", metrics })}', 1790483414),
    ('s1', 3, '${msg("assistant", { request_id: "r1", generation_model: "claude-opus-5-5-max", created_at: "2026-09-26T22:47:42.437Z", metrics })}', 1790483414),
    ('s1', 4, '${msg("assistant", { request_id: "r2", generation_model: "gpt-6-luna-high", metrics: { input_tokens: 3, output_tokens: 549, cache_creation_tokens: 24360 } })}', 1790484016),
    ('s1', 5, '${msg("assistant", { request_id: "r3" })}', 1790484020);
`]);

const rows = (after = 0) => JSON.parse(execFileSync("/usr/bin/sqlite3", ["-readonly", "-json", db, devinSql(after)], { encoding: "utf8" }) || "[]") as Record<string, unknown>[];

test("one reply split across rows counts once, with its tokens, model, time and project", () => {
  const reqs = devinReqs(rows());
  assert.deepEqual(reqs.map((r) => r[0]).sort(), ["r1", "r2"]);
  const r1 = reqs.find((r) => r[0] === "r1")!;
  assert.equal(r1[1], Date.parse("2026-09-26T22:47:42.437Z"));
  assert.equal(r1[2], "claude-opus-5-5-max");
  assert.deepEqual(r1.slice(3, 7), [4, 120, 13076, 36783]);
  assert.equal(r1[10], "/Users/me/projects/slates");
});

test("a reply without an ISO time falls back to the row's seconds, and missing counts read as zero", () => {
  const r2 = devinReqs(rows()).find((r) => r[0] === "r2")!;
  assert.equal(r2[1], 1790484016 * 1000);
  assert.deepEqual(r2.slice(3, 7), [3, 549, 0, 24360]);
});

test("an incremental read only returns replies past the given row", () => {
  assert.deepEqual(devinReqs(rows(3)).map((r) => r[0]), ["r2"]);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
