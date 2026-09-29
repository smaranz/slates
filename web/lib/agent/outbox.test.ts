import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Files agents send from the host to the student's own devices, and the
// working folder they can be browsed from. Everything is in a throwaway home.

process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "slates-outbox-"));

const setup = Promise.all([import("./outbox"), import("./store")]).then(([outbox, store]) => ({ ...outbox, ...store }));

/** A file an agent made, in the workspace every agent shares. */
function write(relative: string, content: string, at?: number): string {
  const file = path.join(process.env.HOME!, ".slates", "agent", "workspace", relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  if (at) fs.utimesSync(file, at / 1000, at / 1000);
  return file;
}

test("sending copies the file, so what was sent doesn't change when the workspace does", async () => {
  const { sendFile, sentFilePath, listSent } = await setup;
  const original = write("essays/outline.docx", "first draft");
  const sent = sendFile({ path: "essays/outline.docx", agentId: "agt_test01", from: "Planner", chatId: "agt_test01", note: " Outline for the Gatsby essay " });
  assert.match(sent.id, /^out_/);
  assert.equal(sent.name, "outline.docx");
  assert.equal(sent.size, 11);
  assert.equal(sent.note, "Outline for the Gatsby essay");
  fs.writeFileSync(original, "rewritten later");
  const found = sentFilePath(sent.id);
  assert.equal(fs.readFileSync(found!.path, "utf8"), "first draft");
  assert.equal(listSent()[0]?.id, sent.id);
  assert.equal(listSent(sent.at).length, 0);
  assert.equal(sentFilePath("out_../../x"), null);
  assert.equal(sentFilePath("out_doesnotexist"), null);
});

test("it won't send what isn't a file, or the host's own keys and settings", async () => {
  const { sendFile, WORKSPACE } = await setup;
  const base = { agentId: "agt_test01", from: "Planner", chatId: "agt_test01" };
  assert.throws(() => sendFile({ ...base, path: "nope.pdf" }), /There's no file/);
  fs.mkdirSync(path.join(WORKSPACE, "folder"), { recursive: true });
  assert.throws(() => sendFile({ ...base, path: "folder" }), /is a folder/);
  const env = path.join(process.env.HOME!, ".slates", ".env");
  fs.writeFileSync(env, "SECRET=1");
  assert.throws(() => sendFile({ ...base, path: env }), /can't be sent/);
  assert.throws(() => sendFile({ ...base, path: "~/.slates/.env" }), /can't be sent/);
});

test("the workspace lists newest first, and only hands out files inside it", async () => {
  const { workspaceFilePath, workspaceFiles, WORKSPACE } = await setup;
  write("notes/old.md", "old", Date.now() - 60_000);
  write("notes/new.md", "new");
  write("node_modules/pkg/index.js", "x");
  write(".hidden/secret.txt", "x");
  const list = workspaceFiles();
  assert.equal(list[0]?.path, "notes/new.md");
  assert.ok(list.some((f) => f.path === "notes/old.md"));
  assert.ok(!list.some((f) => f.path.startsWith("node_modules") || f.path.startsWith(".hidden")));

  assert.equal(workspaceFilePath("notes/new.md"), fs.realpathSync(path.join(WORKSPACE, "notes", "new.md")));
  assert.equal(workspaceFilePath("../../.slates/.env"), null);
  assert.equal(workspaceFilePath("notes"), null);
  const outside = path.join(process.env.HOME!, "outside.txt");
  fs.writeFileSync(outside, "x");
  fs.symlinkSync(outside, path.join(WORKSPACE, "link.txt"));
  assert.equal(workspaceFilePath("link.txt"), null);
});
