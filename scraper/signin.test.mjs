/**
 * `node --test signin.test.mjs`: the sign-in's parsing, its input mapping, and
 * its lifecycle against a fake browser. HOME points at a temp folder first, so
 * the config a sign-in writes never touches the real ~/.slates.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mock, test } from "node:test";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "slates-signin-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
const signin = await import("./signin.mjs");
const CONFIG = path.join(home, ".slates", "config.json");

const DOMAIN = "fuhsd.schoology.com";
const flush = async () => {
  for (let i = 0; i < 30; i++) await new Promise((resolve) => setImmediate(resolve));
};

/** A context whose pages are on Schoology's signed-in home only once `signedIn` is set. */
function fakeContext() {
  const ctx = { signedIn: false, pages: [] };
  ctx.newPage = async () => {
    const page = fakePage(ctx);
    ctx.pages.push(page);
    return page;
  };
  ctx.newCDPSession = async (page) => page.cdp;
  return ctx;
}

function fakePage(ctx) {
  const handlers = {};
  const cdpHandlers = {};
  const page = {
    href: "about:blank",
    chrome: false,
    field: null,
    closed: false,
    visits: [],
    cdp: {
      sent: [],
      on: (event, fn) => (cdpHandlers[event] = fn),
      emit: (event, payload) => cdpHandlers[event]?.(payload),
      async send(method, params) {
        this.sent.push([method, params]);
        return {};
      },
      async detach() {},
    },
    url: () => page.href,
    async goto(url) {
      page.visits.push(url);
      page.href = ctx.signedIn || !url.endsWith("/home") ? url : `https://${DOMAIN}/login?destination=home`;
      page.chrome = ctx.signedIn;
    },
    setViewportSize: async (view) => (page.viewport = view),
    bringToFront: async () => {},
    goBack: async () => (page.wentBack = true),
    async close() {
      if (page.closed) return;
      page.closed = true;
      handlers.close?.();
    },
    on: (event, fn) => (handlers[event] = fn),
    context: () => ctx,
    locator: () => ({ count: async () => 0 }),
    evaluate: async (fn) => (String(fn).includes("activeElement") ? page.field : page.chrome),
  };
  return page;
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  } catch {
    return {};
  }
}

test("takes a Schoology address however it was pasted, and nothing else", () => {
  assert.equal(signin.schoologyDomain("fuhsd.schoology.com"), DOMAIN);
  assert.equal(signin.schoologyDomain("  https://FUHSD.Schoology.com/home?x=1 "), DOMAIN);
  assert.equal(signin.schoologyDomain("app.schoology.com/"), "app.schoology.com");
  for (const bad of ["", null, undefined, "schoology.com", "evil.com", "fuhsd.schoology.com.evil.com", "fuhsd.schoology.com:8443", "javascript:alert(1)"]) {
    assert.equal(signin.schoologyDomain(bad), null, String(bad));
  }
});

test("sizes the page to the space it's shown in, within bounds", () => {
  assert.deepEqual(signin.viewportFor(undefined, undefined), { width: 1280, height: 800 });
  assert.deepEqual(signin.viewportFor(100, 100), { width: 360, height: 480 });
  assert.deepEqual(signin.viewportFor(5000, 5000), { width: 1280, height: 900 });
  assert.deepEqual(signin.viewportFor(390.6, 700.2), { width: 391, height: 700 });
  assert.deepEqual(signin.viewportFor("wide", -5), { width: 1280, height: 800 });
});

test("turns clicks, keys and typing into CDP input, held to the page", () => {
  const view = { width: 400, height: 600 };
  const click = signin.cdpCalls({ type: "click", x: -10, y: 99_999 }, view);
  assert.deepEqual(
    click.map(([, p]) => [p.type, p.x, p.y]),
    [
      ["mouseMoved", 0, 599],
      ["mousePressed", 0, 599],
      ["mouseReleased", 0, 599],
    ]
  );

  const [down, up] = signin.cdpCalls({ type: "key", key: "Enter" }, view);
  assert.equal(down[1].type, "keyDown");
  assert.equal(down[1].text, "\r", "Enter submits forms only with its text");
  assert.equal(up[1].type, "keyUp");

  const [back] = signin.cdpCalls({ type: "key", key: "Backspace" }, view);
  assert.equal(back[1].type, "rawKeyDown");
  assert.equal(back[1].text, undefined);

  assert.equal(signin.cdpCalls({ type: "key", key: "Tab", shift: true }, view)[0][1].modifiers, 8);
  assert.deepEqual(signin.cdpCalls({ type: "key", key: "SelectAll" }, view)[0][1].commands, ["selectAll"]);

  assert.deepEqual(signin.cdpCalls({ type: "text", text: "me@school.org" }, view), [["Input.insertText", { text: "me@school.org" }]]);
  assert.equal(signin.cdpCalls({ type: "text", text: "x".repeat(5000) }, view)[0][1].text.length, 2000);
  assert.deepEqual(signin.cdpCalls({ type: "text", text: "" }, view), []);

  const [wheel] = signin.cdpCalls({ type: "wheel", x: 10, y: 10, dx: "nope", dy: 1e9 }, view);
  assert.equal(wheel[1].deltaX, 0);
  assert.equal(wheel[1].deltaY, 5000);

  for (const odd of [null, {}, { type: "navigate", url: "https://evil.com" }, { type: "key", key: "F12" }]) {
    assert.deepEqual(signin.cdpCalls(odd, view), []);
  }
});

test("streams the page, takes input only for its own id, and saves the sign-in once Schoology's home shows", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 1_000_000 });
  const ctx = fakeContext();
  let signedIn = 0;
  const opened = await signin.start(ctx, { domain: DOMAIN, width: 390, height: 700, onSignedIn: () => signedIn++ });
  const [page] = ctx.pages;

  assert.equal(opened.active, true);
  assert.deepEqual(opened.viewport, { width: 390, height: 700 });
  assert.deepEqual(page.viewport, { width: 390, height: 700 });
  assert.deepEqual(page.visits, [`https://${DOMAIN}/`]);
  assert.ok(page.cdp.sent.some(([method]) => method === "Page.startScreencast"));

  const frames = [];
  const unsubscribe = signin.subscribe({ frame: (f) => frames.push(f), end: () => frames.push("end") });
  page.cdp.emit("Page.screencastFrame", { data: "jpeg-1", sessionId: 1 });
  assert.deepEqual(frames, ["jpeg-1"]);

  await assert.rejects(signin.input("someone-else", [{ type: "text", text: "x" }]), { status: 409 });
  page.cdp.sent.length = 0;
  await signin.input(opened.id, [
    { type: "text", text: "me@school.org" },
    { type: "key", key: "Enter" },
  ]);
  assert.deepEqual(
    page.cdp.sent.map(([method, p]) => `${method}:${p.text ?? p.type}`),
    ["Input.insertText:me@school.org", "Input.dispatchKeyEvent:\r", "Input.dispatchKeyEvent:keyUp"]
  );

  page.field = { type: "password", inputMode: null };
  assert.deepEqual((await signin.status()).field, { type: "password", inputMode: null });

  // Still on Google: nothing saved, and the session stays open.
  page.href = "https://accounts.google.com/v3/signin/identifier";
  t.mock.timers.tick(2_000);
  await flush();
  assert.equal(signin.isActive(), true);
  assert.equal(readConfig().loggedInAt, undefined);

  // Back from Google on the district's home.
  ctx.signedIn = true;
  page.href = `https://${DOMAIN}/home`;
  page.chrome = true;
  t.mock.timers.tick(2_000);
  await flush();

  assert.equal(signin.isActive(), false);
  assert.equal(signedIn, 1);
  assert.equal(readConfig().domain, DOMAIN);
  assert.ok(readConfig().loggedInAt);
  assert.equal(page.closed, true);
  assert.deepEqual(frames, ["jpeg-1", "end"]);
  assert.deepEqual(await signin.status(), { active: false, id: opened.id, signedIn: true, reason: "signed-in", domain: DOMAIN });
  unsubscribe();
});

test("a signed-in look anywhere but /home is checked in a page of its own, never by moving the student's", async (t) => {
  fs.rmSync(CONFIG, { force: true });
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 2_000_000 });
  const ctx = fakeContext();
  const opened = await signin.start(ctx, { domain: DOMAIN });
  const [page] = ctx.pages;
  const keepWatching = signin.subscribe({ frame() {}, end() {} });

  // A public Schoology page with the app's header, while still signed out.
  page.href = `https://${DOMAIN}/`;
  page.chrome = true;
  t.mock.timers.tick(2_000);
  await flush();
  assert.equal(signin.isActive(), true);
  assert.equal(ctx.pages.length, 2, "one probe page");
  assert.equal(ctx.pages[1].closed, true);
  assert.deepEqual(page.visits, [`https://${DOMAIN}/`], "the student's page wasn't moved");

  // Signed in now, but on app.schoology.com: confirmed by the next probe, not before it's due.
  ctx.signedIn = true;
  page.href = "https://app.schoology.com/home";
  t.mock.timers.tick(2_000);
  await flush();
  assert.equal(ctx.pages.length, 2, "probes are spaced out");
  t.mock.timers.tick(6_000);
  await flush();
  assert.equal(signin.isActive(), false);
  assert.equal((await signin.status()).id, opened.id);
  assert.equal(readConfig().domain, DOMAIN);
  keepWatching();
});

test("closes when nobody's watching, when replaced, and only for the id it was asked to", async (t) => {
  fs.rmSync(CONFIG, { force: true });
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 3_000_000 });
  const ctx = fakeContext();

  const first = await signin.start(ctx, { domain: DOMAIN });
  const second = await signin.start(ctx, { domain: DOMAIN });
  assert.notEqual(first.id, second.id);
  assert.equal(ctx.pages[0].closed, true, "the first device's sign-in closed");

  await signin.stop("closed", first.id);
  assert.equal(signin.isActive(), true, "a stale id doesn't close the new one");

  t.mock.timers.tick(5 * 60_000 + 2_000);
  await flush();
  assert.equal(signin.isActive(), false);
  const ended = await signin.status();
  assert.equal(ended.reason, "idle");
  assert.equal(ended.signedIn, false);
  assert.equal(readConfig().loggedInAt, undefined, "nothing saved");
});

test.after(() => fs.rmSync(home, { recursive: true, force: true }));
