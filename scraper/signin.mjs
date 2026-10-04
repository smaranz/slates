/**
 * Signing in to Schoology from Slates' Settings, in the sync browser itself.
 *
 * `npm run login` opens a window on the machine that runs the sync and waits
 * for someone there to sign in. That machine is the PC, running headless,
 * while the student is on a laptop or a phone, so an expired session meant a
 * trip to the PC and a terminal. Instead this opens Schoology in the sync
 * browser and streams it into Slates the way a live attempt is (attempt.mjs):
 * frames out through CDP's screencast, clicks and keys back in. The student
 * signs in as they would anywhere, Google and two-step included, and the
 * session lands in the very profile the sync reads with, so nothing is copied
 * between browsers and it renews the way any sign-in there does.
 *
 * Keys go into the page and nowhere else: nothing here logs, keeps or reads
 * what is typed. The sign-in is noticed from Schoology's own signed-in home.
 */
import { randomUUID } from "node:crypto";
import { isLoggedIn, onSchoologyHome, writeConfig } from "./browser.mjs";

/** The page's size when the caller doesn't say: the attempt viewer's. */
const VIEW = { width: 1280, height: 800 };
/** Nobody watching for this long means nobody is signing in. */
const IDLE_MS = 5 * 60_000;
/** Room for an SSO hop and a two-step code, as `npm run login` allows. */
const MAX_MS = 15 * 60_000;
const CHECK_MS = 2_000;
/** A signed-in look anywhere but the district's /home is double-checked, at most this often. */
const CONFIRM_MS = 8_000;
const MAX_EVENTS = 200;
const MAX_TEXT = 2_000;

/** `<district>.schoology.com` out of whatever was typed or pasted, or null. */
export function schoologyDomain(input) {
  const host = String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[/?#].*$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.schoology\.com$/.test(host) ? host : null;
}

function bounded(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(Math.min(max, Math.max(min, n))) : fallback;
}

/** The space Slates has for the page, within what a sign-in page lays out well in. */
export function viewportFor(width, height) {
  return { width: bounded(width, 360, 1280, VIEW.width), height: bounded(height, 480, 900, VIEW.height) };
}

const KEYS = {
  // Enter carries its "\r", or a form wouldn't submit the way it does from a real keyboard.
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Tab: { code: "Tab", keyCode: 9 },
  Backspace: { code: "Backspace", keyCode: 8 },
  Delete: { code: "Delete", keyCode: 46 },
  Escape: { code: "Escape", keyCode: 27 },
  Home: { code: "Home", keyCode: 36 },
  End: { code: "End", keyCode: 35 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
};

/**
 * The CDP calls one event from Slates becomes. Anything unrecognised becomes
 * nothing, and every coordinate is held to the page.
 */
export function cdpCalls(event, view) {
  const at = () => ({
    x: Math.round(Math.min(view.width - 1, Math.max(0, Number(event.x) || 0))),
    y: Math.round(Math.min(view.height - 1, Math.max(0, Number(event.y) || 0))),
  });
  const delta = (v) => Math.max(-5000, Math.min(5000, Number(v) || 0));

  switch (event?.type) {
    case "click": {
      const p = at();
      return [
        ["Input.dispatchMouseEvent", { type: "mouseMoved", ...p }],
        ["Input.dispatchMouseEvent", { type: "mousePressed", ...p, button: "left", buttons: 1, clickCount: 1 }],
        ["Input.dispatchMouseEvent", { type: "mouseReleased", ...p, button: "left", buttons: 0, clickCount: 1 }],
      ];
    }
    case "wheel":
      return [["Input.dispatchMouseEvent", { type: "mouseWheel", ...at(), deltaX: delta(event.dx), deltaY: delta(event.dy) }]];
    case "text": {
      const text = typeof event.text === "string" ? event.text.slice(0, MAX_TEXT) : "";
      return text ? [["Input.insertText", { text }]] : [];
    }
    case "key": {
      // An editing command, not a shortcut: select-all is Ctrl+A on the PC and Cmd+A on a Mac.
      if (event.key === "SelectAll") {
        const a = { key: "a", code: "KeyA", windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 };
        return [
          ["Input.dispatchKeyEvent", { type: "rawKeyDown", ...a, commands: ["selectAll"] }],
          ["Input.dispatchKeyEvent", { type: "keyUp", ...a }],
        ];
      }
      const key = KEYS[event.key];
      if (!key) return [];
      const common = {
        key: event.key,
        code: key.code,
        windowsVirtualKeyCode: key.keyCode,
        nativeVirtualKeyCode: key.keyCode,
        modifiers: event.shift ? 8 : 0,
      };
      return [
        ["Input.dispatchKeyEvent", key.text ? { type: "keyDown", ...common, text: key.text, unmodifiedText: key.text } : { type: "rawKeyDown", ...common }],
        ["Input.dispatchKeyEvent", { type: "keyUp", ...common }],
      ];
    }
    default:
      return [];
  }
}

/** The one sign-in open now, if any. */
let session = null;
/** How the last one ended, for a caller that looks after it has closed. */
let last = null;
/** One opens at a time, in the order asked, so two devices can't both hold one. */
let opening = Promise.resolve();

export function isActive() {
  return session !== null;
}

/** `promise`, or `fallback` if it takes longer than `ms`: a page mid-navigation can stall a call. */
function within(promise, ms, fallback) {
  let timer;
  return Promise.race([promise, new Promise((resolve) => (timer = setTimeout(resolve, ms, fallback)))]).finally(() =>
    clearTimeout(timer)
  );
}

/** The focused field's kind, so a phone can bring up the right keyboard. Never what's in it. */
function focusedField(page) {
  const read = page.evaluate(() => {
    const el = document.activeElement;
    if (el instanceof HTMLTextAreaElement) return { type: "text", inputMode: el.inputMode || null };
    if (el instanceof HTMLInputElement) return { type: el.type || "text", inputMode: el.inputMode || null };
    return null;
  });
  return within(read.catch(() => null), 1_000, null);
}

/** What Settings polls: whether the sign-in is still open, and what has the page's focus. */
export async function status() {
  const s = session;
  if (!s) {
    return {
      active: false,
      id: last?.id ?? null,
      signedIn: last?.signedIn ?? false,
      reason: last?.reason ?? null,
      domain: last?.domain ?? null,
    };
  }
  s.seenAt = Date.now();
  return { active: true, id: s.id, domain: s.domain, viewport: s.view, field: await focusedField(s.page) };
}

/**
 * Open Schoology in a page of its own and start streaming it. A sign-in
 * already open (on another device, say) closes first.
 */
export function start(ctx, options) {
  const run = opening.then(() => open(ctx, options));
  opening = run.catch(() => {});
  return run;
}

async function open(ctx, { domain, width, height, onSignedIn }) {
  if (session) await end(session, false, "replaced");
  const view = viewportFor(width, height);
  const page = await ctx.newPage();
  const s = {
    id: randomUUID(),
    domain,
    view,
    page,
    cdp: null,
    listeners: new Set(),
    frame: null,
    startedAt: Date.now(),
    seenAt: Date.now(),
    checking: false,
    confirmedAt: 0,
    watcher: null,
    onSignedIn,
  };
  try {
    await page.setViewportSize(view);
    await page.bringToFront().catch(() => {});
    s.cdp = await ctx.newCDPSession(page);
    s.cdp.on("Page.screencastFrame", ({ data, sessionId }) => {
      if (session === s) {
        s.frame = data;
        for (const listener of s.listeners) listener.frame(data);
      }
      // Chrome holds the next frame back until this one is acknowledged.
      s.cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    });
    await s.cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 75,
      maxWidth: view.width,
      maxHeight: view.height,
      everyNthFrame: 1,
    });
  } catch (e) {
    await page.close().catch(() => {});
    throw e;
  }
  page.on("close", () => void end(s, false, "closed"));
  page.on("crash", () => void end(s, false, "crashed"));
  session = s;
  last = null;
  s.watcher = setInterval(() => void watch(s), CHECK_MS);
  // Not awaited: the student watches it load rather than waiting on a spinner.
  void page.goto(`https://${domain}/`, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => {});
  return status();
}

/** Frames as they're painted, the latest first; `end` once the sign-in closes. */
export function subscribe(listener) {
  const s = session;
  if (!s) return () => {};
  s.listeners.add(listener);
  s.seenAt = Date.now();
  if (s.frame) listener.frame(s.frame);
  return () => {
    s.listeners.delete(listener);
    s.seenAt = Date.now();
  };
}

/** A batch of the student's clicks and keys, in order, for the sign-in they opened. */
export async function input(id, events) {
  const s = session;
  if (!s || s.id !== id) {
    throw Object.assign(new Error("This sign-in has closed. Open it again from Settings."), { status: 409 });
  }
  s.seenAt = Date.now();
  for (const event of (Array.isArray(events) ? events : []).slice(0, MAX_EVENTS)) {
    if (session !== s) return;
    if (event?.type === "nav") await navigate(s, event.to);
    else for (const [method, params] of cdpCalls(event, s.view)) await s.cdp.send(method, params);
  }
}

async function navigate(s, to) {
  if (to === "back") await s.page.goBack({ timeout: 15_000 }).catch(() => {});
  if (to === "start") {
    void s.page.goto(`https://${s.domain}/`, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => {});
  }
}

/** Close the open sign-in, or only the one named if it's still the one open. */
export async function stop(reason = "closed", id = null) {
  if (session && (!id || session.id === id)) await end(session, false, reason);
}

async function watch(s) {
  if (session !== s || s.checking) return;
  const now = Date.now();
  if (now - s.startedAt > MAX_MS) return end(s, false, "expired");
  if (!s.listeners.size && now - s.seenAt > IDLE_MS) return end(s, false, "idle");
  s.checking = true;
  try {
    if (await signedIn(s)) await end(s, true, "signed-in");
  } finally {
    s.checking = false;
  }
}

/**
 * Signed in means a page of Schoology's own, with its header and no sign-in
 * form: what a sync needs to find. The district's /home settles it, since it
 * sends anyone signed out to the login page. Anywhere else (a public page
 * with the same header, app.schoology.com on the way back from Google) is
 * checked against the district's /home in a page of its own, so the
 * student's page is never moved out from under them.
 */
async function signedIn(s) {
  const { page } = s;
  if (!(await onSchoologyHome(page)) || !(await isLoggedIn(page))) return false;
  const here = new URL(page.url());
  if (here.hostname === s.domain && here.pathname.startsWith("/home")) return true;
  if (Date.now() - s.confirmedAt < CONFIRM_MS) return false;
  s.confirmedAt = Date.now();
  const probe = await page.context().newPage();
  try {
    await probe.goto(`https://${s.domain}/home`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const there = new URL(probe.url());
    return (
      there.hostname === s.domain &&
      there.pathname.startsWith("/home") &&
      (await onSchoologyHome(probe)) &&
      (await isLoggedIn(probe))
    );
  } catch {
    return false;
  } finally {
    await probe.close().catch(() => {});
  }
}

async function end(s, signedIn, reason) {
  if (session !== s) return;
  session = null;
  clearInterval(s.watcher);
  if (signedIn) writeConfig({ domain: s.domain, loggedInAt: new Date().toISOString() });
  last = { id: s.id, domain: s.domain, signedIn, reason, at: Date.now() };
  for (const listener of s.listeners) listener.end();
  s.listeners.clear();
  await s.cdp?.send("Page.stopScreencast").catch(() => {});
  await s.cdp?.detach().catch(() => {});
  await s.page.close().catch(() => {});
  if (signedIn) s.onSignedIn?.();
}
