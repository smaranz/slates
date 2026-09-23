import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

/**
 * Runs the whole coding-usage pipeline against a fake home directory:
 * Claude Code, Codex and Gemini logs, plus a second Claude account linked
 * through its own CLAUDE_CONFIG_DIR. Run with
 *   npx tsx --conditions=react-server --test lib/ai-usage/coding/coding.test.ts
 */

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "slates-usage-"));
process.env.HOME = HOME;
fs.mkdirSync(path.join(HOME, ".Trash"));
delete process.env.CLAUDE_CONFIG_DIR;
delete process.env.CODEX_HOME;

function write(file: string, body: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

function jwt(claims: object): string {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "none" })}.${b(claims)}.sig`;
}

const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

function claudeLine(id: string, at: string, usage: object, cwd = "/Users/me/proj-a") {
  return JSON.stringify({ type: "assistant", timestamp: at, cwd, message: { id, model: "claude-opus-5-5", usage } });
}

// Default Claude home: one reply written as two lines (content blocks), one normal reply.
write(path.join(HOME, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "a@example.com", organizationType: "claude_pro" } }));
write(
  path.join(HOME, ".claude", "projects", "p1", "s1.jsonl"),
  [
    JSON.stringify({ type: "user", message: { content: "hi" } }),
    claudeLine("msg_1", iso(60_000), { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 0 }),
    claudeLine("msg_1", iso(59_000), {
      input_tokens: 10,
      output_tokens: 1_000,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 100_000,
      cache_creation: { ephemeral_1h_input_tokens: 100_000, ephemeral_5m_input_tokens: 0 },
    }),
    claudeLine("msg_2", iso(30_000), { input_tokens: 1_000_000, output_tokens: 0 }),
    "",
  ].join("\n")
);

// Codex default home: a count re-emitted with only rate limits changed must be counted once.
write(path.join(HOME, ".codex", "auth.json"), JSON.stringify({ tokens: { id_token: jwt({ email: "c@example.com", "https://api.openai.com/auth": { chatgpt_plan_type: "pro" } }) } }));
const tc = (total: number, last: object, at: string) =>
  JSON.stringify({
    timestamp: at,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: { total_token_usage: { total_tokens: total }, last_token_usage: last },
      rate_limits: { plan_type: "pro", primary: { used_percent: 42, window_minutes: 300, resets_at: Math.floor(now / 1000) + 3600 } },
    },
  });
write(
  path.join(HOME, ".codex", "sessions", "2026", "09", "20", "rollout-x.jsonl"),
  [
    JSON.stringify({ timestamp: iso(90_000), type: "session_meta", payload: { cwd: "/Users/me/proj-b" } }),
    JSON.stringify({ timestamp: iso(90_000), type: "turn_context", payload: { model: "gpt-5-codex" } }),
    tc(1_100_000, { input_tokens: 1_000_000, cached_input_tokens: 400_000, output_tokens: 100_000 }, iso(80_000)),
    tc(1_100_000, { input_tokens: 1_000_000, cached_input_tokens: 400_000, output_tokens: 100_000 }, iso(79_000)),
    "",
  ].join("\n")
);

// Antigravity keeps its login in the keychain; the account comes from its log.
write(
  path.join(HOME, ".gemini", "antigravity-cli", "log", "cli-20260920_215058.log"),
  "I0920 21:50:59.017493     186 server_oauth.go:201] OAuth: authenticated successfully as z@example.com\n"
);

// cursor-agent caches who it's signed in as beside its settings.
write(path.join(HOME, ".cursor", "cli-config.json"), JSON.stringify({ authInfo: { email: "k@example.com", displayName: "K" } }));

// Gemini default home (history only now).
write(path.join(HOME, ".gemini", "google_accounts.json"), JSON.stringify({ active: "g@example.com" }));
write(
  path.join(HOME, ".gemini", "tmp", "myproj", "chats", "session-1.json"),
  JSON.stringify({
    messages: [
      { id: "u1", type: "user", timestamp: iso(50_000) },
      { id: "g1", type: "gemini", model: "gemini-2.5-pro", timestamp: iso(49_000), tokens: { input: 2_000, cached: 1_000, output: 100, thoughts: 50 } },
    ],
  })
);

test("coding usage pipeline", async () => {
  const accounts = await import("./accounts");
  const report = await import("./report");
  const pricing = await import("./pricing");

  // A second Claude account in its own home, signed in as b@example.com.
  const linked = accounts.createHome("claude");
  accounts.setAccountMeta(`home:${linked.id}`, { label: "Work Claude" });
  let snap = await report.buildCodingSnapshot("30d", null, null, true);
  const pending = snap.accounts.find((a) => a.homes.some((h) => h.id === linked.id));
  assert.ok(pending?.waiting, "linked home shows as waiting before sign-in");
  assert.equal(pending?.label, "Work Claude");

  write(path.join(linked.dir, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "b@example.com", organizationType: "claude_pro" } }));
  write(path.join(linked.dir, "projects", "p9", "s9.jsonl"), claudeLine("msg_9", iso(10_000), { input_tokens: 500_000, output_tokens: 0 }, "/Users/me/work") + "\n");

  snap = await report.buildCodingSnapshot("30d", null, null, true);
  const byKey = Object.fromEntries(snap.accounts.map((a) => [a.key, a]));

  // Claude: the split reply counts once, with its final numbers.
  const a = byKey["claude:a@example.com"]!;
  assert.equal(a.requests, 2);
  assert.ok(a.inCli);
  assert.equal(a.plan, "Pro");
  // Opus 5.5: 10 in + 1000 out + 1M cache read + 100k 1h write, then 1M in.
  const expectA = (10 * 4 + 1_000 * 20 + 1_000_000 * 0.2 + 100_000 * 8 + 1_000_000 * 4) / 1e6;
  assert.ok(Math.abs(a.costUsd - expectA) < 1e-9, `claude cost ${a.costUsd} vs ${expectA}`);

  // The linked account is its own row, with the label typed while linking.
  const b = byKey["claude:b@example.com"]!;
  assert.equal(b.requests, 1);
  assert.equal(b.label, "Work Claude");
  assert.ok(!b.inCli && !b.waiting);
  assert.match(b.command ?? "", /^CLAUDE_CONFIG_DIR='.+' claude$/);
  assert.ok(Math.abs(b.costUsd - 2) < 1e-9);

  // Codex: duplicate count skipped; cached input priced as cache.
  const c = byKey["codex:c@example.com"]!;
  assert.equal(c.requests, 1);
  assert.equal(c.plan, "Pro");
  const rate = pricing.rateFor("gpt-5-codex").rate;
  const expectC = (600_000 * rate.input + 400_000 * rate.cacheRead + 100_000 * rate.output) / 1e6;
  assert.ok(Math.abs(c.costUsd - expectC) < 1e-9);

  // Gemini: thoughts billed as output, cached split out.
  const g = byKey["gemini:g@example.com"]!;
  assert.equal(g.requests, 1);
  assert.equal(snap.totals.requests, 5);
  assert.deepEqual(
    snap.tools.map((t) => t.tool),
    ["claude", "codex", "gemini"]
  );
  assert.ok(snap.projects.some((p) => p.project === "/Users/me/proj-b"));

  // Antigravity: an account with limits only, no token rows.
  const z = byKey["antigravity:z@example.com"]!;
  assert.ok(z.inCli && !z.tracksTokens && z.canLink);
  assert.equal(z.requests, 0);
  // Gemini CLI: history still counted, but it's no longer something to link.
  assert.ok(!g.canLink);

  // A linked Antigravity home runs agy under its own HOME, with your git and SSH setup carried in.
  write(path.join(HOME, ".gitconfig"), "[user]\n");
  const ag = accounts.createHome("antigravity");
  assert.match(accounts.runCommand(ag), /^HOME='.+' agy$/);
  assert.ok(fs.lstatSync(path.join(ag.dir, ".gitconfig")).isSymbolicLink());
  accounts.removeHome(ag.id);

  // Cursor: the CLI's account is a card you can open and link beside.
  const k = byKey["cursor:k@example.com"]!;
  assert.ok(k.inCli && k.canLink && k.tracksTokens);
  const cu = accounts.createHome("cursor");
  assert.match(accounts.loginCommand(cu), /^HOME='.+' cursor-agent login$/);
  accounts.removeHome(cu.id);

  // Filters and paging.
  const onlyB = await report.buildCodingSnapshot("30d", null, "claude:b@example.com");
  assert.equal(onlyB.totals.requests, 1);
  const page = await report.requestPage({ range: "30d", tool: "claude", account: null, offset: 0, limit: 2 });
  assert.equal(page.total, 3);
  assert.equal(page.rows.length, 2);
  assert.ok(page.rows[0]!.at >= page.rows[1]!.at, "newest first");
  assert.equal(page.rows[0]!.accountLabel, "Work Claude");

  // Appending to a log is picked up incrementally.
  fs.appendFileSync(
    path.join(HOME, ".claude", "projects", "p1", "s1.jsonl"),
    claudeLine("msg_3", iso(1_000), { input_tokens: 1, output_tokens: 1 }) + "\n"
  );
  snap = await report.buildCodingSnapshot("30d", null, null, true);
  assert.equal(snap.accounts.find((x) => x.key === "claude:a@example.com")!.requests, 3);

  // Removing the linked home drops its login but moves the folder to the Trash, not away forever.
  assert.ok(accounts.removeHome(linked.id));
  assert.ok(!fs.existsSync(linked.dir));

  // The index survives a restart: a fresh module load reads it back from disk.
  await (await import("./scan")).flushIndex();
  assert.ok(fs.existsSync(path.join(HOME, ".slates", "usage", "index-v1.json")));
});

test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));
