import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// The shared skill library: helpers write skills as well as follow them, and
// fix a wrong one in place rather than piling up near-duplicates.

process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "slates-skills-"));

const setup = Promise.all([import("./skills"), import("@/lib/agent/store")]).then(([skills, store]) => ({ ...skills, store }));

test("saving a skill twice under one name rewrites it rather than adding another", async () => {
  const { saveSkill, store } = await setup;
  const first = saveSkill({ name: "Weekly plan", description: "Plan the week around due dates", instructions: "1. Read the board.\n2. Hardest work first." }, "Planner");
  assert.equal(first.created, true);
  assert.equal(first.skill.by, "Planner");
  const again = saveSkill({ name: "/weekly PLAN", instructions: "1. Read the board.\n2. Hardest work first.\n3. Leave Friday light." }, "Tutor");
  assert.equal(again.created, false);
  const all = store.skills.all();
  assert.equal(all.length, 1);
  assert.equal(all[0]!.name, "weekly PLAN");
  assert.equal(all[0]!.description, "Plan the week around due dates");
  assert.equal(all[0]!.by, "Tutor");
  assert.throws(() => saveSkill({ name: " ", instructions: "x" }, "Tutor"), /needs a name/);
});

test("a patch changes exactly the piece it names, once", async () => {
  const { patchSkill, saveSkill, store } = await setup;
  saveSkill({ name: "Study guide", instructions: "Use headings.\nEnd with 5 questions.\nCite the textbook." }, "Tutor");
  patchSkill({ name: "study guide", oldText: "End with 5 questions.", newText: "End with 10 questions, answers at the back." }, "Tutor");
  assert.equal(store.skills.all().find((s) => s.name === "Study guide")?.instructions, "Use headings.\nEnd with 10 questions, answers at the back.\nCite the textbook.");
  assert.throws(() => patchSkill({ name: "Study guide", oldText: "nowhere", newText: "x" }, "Tutor"), /isn't in the skill word for word/);
  saveSkill({ name: "Twice", instructions: "Check it. Check it." }, "Tutor");
  assert.throws(() => patchSkill({ name: "Twice", oldText: "Check it.", newText: "x" }, "Tutor"), /more than once/);
  assert.throws(() => patchSkill({ name: "Missing", oldText: "a", newText: "b" }, "Tutor"), /No skill is called "Missing"/);
});

test("opening a skill counts a use, and the index lists the most used first with when to use each", async () => {
  const { saveSkill, skillIndex, viewSkill } = await setup;
  saveSkill({ name: "Flashcards", description: "Turn notes into Quizlet cards", instructions: "Term, tab, definition." }, "Tutor");
  assert.match(viewSkill("flashcards"), /^# Flashcards\n\nTurn notes into Quizlet cards\n\nTerm, tab, definition\.$/);
  viewSkill("Flashcards");
  const index = skillIndex().split("\n");
  assert.equal(index[0], "- Flashcards: Turn notes into Quizlet cards");
  assert.ok(index.some((line) => line.startsWith("- Study guide: Use headings.")));
  assert.match(viewSkill("Nope"), /No skill is called "Nope"\. The skills are:/);
});
