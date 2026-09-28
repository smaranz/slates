import assert from "node:assert/strict";
import test from "node:test";

import { createCipheriv } from "node:crypto";

import {
  chromiumDecrypt,
  chromiumKey,
  claudeAccountPart,
  devinPlanFor,
  devinSession,
  devinStatus,
  devinWindows,
  emailFromAgyToken,
  fromGoKeyring,
  renewedClaudeCredentials,
  toGoKeyring,
  withClaudeAccount,
} from "./core";
import { createSwitcher, SwitchBlocked, type Adapter, type LiveLogin, type StoredSession, type ToolRoster, type Vault } from "./switcher";
import type { SwitchTool } from "./types";

// ── core ──────────────────────────────────────────────────────────────────

test("a Claude switch moves the account's keys and leaves projects and MCP servers alone", () => {
  const live = JSON.stringify({
    projects: { "/work": { allowedTools: ["Bash"] } },
    mcpServers: { "slates-ui": { command: "node" } },
    oauthAccount: { emailAddress: "a@example.com" },
    modelAccessCache: { a: true },
    numStartups: 40,
  });
  const saved = claudeAccountPart(JSON.stringify({ oauthAccount: { emailAddress: "b@example.com" }, projects: { "/old": {} }, cachedUsageUtilization: { x: 1 } }));
  assert.deepEqual(Object.keys(saved).sort(), ["cachedUsageUtilization", "oauthAccount"]);

  const merged = JSON.parse(withClaudeAccount(live, saved));
  assert.equal(merged.oauthAccount.emailAddress, "b@example.com");
  assert.deepEqual(merged.projects, { "/work": { allowedTools: ["Bash"] } });
  assert.deepEqual(merged.mcpServers, { "slates-ui": { command: "node" } });
  assert.equal(merged.numStartups, 40);
  assert.deepEqual(merged.cachedUsageUtilization, { x: 1 });
  assert.equal("modelAccessCache" in merged, false, "the previous account's caches don't linger");
});

test("renewed Claude tokens are written into the blob as it was", () => {
  const before = JSON.stringify({ claudeAiOauth: { accessToken: "old", refreshToken: "r1", expiresAt: 1, scopes: ["user:inference"], subscriptionType: "max" }, mcpOAuth: { k: 1 } });
  const after = JSON.parse(renewedClaudeCredentials(before, { access_token: "new", refresh_token: "r2", expires_in: 3600 }, 1_000));
  assert.deepEqual(after.claudeAiOauth, { accessToken: "new", refreshToken: "r2", expiresAt: 3_601_000, scopes: ["user:inference"], subscriptionType: "max" });
  assert.deepEqual(after.mcpOAuth, { k: 1 });
});

test("agy's go-keyring value round-trips and names its account", () => {
  const claims = Buffer.from(JSON.stringify({ email: "me@gmail.com" })).toString("base64url");
  const token = JSON.stringify({ token: { access_token: "a", refresh_token: "r" }, id_token: `h.${claims}.s` });
  const stored = toGoKeyring(token);
  assert.ok(stored.startsWith("go-keyring-base64:"));
  assert.equal(fromGoKeyring(stored), token);
  assert.equal(emailFromAgyToken(fromGoKeyring(stored)), "me@gmail.com");
  assert.equal(emailFromAgyToken("{}"), null);
});

test("Devin's cached plans are found by email and read as daily and weekly windows", () => {
  const now = Date.UTC(2026, 8, 28, 12);
  const plans = [
    { accountIdentityText: "first@gmail.com - My Team", billingStrategy: "quota", dailyRemainingPercent: 70, weeklyRemainingPercent: 40, dailyResetAtUnix: now / 1000 + 3600, weeklyResetAtUnix: now / 1000 - 60 },
    { accountIdentityText: "second@gmail.com - smaranz", billingStrategy: "credits" },
  ];
  const plan = devinPlanFor("First@Gmail.com", plans);
  assert.equal(plan, plans[0]);
  const { windows, resetSince } = devinWindows(plan!, now);
  assert.deepEqual(windows, [
    { id: "daily", label: "Daily", usedPct: 30, resetsAt: now + 3_600_000 },
    { id: "weekly", label: "Weekly", usedPct: 0, resetsAt: null },
  ]);
  assert.equal(resetSince, true);
  assert.deepEqual(devinWindows(devinPlanFor("second@gmail.com", plans)!, now).windows, [], "a credits plan has no quota windows");
  assert.equal(devinPlanFor("nobody@gmail.com", plans), null);
});

test("Devin's login decrypts the way Chromium's safeStorage encrypts it", () => {
  const key = chromiumKey("keychain password");
  const plain = JSON.stringify([{ id: "s1", accessToken: "sk-ws-01-abc", account: { label: "Snyr", id: "user-e8ff" }, scopes: [] }]);
  const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, " "));
  const stored = JSON.stringify({ type: "Buffer", data: [...Buffer.concat([Buffer.from("v10"), cipher.update(plain), cipher.final()])] });
  const opened = chromiumDecrypt(stored, key);
  assert.equal(opened, plain);
  assert.deepEqual(devinSession(opened!), { accountId: "user-e8ff", apiKey: "sk-ws-01-abc" });
  assert.equal(chromiumDecrypt(stored, chromiumKey("wrong")), null);
});

test("Devin's user status reads as daily and weekly windows, a missing percentage meaning none left", () => {
  const out = devinStatus({
    userStatus: {
      email: "me@gmail.com",
      planStatus: { planInfo: { planName: "Max", billingStrategy: "BILLING_STRATEGY_QUOTA" }, dailyQuotaRemainingPercent: 100, dailyQuotaResetAtUnix: "1790668800", weeklyQuotaResetAtUnix: "1791100800" },
    },
  });
  assert.equal(out.email, "me@gmail.com");
  assert.equal(out.plan, "Max");
  assert.deepEqual(out.windows, [
    { id: "daily", label: "Daily", usedPct: 0, resetsAt: 1790668800000 },
    { id: "weekly", label: "Weekly", usedPct: 100, resetsAt: 1791100800000 },
  ]);
  assert.deepEqual(devinStatus({ userStatus: { planStatus: { planInfo: { billingStrategy: "BILLING_STRATEGY_CREDITS" } } } }).windows, []);
});

// ── the switcher, against fakes ───────────────────────────────────────────

function memoryVault() {
  const rosters = new Map<string, ToolRoster>();
  const sessions = new Map<string, StoredSession>();
  const vault: Vault = {
    async roster(tool) {
      return structuredClone(rosters.get(tool) ?? { accounts: [], activeId: null });
    },
    async saveRoster(tool, roster) {
      rosters.set(tool, structuredClone(roster));
    },
    async load(tool, id) {
      const s = sessions.get(`${tool}:${id}`);
      return s ? structuredClone(s) : null;
    },
    async store(tool, id, session) {
      sessions.set(`${tool}:${id}`, structuredClone(session));
    },
    async discard(tool, id) {
      sessions.delete(`${tool}:${id}`);
    },
  };
  return { vault, rosters, sessions };
}

function login(email: string, token = `${email}-token`): LiveLogin {
  return { email, plan: "Max", session: { secret: { credentials: token }, extra: { who: email } } };
}

function fakeTool(initial: LiveLogin | null, opts: { running?: string | null; failInstall?: boolean; app?: boolean } = {}) {
  const state = { live: initial, running: opts.running ?? null, calls: [] as string[] };
  const adapter: Adapter = {
    name: "Tool",
    async readLive() {
      state.calls.push("read");
      return state.live ? structuredClone(state.live) : null;
    },
    async install(session) {
      state.calls.push("install");
      if (opts.failInstall) throw new Error("keychain said no");
      const email = String(session.extra.who);
      state.live = { email, plan: "Max", session: structuredClone(session) };
    },
    async running() {
      return state.running;
    },
    restartNote: "Restart it.",
  };
  if (opts.app) {
    adapter.app = {
      async quit() {
        state.calls.push("quit");
        // Closing writes a renewed login.
        if (state.live) state.live.session.secret.credentials += "-renewed";
        state.running = null;
      },
      async open() {
        state.calls.push("open");
      },
    };
  }
  return { state, adapter };
}

function setup(live: LiveLogin | null, opts?: Parameters<typeof fakeTool>[1]) {
  const tool = fakeTool(live, opts);
  const mem = memoryVault();
  let n = 0;
  const switcher = createSwitcher({
    vault: mem.vault,
    adapters: { claude: tool.adapter, antigravity: tool.adapter, devin: tool.adapter } as Record<SwitchTool, Adapter>,
    now: () => 1000,
    newId: () => `id${++n}`,
  });
  return { ...tool, ...mem, switcher };
}

test("saving the signed-in account adds it once and keeps it current", async () => {
  const { switcher, rosters, sessions, state } = setup(login("a@x.com"));
  assert.equal((await switcher.saveCurrent("claude")).headline, "Now keeping a@x.com.");
  state.live = login("a@x.com", "rotated");
  assert.equal((await switcher.saveCurrent("claude")).headline, "Saved a@x.com.");
  assert.equal(rosters.get("claude")!.accounts.length, 1);
  assert.equal(rosters.get("claude")!.activeId, "id1");
  assert.equal(sessions.get("claude:id1")!.secret.credentials, "rotated");
});

test("switching saves the displaced login first, then installs the other", async () => {
  const { switcher, state, sessions, rosters } = setup(login("a@x.com"));
  await switcher.saveCurrent("claude");
  state.live = login("b@x.com");
  await switcher.saveCurrent("claude");

  const out = await switcher.activate("claude", "id1");
  assert.equal(out.headline, "Switched to a@x.com.");
  assert.deepEqual(out.notes, ["Saved b@x.com first.", "Restart it."]);
  assert.equal(state.live!.email, "a@x.com");
  assert.equal(sessions.get("claude:id2")!.secret.credentials, "b@x.com-token");
  assert.equal(rosters.get("claude")!.activeId, "id1");
});

test("a login Slates didn't know about is saved rather than overwritten", async () => {
  const { switcher, state, sessions } = setup(login("a@x.com"));
  await switcher.saveCurrent("claude");
  state.live = login("stranger@x.com");
  const out = await switcher.activate("claude", "id1");
  assert.deepEqual(out.notes[0], "stranger@x.com wasn't on the list, so it was saved first.");
  assert.equal(sessions.get("claude:id2")!.secret.credentials, "stranger@x.com-token");
});

test("switching to whoever is signed in, or to a login that's gone, changes nothing", async () => {
  const { switcher, state, sessions } = setup(login("a@x.com"));
  await switcher.saveCurrent("claude");
  await assert.rejects(switcher.activate("claude", "id1"), /Already signed in as a@x.com/);

  state.live = login("b@x.com");
  sessions.delete("claude:id1");
  await assert.rejects(switcher.activate("claude", "id1"), /no saved sign-in/);
  assert.equal(state.live.email, "b@x.com");
  assert.equal(state.calls.includes("install"), false);
});

test("a running CLI blocks a switch unless it's forced", async () => {
  const { switcher, state } = setup(login("a@x.com"), { running: "Claude Code is open in 2 places." });
  await switcher.saveCurrent("claude");
  state.live = login("b@x.com");
  await assert.rejects(switcher.activate("claude", "id1"), (err) => err instanceof SwitchBlocked && /open in 2 places/.test(err.message));
  assert.equal(state.live.email, "b@x.com");

  const out = await switcher.activate("claude", "id1", true);
  assert.equal(state.live!.email, "a@x.com");
  assert.match(out.notes.at(-1)!, /Restart it, or it may switch back/);
});

test("a failed install doesn't mark the target active", async () => {
  const { switcher, state, rosters } = setup(login("a@x.com"), { failInstall: true });
  await switcher.saveCurrent("claude");
  state.live = login("b@x.com");
  await switcher.saveCurrent("claude");
  await assert.rejects(switcher.activate("claude", "id1"), /keychain said no/);
  assert.equal(state.live.email, "b@x.com");
  assert.equal(rosters.get("claude")!.activeId, "id2");
});

test("an app is quit for the switch, read again once closed, and opened again", async () => {
  const { switcher, state, sessions } = setup(login("a@x.com"), { app: true });
  await switcher.saveCurrent("devin");
  state.live = login("b@x.com");
  state.running = "Devin is open.";
  const out = await switcher.activate("devin", "id1");
  assert.deepEqual(state.calls.filter((c) => c !== "read"), ["quit", "install", "open"]);
  assert.equal(sessions.get("devin:id2")!.secret.credentials, "b@x.com-token-renewed", "the login as the app left it is what's saved");
  assert.equal(out.notes.at(-1), "Tool opened again.");
});

test("removing an account drops only the saved copy", async () => {
  const { switcher, state, sessions, rosters } = setup(login("a@x.com"));
  await switcher.saveCurrent("claude");
  const out = await switcher.remove("claude", "id1");
  assert.match(out.notes[0]!, /still signed in/);
  assert.equal(sessions.has("claude:id1"), false);
  assert.equal(rosters.get("claude")!.accounts.length, 0);
  assert.equal(state.live!.email, "a@x.com");
});

test("the saved copy of whoever is signed in follows their renewed login", async () => {
  const { switcher, state, sessions } = setup(login("a@x.com"));
  await switcher.saveCurrent("claude");
  state.live = login("a@x.com", "renewed-by-the-cli");
  const { live, roster } = await switcher.live("claude");
  assert.equal(live!.email, "a@x.com");
  assert.equal(roster.activeId, "id1");
  assert.equal(sessions.get("claude:id1")!.secret.credentials, "renewed-by-the-cli");
});
