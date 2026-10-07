import assert from "node:assert/strict";
import test from "node:test";

import {
  ALL_ROOMS,
  formatPairingCode,
  initials,
  isAbort,
  nextStep,
  normalizeHostUrl,
  normalizeSchoologyDomain,
  previousStep,
  progressOf,
  providersFor,
  stepsFor,
} from "./flow";
import { answersBefore, createSimEnv, DEFAULT_SCENARIO, sampleHost, type Scenario, type SimEffect } from "./sim";

const everything = { runsOn: "host" as const, rooms: ALL_ROOMS };

test("rooms come first, and each step only shows for the rooms that need it", () => {
  assert.deepEqual(stepsFor(everything), [
    "welcome",
    "rooms",
    "where",
    "prepare",
    "host",
    "pair",
    "schoology",
    "sync",
    "profile",
    "ai",
    "notify",
    "done",
  ]);
  assert.deepEqual(stepsFor({ runsOn: "mac", rooms: ["ui", "usage"] }), ["welcome", "rooms", "where", "profile", "done"]);
  assert.deepEqual(stepsFor({ runsOn: "mac", rooms: ["health"] }), ["welcome", "rooms", "where", "profile", "ai", "done"]);
  assert.deepEqual(stepsFor({ runsOn: null, rooms: [] }), ["welcome", "rooms", "where", "profile", "done"]);
  assert.equal(nextStep("where", { runsOn: "host", rooms: ["agent"] }), "prepare");
  assert.equal(nextStep("pair", { runsOn: "host", rooms: ["agent"] }), "profile");
  assert.equal(nextStep("where", { runsOn: "mac", rooms: ["school"] }), "schoology");
  assert.equal(previousStep("schoology", everything), "pair");
  assert.equal(previousStep("welcome", everything), null);
  assert.equal(nextStep("done", everything), null);
});

test("progress counts within a phase, and not on welcome or done", () => {
  assert.deepEqual(progressOf("pair", everything), { phase: "connect", index: 5, total: 7 });
  assert.deepEqual(progressOf("sync", { runsOn: "mac", rooms: ["school"] }), { phase: "connect", index: 4, total: 4 });
  assert.deepEqual(progressOf("ai", everything), { phase: "yours", index: 2, total: 3 });
  assert.equal(progressOf("welcome", everything), null);
  assert.equal(progressOf("done", everything), null);
});

test("the AI step lists only what the chosen rooms use", () => {
  assert.deepEqual(providersFor(["agent"]), ["cursor-agent"]);
  assert.deepEqual(providersFor(["media"]), ["elevenlabs"]);
  assert.deepEqual(providersFor(["counselor", "health"]), ["openai", "openrouter"]);
  assert.deepEqual(providersFor(["ui", "usage"]), []);
  assert.equal(providersFor(["school"]).length, 5);
});

test("a host address becomes an https Tailscale origin", () => {
  assert.deepEqual(normalizeHostUrl(" gaming-pc.tail4a7e2.ts.net/ "), {
    ok: true,
    url: "https://gaming-pc.tail4a7e2.ts.net",
    name: "gaming-pc",
  });
  assert.deepEqual(normalizeHostUrl("http://Smaran.Tail55de6b.ts.net/api/host"), {
    ok: true,
    url: "https://smaran.tail55de6b.ts.net",
    name: "smaran",
  });
  assert.deepEqual(normalizeHostUrl("https://pc.tail1.ts.net:8443"), { ok: true, url: "https://pc.tail1.ts.net:8443", name: "pc" });
  assert.deepEqual(normalizeHostUrl("  "), { ok: false, problem: "empty" });
  assert.deepEqual(normalizeHostUrl("http://exa mple"), { ok: false, problem: "invalid" });
  assert.deepEqual(normalizeHostUrl("ftp://pc.tail1.ts.net"), { ok: false, problem: "invalid" });
  assert.deepEqual(normalizeHostUrl("my-pc.ngrok.app"), { ok: false, problem: "not-tailscale" });
  assert.deepEqual(normalizeHostUrl("gaming-pc"), { ok: false, problem: "not-tailscale" });
});

test("a Schoology address is read the way login.mjs reads it, and a bare name gets the suffix", () => {
  assert.deepEqual(normalizeSchoologyDomain("https://Northgate.schoology.com/home"), { ok: true, domain: "northgate.schoology.com" });
  assert.deepEqual(normalizeSchoologyDomain("northgate"), { ok: true, domain: "northgate.schoology.com" });
  assert.deepEqual(normalizeSchoologyDomain("app.schoology.com?x=1"), { ok: true, domain: "app.schoology.com" });
  assert.deepEqual(normalizeSchoologyDomain(""), { ok: false, problem: "empty" });
  assert.deepEqual(normalizeSchoologyDomain("classroom.google.com"), { ok: false, problem: "invalid" });
  assert.deepEqual(normalizeSchoologyDomain("schoology.com"), { ok: false, problem: "invalid" });
  assert.deepEqual(normalizeSchoologyDomain("fakeschoology.com"), { ok: false, problem: "invalid" });
});

test("pairing codes keep eight digits, split like the paired device shows them", () => {
  assert.equal(formatPairingCode("47182093"), "4718 2093");
  assert.equal(formatPairingCode("4718-2093-77"), "4718 2093");
  assert.equal(formatPairingCode("47a1"), "471");
  assert.equal(initials("Anika Raghavan"), "AR");
  assert.equal(initials(" anika "), "A");
});

function harness(overrides: Partial<Scenario> = {}) {
  const scenario: Scenario = { ...DEFAULT_SCENARIO, speed: 1000, ...overrides };
  const effects: Omit<SimEffect, "id" | "at">[] = [];
  const env = createSimEnv(() => scenario, (e) => effects.push(e));
  return { env, effects, scenario };
}

test("a slow host is reported slow before it answers", async () => {
  const { env } = harness({ host: "slow" });
  let slow = false;
  const result = await env.checkHost("https://gaming-pc.tail4a7e2.ts.net", { signal: new AbortController().signal, onSlow: () => (slow = true) });
  assert.equal(slow, true);
  assert.equal(result.ok, true);
  const silent = harness({ host: "silent" });
  const lost = await silent.env.checkHost("https://gaming-pc.tail4a7e2.ts.net", { signal: new AbortController().signal, onSlow: () => {} });
  assert.deepEqual(lost, { ok: false, problem: "unreachable" });
});

test("without Tailscale a code is needed, and five wrong ones spend it", async () => {
  const { env } = harness({ pairing: "wrong" });
  const host = sampleHost("win32");
  const signal = new AbortController().signal;
  assert.deepEqual(await env.pair(host, null, signal), { ok: false, problem: "needs-code" });
  for (let i = 0; i < 4; i++) assert.deepEqual(await env.pair(host, "11112222", signal), { ok: false, problem: "wrong" });
  assert.deepEqual(await env.pair(host, "11112222", signal), { ok: false, problem: "too-many" });
  const tailnet = harness({ tailscaleOnMac: true });
  assert.deepEqual(await tailnet.env.pair(host, null, signal), { ok: true, via: "tailscale" });
});

test("choosing a host is marked as plumbing the app doesn't have yet", async () => {
  const { env, effects } = harness();
  await env.connect({ runsOn: "host", host: sampleHost("win32") });
  assert.ok(effects.some((e) => e.missing && e.text.includes("SLATES_HOST=https://gaming-pc.tail4a7e2.ts.net")));
  const session = await env.schoologySession(new AbortController().signal);
  assert.equal(session?.domain, "northgate.schoology.com");
});

test("the first sync reports progress and ends on the board", async () => {
  const { env } = harness();
  const seen: number[] = [];
  const result = await env.sync((p) => seen.push(p.courses), new AbortController().signal);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.summary.courses, 5);
  assert.equal(result.summary.items, 11);
  assert.equal(result.summary.dueThisWeek, 7);
  assert.equal(Math.max(...seen), 5);
  const expired = await harness({ sync: "signed-out" }).env.sync(() => {}, new AbortController().signal);
  assert.deepEqual(expired, { ok: false, problem: "signed-out" });
});

test("leaving a step mid-sign-in aborts it and stops the sync browser's sign-in", async () => {
  const { env, effects } = harness({ speed: 1 });
  const controller = new AbortController();
  const pending = env.signIn("northgate.schoology.com", controller.signal);
  controller.abort();
  await assert.rejects(pending, (e) => isAbort(e));
  assert.ok(effects.some((e) => e.text.includes("/api/scrape/signin/stop")));
});

test("a sign-in ends the ways the sync service ends one", async () => {
  const signal = new AbortController().signal;
  assert.deepEqual(await harness({ signIn: "idle" }).env.signIn("northgate.schoology.com", signal), { ok: false, problem: "idle" });
  assert.deepEqual(await harness({ signIn: "no-service" }).env.signIn("northgate.schoology.com", signal), { ok: false, problem: "no-service" });
  const signed = await harness().env.signIn("northgate.schoology.com", signal);
  assert.equal(signed.ok && signed.session.domain, "northgate.schoology.com");
});

test("a saved key counts as set up the next time providers are read", async () => {
  const { env } = harness();
  const signal = new AbortController().signal;
  assert.equal((await env.providers(signal)).find((p) => p.id === "openai")?.ready, false);
  await env.saveKey("openai", "sk-test");
  assert.equal((await env.providers(signal)).find((p) => p.id === "openai")?.ready, true);
});

test("jumping ahead fills in only the steps already behind you", () => {
  const atSync = answersBefore("sync", everything, DEFAULT_SCENARIO);
  assert.deepEqual(atSync.rooms, [...ALL_ROOMS]);
  assert.equal(atSync.runsOn, "host");
  assert.equal(atSync.host?.name, "gaming-pc");
  assert.equal(atSync.paired, "code");
  assert.equal(atSync.schoology?.domain, "northgate.schoology.com");
  assert.equal(atSync.sync, null);
  const atWhere = answersBefore("where", everything, DEFAULT_SCENARIO);
  assert.equal(atWhere.runsOn, null);
  assert.deepEqual(answersBefore("rooms", everything, DEFAULT_SCENARIO).rooms, []);
  const onMac = answersBefore("done", { runsOn: "mac", rooms: ["school", "health"] }, DEFAULT_SCENARIO);
  assert.equal(onMac.host, null);
  assert.equal(onMac.name, "Anika");
  assert.deepEqual(onMac.rooms, ["school", "health"]);
});
