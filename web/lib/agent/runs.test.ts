import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { JsonlLocalAgentStore } from "@cursor/sdk";

import { hasCutOffTurn } from "./runs";

// A real runtime store in a throwaway folder, written the way the SDK leaves
// one when the host dies mid-turn: the agent points at a run still "running".
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slates-runs-"));
const store = new JsonlLocalAgentStore(dir);
const now = Date.now();

async function agentWithRun(agentId: string, status: "queued" | "running" | "finished" | "error" | "cancelled" | "expired" | null) {
  const runId = `${agentId}-run`;
  await store.agents.create({ agent: { agentId, cwd: dir, status: "idle", activeRunId: status ? runId : null, createdAt: now, updatedAt: now } });
  if (status) await store.runs.create({ run: { runId, agentId, turnNumber: 1, status, createdAt: now, updatedAt: now } });
}

test("a turn the store still has running or queued was cut off", async () => {
  await agentWithRun("agent-running", "running");
  await agentWithRun("agent-queued", "queued");
  assert.equal(await hasCutOffTurn(store, "agent-running"), true);
  assert.equal(await hasCutOffTurn(store, "agent-queued"), true);
});

test("a finished, failed, stopped or expired turn is not, and nor is no turn at all", async () => {
  for (const status of ["finished", "error", "cancelled", "expired"] as const) {
    await agentWithRun(`agent-${status}`, status);
    assert.equal(await hasCutOffTurn(store, `agent-${status}`), false, status);
  }
  await agentWithRun("agent-fresh", null);
  assert.equal(await hasCutOffTurn(store, "agent-fresh"), false);
  assert.equal(await hasCutOffTurn(store, "agent-unknown"), false);
});

test("a store that can't be read doesn't hold the turn up", async () => {
  const broken = { agents: { get: () => Promise.reject(new Error("disk")) }, runs: { get: () => Promise.reject(new Error("disk")) } };
  assert.equal(await hasCutOffTurn(broken as unknown as JsonlLocalAgentStore, "agent-running"), false);
});
