import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// The learning loop after a reply: when a review is due, what the reviewing
// model is shown and allowed to do, and what comes back to the chat. The
// model is a fake that calls the tools it's given, so nothing is spent.

process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "slates-review-"));

const setup = Promise.all([import("./review"), import("./memory")]).then(([review, memory]) => ({ ...review, ...memory }));

type Entry = { id: string; text: string; at: number };

function notes() {
  let entries: Entry[] = [];
  return { kind: "self" as const, title: "YOUR NOTES", limit: 2_200, read: () => entries.slice(), write: (next: Entry[]) => void (entries = next) };
}

function turn(key: string, student: string, extra: Partial<{ steps: string[]; wroteMemory: boolean; wroteSkill: boolean; fromStudent: boolean }> = {}) {
  return {
    helper: { key, name: "Planner", kind: "agent" as const, job: "Plans the week" },
    notes: notes(),
    transcript: [
      { who: "Student", text: student },
      { who: "Planner", text: "Here's your plan." },
    ],
    steps: extra.steps ?? [],
    wroteMemory: extra.wroteMemory ?? false,
    wroteSkill: extra.wroteSkill ?? false,
    fromStudent: extra.fromStudent ?? true,
  };
}

test("something that sounds worth remembering is reviewed straight away", async () => {
  const { planReview } = await setup;
  assert.deepEqual(planReview(turn("a", "Remember that I have soccer on Tuesdays")), { memory: true, skills: false });
  assert.deepEqual(planReview(turn("b", "I prefer short answers")), { memory: true, skills: false });
  // Unless the helper already saved it itself.
  assert.deepEqual(planReview(turn("c", "Remember I have soccer", { wroteMemory: true })), { memory: false, skills: false });
});

test("otherwise memory is reviewed every few of the student's turns, and routines don't count", async () => {
  const { MEMORY_EVERY, planReview } = await setup;
  const plans = Array.from({ length: MEMORY_EVERY }, () => planReview(turn("d", "what's due tomorrow")));
  assert.deepEqual(plans.map((p) => p.memory), [...Array(MEMORY_EVERY - 1).fill(false), true]);
  assert.equal(planReview(turn("d", "what's due tomorrow")).memory, false);
  for (let i = 0; i < MEMORY_EVERY * 2; i += 1) assert.equal(planReview(turn("e", "remember this", { fromStudent: false })).memory, false);
});

test("a turn with a lot of tool work, or enough of it over time, earns a skill review", async () => {
  const { BIG_TURN, SKILLS_EVERY, planReview } = await setup;
  assert.equal(planReview(turn("f", "plan my week", { steps: Array(BIG_TURN).fill("Ran a command") })).skills, true);
  const small = Array(3).fill("Opened a page");
  let reviewed = 0;
  for (let i = 0; i < Math.ceil(SKILLS_EVERY / 3); i += 1) if (planReview(turn("g", "next", { steps: small })).skills) reviewed += 1;
  assert.equal(reviewed, 1);
  assert.equal(planReview(turn("h", "plan", { steps: Array(BIG_TURN).fill("x"), wroteSkill: true })).skills, false);
});

test("the reviewer sees the conversation and memory, gets only the memory tool for a memory review, and what it saves comes back", async () => {
  const { review, setReviewRunner, studentBook } = await setup;
  let seen: { prompt: string; tools: string[] } | null = null;
  setReviewRunner(async (prompt, tools) => {
    seen = { prompt, tools: Object.keys(tools) };
    await tools.memory!.execute({ action: "add", target: "student", content: "Has soccer on Tuesdays" }, {});
    await tools.memory!.execute({ action: "add", target: "self", content: "Keep plans to three hours a night" }, {});
  });
  const t = turn("i", "Remember that I have soccer on Tuesdays");
  const learned = await review(t, { memory: true, skills: false });
  setReviewRunner(null);

  assert.deepEqual(seen!.tools, ["memory"]);
  assert.match(seen!.prompt, /<conversation>\nStudent: Remember that I have soccer on Tuesdays\n\nPlanner: Here's your plan\.\n<\/conversation>/);
  assert.match(seen!.prompt, /STUDENT PROFILE \(target "student"/);
  assert.match(seen!.prompt, /PLANNER'S NOTES \(target "self"\)/);
  assert.match(seen!.prompt, /Review the conversation above and consider saving to memory/);
  assert.doesNotMatch(seen!.prompt, /skill library/);
  assert.deepEqual(learned.map((l) => [l.book, l.text]), [["student", "Has soccer on Tuesdays"], ["self", "Keep plans to three hours a night"]]);
  assert.deepEqual(studentBook().read().map((e) => e.text), ["Has soccer on Tuesdays"]);
  assert.deepEqual(t.notes.read().map((e) => e.text), ["Keep plans to three hours a night"]);
});

test("a skill review can open, write and patch skills too", async () => {
  const { review, setReviewRunner } = await setup;
  let tools: string[] = [];
  setReviewRunner(async (prompt, given) => {
    tools = Object.keys(given);
    assert.match(prompt, /consider updating the skill library/);
    assert.match(prompt, /What Planner did in its last reply:\n- Ran a command/);
    await given.save_skill!.execute({ name: "Weekly plan", description: "Plan the week", instructions: "Read the board first." }, {});
  });
  const learned = await review(turn("j", "plan my week", { steps: ["Ran a command"] }), { memory: false, skills: true });
  setReviewRunner(null);
  assert.deepEqual(tools.sort(), ["get_skill", "memory", "patch_skill", "save_skill"]);
  assert.deepEqual(learned, [{ kind: "skill", action: "created", text: "Weekly plan" }]);
});

test("a background review reports when it's done, to the chat and to a page that asks later", async () => {
  const { reviewResult, setReviewRunner, startReview } = await setup;
  setReviewRunner(async (_prompt, tools) => {
    await tools.memory!.execute({ action: "add", target: "student", content: "Is in 11th grade" }, {});
  });
  const heard = new Promise((resolve) => startReview("rev_test_1", turn("k", "I'm in 11th grade"), { memory: true, skills: false }, resolve));
  assert.deepEqual(await heard, [{ kind: "memory", action: "added", book: "student", text: "Is in 11th grade" }]);
  assert.deepEqual(await reviewResult("rev_test_1", 1_000), [{ kind: "memory", action: "added", book: "student", text: "Is in 11th grade" }]);
  assert.equal(await reviewResult("rev_unknown", 10), null);

  // A reviewer that fails costs that review, not the helper.
  setReviewRunner(async () => {
    throw new Error("no model");
  });
  startReview("rev_test_2", turn("k", "hello"), { memory: true, skills: false });
  assert.deepEqual(await reviewResult("rev_test_2", 1_000), []);
  setReviewRunner(null);
});
