import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// What agents remembered before there was a shared profile moves into it,
// once: newest first while there's room, duplicates folded, and anything the
// profile would refuse left with the agent that heard it.

process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "slates-adopt-"));

const agentHome = path.join(process.env.HOME, ".slates", "agent");
fs.mkdirSync(agentHome, { recursive: true });
const agent = (id: string, name: string, memory: [string, string, number][]) => ({
  id, name, job: "", rules: "", model: "grok-4.7", hue: 0, voiceReplies: false, createdAt: 0,
  memory: memory.map(([mid, text, at]) => ({ id: mid, text, at })),
});
fs.writeFileSync(
  path.join(agentHome, "agents.json"),
  JSON.stringify({
    items: [
      agent("agt_plan0001", "Planner", [
        ["mem_1", "Has soccer on Tuesdays", 1],
        ["mem_2", "Prefers plans as a table", 3],
        ["mem_3", "Schoology password is hunter2", 4],
      ]),
      agent("agt_rsch0001", "Researcher", [
        ["mem_4", "has soccer on tuesdays", 2],
        ["mem_5", "x".repeat(2_480), 5],
      ]),
    ],
  }),
);

const setup = Promise.all([import("./memory"), import("@/lib/agent/store")]).then(([memory, store]) => ({ ...memory, store }));

test("agents' old memories become the shared profile, once", async () => {
  const { studentBook, store, MEMORY_HOME } = await setup;
  const profile = studentBook().read();
  // The newest one is too big to leave room for the rest, so it's skipped, not the older ones;
  // of the two soccer entries, the newer wording is the one kept.
  assert.deepEqual(profile.map((e) => [e.text, e.by]), [
    ["has soccer on tuesdays", "Researcher"],
    ["Prefers plans as a table", "Planner"],
  ]);
  const planner = store.getAgent("agt_plan0001")!;
  const researcher = store.getAgent("agt_rsch0001")!;
  assert.deepEqual(planner.memory.map((e) => e.id), ["mem_3"], "the password stays where it was, never shared");
  assert.deepEqual(researcher.memory.map((e) => e.id), ["mem_5"], "the duplicate folds in; what didn't fit stays");
  assert.ok(fs.existsSync(path.join(MEMORY_HOME, ".adopted-agent-memory")));

  // A second look moves nothing more.
  store.updateAgent("agt_plan0001", (a) => ({ ...a, memory: [...a.memory, { id: "mem_6", text: "Likes Spotify", at: 9 }] }));
  assert.equal(studentBook().read().length, 2);
  assert.equal(store.getAgent("agt_plan0001")!.memory.length, 2);
});
