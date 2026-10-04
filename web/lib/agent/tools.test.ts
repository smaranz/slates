import assert from "node:assert/strict";
import test from "node:test";

import { buildTools } from "./tools";
import { review, setReviewRunner } from "@/lib/learning/review";
import type { MemoryEntry } from "@/lib/learning/types";

const context = {
  agentId: "agt_testgeneric", chatId: "agt_testgeneric",
  post: () => {}, handoff: () => "Handed off",
};

test("general agents have no school tools or shared learning tools", async () => {
  const tools = buildTools(context);
  for (const name of ["slates_board", "slates_find_person", "slates_draft_message", "slates_draft_reply", "search_chats", "list_skills", "get_skill", "save_skill", "patch_skill"]) {
    assert.equal(tools[name], undefined, name);
  }
  assert.ok(tools.send_file);
  assert.ok(tools.create_routine);
  assert.ok(tools.message_agent);
  const rejected = await tools.memory!.execute({ action: "add", target: "student", content: "Should not reach the shared profile" }, {});
  assert.equal(typeof rejected === "object" && rejected !== null && "isError" in rejected && rejected.isError, true);
});

test("Study Studio explicitly retains its school and shared skill tools", () => {
  const tools = buildTools(context, { school: true });
  assert.ok(tools.slates_board);
  assert.ok(tools.list_skills);
  assert.ok(tools.get_skill);
});

test("a general agent's background review sees and edits only its own notes", async () => {
  let entries: MemoryEntry[] = [];
  setReviewRunner(async (prompt, tools) => {
    assert.doesNotMatch(prompt, /school|student profile|tutor|classes|grades|skill library/i);
    assert.deepEqual(Object.keys(tools), ["memory"]);
    await tools.memory!.execute({ action: "add", target: "self", content: "Use concise replies" }, {});
  });
  try {
    const learned = await review({
      helper: { key: "generic-test", name: "Helper", kind: "agent" },
      notes: { kind: "self", title: "Own notes", limit: 2200, read: () => entries, write: (next) => { entries = next; } },
      selfOnly: true,
      transcript: [{ who: "User", text: "I prefer concise replies" }],
      steps: [], wroteMemory: false, wroteSkill: false, fromStudent: true,
    }, { memory: true, skills: true });
    assert.equal(entries[0]?.text, "Use concise replies");
    assert.equal(learned[0]?.book, "self");
  } finally {
    setReviewRunner(null);
  }
});
