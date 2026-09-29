import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Recall: past chats found by plain word matching, no model in the loop.
// The tutor's chats are copies the tutor route writes on the host; agent
// chats come from the Agent app's own store (empty in this throwaway home).

process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "slates-recall-"));

const setup = import("./recall");

const DAY = 86_400_000;
const now = Date.UTC(2026, 8, 28);

function chat(id: string, title: string, lines: [string, string][], daysAgo = 1) {
  return { id, where: "tutor" as const, title, updatedAt: now - daysAgo * DAY, lines: lines.map(([who, text]) => ({ who, text, at: now - daysAgo * DAY })) };
}

const chats = [
  chat("cchem01", "Chem test prep", [
    ["Student", "When is my chemistry test on stoichiometry?"],
    ["Tutor", "Your stoichiometry test is Friday; let's practice mole ratios."],
    ["Student", "ok give me three practice problems"],
  ]),
  chat("cessay1", "Essay outline", [
    ["Student", "Help me outline my Gatsby essay"],
    ["Tutor", "Start with your thesis about the green light."],
  ], 3),
  chat("cplan01", "Weekly plan", [
    ["Student", "Plan my week, I have a test and soccer"],
    ["Tutor", "Monday: review notes. Tuesday: soccer, light night."],
  ], 20),
];

test("the chat that uses the rare words ranks first, and plural finds singular", async () => {
  const { search, terms } = await setup;
  const hits = search(chats, "stoichiometry tests", 5, now);
  assert.equal(hits[0]?.chat.id, "cchem01");
  assert.equal(search(chats, "outlines", 5, now)[0]?.chat.id, "cessay1");
  assert.deepEqual(search(chats, "the and of", 5, now), []);
  assert.deepEqual(terms("Studies classes boxes tests glass status"), ["study", "class", "box", "test", "glass", "status"]);
});

test("a search answer names each chat with its id and shows the lines around the match", async () => {
  const { recall } = await setup;
  const text = recall({ query: "green light thesis", chats });
  assert.match(text, /^2 past chats mention that/);
  assert.match(text, /\[1\] Tutor chat "Essay outline" · last active .* · id cessay1/);
  assert.match(text, /\[2\] Tutor chat "Weekly plan"/);
  assert.match(recall({ query: "mole ratios", chats }), /^1 past chat mentions that/);
  assert.match(text, /Student: Help me outline my Gatsby essay/);
  assert.match(text, /Tutor: Start with your thesis/);
  assert.match(recall({ query: "photosynthesis", chats }), /Nothing in past chats matches/);
});

test("one chat can be read in full, and the chat you're in stays out of a search", async () => {
  const { recall } = await setup;
  assert.match(recall({ chat: "cplan01", chats }), /Weekly plan[\s\S]*Tutor: Monday: review notes/);
  assert.match(recall({ chat: "cnope00", chats }), /There's no chat with id cnope00/);
  assert.doesNotMatch(recall({ query: "stoichiometry", chats, exclude: "cchem01" }), /cchem01/);
  assert.match(recall({ chat: "cchem01", chats, exclude: "cchem01" }), /mole ratios/);
});

test("with nothing to look for, it lists the latest chats", async () => {
  const { recall } = await setup;
  const text = recall({ chats });
  assert.match(text, /The most recent chats:/);
  assert.ok(text.indexOf("cchem01") < text.indexOf("cessay1") && text.indexOf("cessay1") < text.indexOf("cplan01"));
});

test("the tutor's copies are saved, found and deleted on the host", async () => {
  const { allTranscripts, deleteTutorTranscript, recall, saveTutorTranscript, TUTOR_CHATS } = await setup;
  saveTutorTranscript({ id: "cbio999", title: "Cells", lines: [{ who: "Student", text: "What do mitochondria do?" }, { who: "Tutor", text: "They make ATP." }] });
  saveTutorTranscript({ id: "../../etc", title: "nope", lines: [{ who: "Student", text: "x" }] });
  assert.deepEqual(fs.readdirSync(TUTOR_CHATS), ["cbio999.json"]);
  assert.equal(allTranscripts()[0]?.title, "Cells");
  assert.match(recall({ query: "mitochondria" }), /id cbio999/);
  deleteTutorTranscript("cbio999");
  assert.equal(allTranscripts().length, 0);
});
