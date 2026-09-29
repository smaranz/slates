import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Memory held to a character budget, edited the way Hermes Agent edits it:
// entries found by a piece of their text, a full book refusing more until
// the helper makes room. Books are in memory here, except the one test that
// checks the student profile really lands on disk under ~/.slates/memory.

process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "slates-memory-"));

const setup = Promise.all([import("./memory"), import("./types")]).then(([memory, types]) => ({ ...memory, ...types }));

type Entry = { id: string; text: string; at: number; by?: string };

function book(limit = 200, entries: Entry[] = []) {
  const state = { entries };
  return {
    kind: "self" as const,
    title: "NOTES",
    limit,
    read: () => state.entries.slice(),
    write: (next: Entry[]) => void (state.entries = next),
    get entries() {
      return state.entries;
    },
  };
}

const entry = (text: string, id = `mem_${text.length}${text[0]}`): Entry => ({ id, text, at: 1 });

test("add saves one short entry and says how full the book is", async () => {
  const { editBook } = await setup;
  const notes = book();
  const outcome = editBook(notes, { action: "add", content: "  § Likes   answers short  " }, "Planner");
  assert.equal(outcome.ok, true);
  assert.match(outcome.message, /Saved to your notes \(19\/200 chars\)/);
  assert.deepEqual(outcome.change, { kind: "memory", action: "added", book: "self", text: "Likes answers short" });
  assert.equal(notes.entries.length, 1);
  assert.equal(notes.entries[0]!.by, "Planner");
});

test("the same entry twice is kept once, whatever its case", async () => {
  const { editBook } = await setup;
  const notes = book(200, [entry("Likes answers short")]);
  const outcome = editBook(notes, { action: "add", content: "likes answers SHORT" }, "Planner");
  assert.equal(outcome.ok, true);
  assert.equal(outcome.change, undefined);
  assert.equal(notes.entries.length, 1);
});

test("a full book refuses a new entry and lists what's in it, so the helper can make room", async () => {
  const { editBook } = await setup;
  const notes = book(40, [entry("Soccer on Tuesdays and Thursdays")]);
  const outcome = editBook(notes, { action: "add", content: "Has a chemistry test Friday" }, "Tutor");
  assert.equal(outcome.ok, false);
  assert.match(outcome.message, /Your notes are at 32\/40 chars, and this would take it to 59/);
  assert.match(outcome.message, /use replace to merge/);
  assert.match(outcome.message, /§ Soccer on Tuesdays and Thursdays/);
  assert.equal(notes.entries.length, 1);
});

test("replace finds the entry by a piece of it, and won't guess between two", async () => {
  const { editBook } = await setup;
  const notes = book(300, [entry("Soccer on Tuesdays", "mem_a"), entry("Band practice on Tuesdays", "mem_b")]);

  const ambiguous = editBook(notes, { action: "replace", old_text: "tuesdays", content: "x" }, "Tutor");
  assert.equal(ambiguous.ok, false);
  assert.match(ambiguous.message, /is in 2 different entries/);

  const missing = editBook(notes, { action: "replace", old_text: "chess", content: "x" }, "Tutor");
  assert.equal(missing.ok, false);
  assert.match(missing.message, /Nothing in your notes contains "chess"/);

  const done = editBook(notes, { action: "replace", old_text: "soccer", content: "Soccer on Tuesdays and Thursdays until 6pm" }, "Tutor");
  assert.equal(done.ok, true);
  assert.equal(done.change?.action, "updated");
  assert.deepEqual(notes.entries.map((e) => e.text), ["Soccer on Tuesdays and Thursdays until 6pm", "Band practice on Tuesdays"]);
  assert.equal(notes.entries[0]!.id, "mem_a");
});

test("replace that would overflow the book is refused and changes nothing", async () => {
  const { editBook } = await setup;
  const notes = book(30, [entry("Short one")]);
  const outcome = editBook(notes, { action: "replace", old_text: "short", content: "A much, much longer entry than there is room for" }, "Tutor");
  assert.equal(outcome.ok, false);
  assert.deepEqual(notes.entries.map((e) => e.text), ["Short one"]);
});

test("remove works by a piece of the text or by the id the page shows", async () => {
  const { editBook } = await setup;
  const notes = book(300, [entry("Soccer on Tuesdays", "mem_a"), entry("Prefers bullet points", "mem_b")]);
  assert.equal(editBook(notes, { action: "remove", old_text: "bullet" }, "You").change?.text, "Prefers bullet points");
  assert.equal(editBook(notes, { action: "remove", old_text: "mem_a" }, "You").ok, true);
  assert.equal(notes.entries.length, 0);
});

test("passwords, codes and keys are never saved, and nor is an essay", async () => {
  const { editBook } = await setup;
  const notes = book(5_000);
  for (const content of ["Schoology password is hunter2", "api key: sk-abcdefghijklmnopqrstuvwxyz", "The 2FA code is 123456"]) {
    const outcome = editBook(notes, { action: "add", content }, "Tutor");
    assert.equal(outcome.ok, false, content);
    assert.match(outcome.message, /can't hold passwords/);
  }
  assert.equal(editBook(notes, { action: "add", content: "x".repeat(401) }, "Tutor").ok, false);
  assert.equal(editBook(notes, { action: "add", content: "  " }, "Tutor").ok, false);
  assert.equal(notes.entries.length, 0);
});

test("the student profile is a file every helper reads", async () => {
  const { editBook, studentBook, MEMORY_HOME } = await setup;
  editBook(studentBook(), { action: "add", content: "Goes by Sam" }, "Planner");
  assert.deepEqual(studentBook().read().map((e) => e.text), ["Goes by Sam"]);
  assert.ok(fs.existsSync(path.join(MEMORY_HOME, "student.json")));
  assert.equal(MEMORY_HOME, path.join(process.env.HOME!, ".slates", "memory"));
});

test("the prompt shows every entry with how full each book is", async () => {
  const { renderBooks, memoryPrompt } = await setup;
  const full = { ...book(100, [entry("Goes by Sam"), entry("In 11th grade")]), kind: "student" as const, title: "STUDENT PROFILE" };
  const empty = book(50);
  const text = renderBooks([full, empty]);
  assert.match(text, /STUDENT PROFILE \[24\/100 chars\]\n§ Goes by Sam\n§ In 11th grade/);
  assert.match(text, /NOTES \[0\/50 chars\]\n\(nothing yet\)/);
  assert.match(memoryPrompt([full]), /^<memory>[\s\S]*<\/memory>\n\nYour memory lasts between chats/);
});

test("what was learned reads as a sentence for the chat", async () => {
  const { describeLearned } = await setup;
  assert.equal(describeLearned({ kind: "memory", action: "added", book: "student", text: "Goes by Sam" }), "Remembered: Goes by Sam");
  assert.equal(describeLearned({ kind: "memory", action: "updated", book: "self", text: "Use tables" }), "Updated its notes: Use tables");
  assert.equal(describeLearned({ kind: "skill", action: "created", text: "Weekly plan" }), "Learned a skill: Weekly plan");
});
