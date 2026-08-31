/**
 * Live view of a real Schoology page, rendered inside Slates.
 *
 * Schoology cannot be iframed — it sends `X-Frame-Options: SAMEORIGIN` and
 * `Content-Security-Policy: frame-ancestors 'self'`, both enforced by the
 * browser and not overridable by the embedding page. Stripping those through a
 * rewriting proxy was the other option and a bad one: the assessment player is
 * an SPA that talks to a separate submission host, holds a server-side session
 * lock, and heartbeats every two minutes. A proxy that half-worked mid-exam
 * would burn a real attempt.
 *
 * So instead of moving the page to the browser, this moves the browser to the
 * page: the scraper's already-authenticated Chrome opens the assessment, and
 * its frames are streamed out via CDP screencast while clicks and keystrokes
 * are dispatched back in. Schoology sees an ordinary browser session, because
 * that is exactly what it is.
 */

const VIEWPORT = { width: 1280, height: 800 };

/** At most one attempt runs at a time — it shares the scraper's browser. */
let session = null;

export function isActive() {
  return session !== null;
}

export function status() {
  if (!session) return { active: false, finished: lastFinished };
  return {
    active: true,
    url: session.page.url(),
    startedAt: session.startedAt,
    viewport: VIEWPORT,
    attemptsAtStart: session.attemptsAtStart,
    // Set once Schoology shows the attempt as handed in.
    finished: session.finished,
  };
}

/**
 * Survives the session being torn down, so the portal can still learn that the
 * last attempt was submitted even if it asks after closing the viewer.
 */
let lastFinished = false;

/** Read Schoology's assessment config out of the live page, if it's showing one. */
async function readAttemptState(page) {
  return page
    .evaluate(() => {
      const text = (document.body.innerText || "").replace(/\s+/g, " ");
      let taken = null;
      for (const script of document.querySelectorAll("script")) {
        const m = /"numAttemptsTaken"\s*:\s*(\d+)/.exec(script.textContent || "");
        if (m) {
          taken = Number(m[1]);
          break;
        }
      }
      return {
        taken,
        // Belt and braces: the landing page says this after a completed attempt.
        submittedText:
          /your submission has been received|attempt submitted|submitted for grading|you have made \d+ of/i.test(
            text
          ),
      };
    })
    .catch(() => ({ taken: null, submittedText: false }));
}

/**
 * Watch for the attempt being handed in.
 *
 * Schoology returns to the assessment landing page once an attempt is
 * submitted, and that page carries the attempt count in its embedded config.
 * A count higher than the one we started with means the work went in — which is
 * the signal Slates uses to tick the assignment off without waiting for the
 * next five-minute crawl.
 */
async function pollFinished() {
  if (!session || session.finished) return;
  const { taken } = await readAttemptState(session.page);
  if (taken === null || session.attemptsAtStart === null) return;
  if (taken > session.attemptsAtStart) {
    session.finished = true;
    lastFinished = true;
    console.log(
      `[${new Date().toLocaleTimeString()}] attempt submitted (${session.attemptsAtStart} -> ${taken})`
    );
  }
}

/** Subscribers receive base64 JPEG frames as they arrive. */
function broadcast(frame) {
  if (!session) return;
  for (const send of session.listeners) {
    try {
      send(frame);
    } catch {
      /* a dead SSE connection is dropped on its own close handler */
    }
  }
}

export function subscribe(send) {
  if (!session) return () => {};
  session.listeners.add(send);
  session.idleSince = null;
  // Paint immediately rather than waiting for the next repaint, which on a
  // static page can be a long time coming.
  if (session.lastFrame) send(session.lastFrame);

  return () => {
    if (!session) return;
    session.listeners.delete(send);
    if (session.listeners.size === 0) session.idleSince = Date.now();
  };
}

/**
 * Close an abandoned attempt.
 *
 * The portal stops its session on unmount, but a closed laptop lid or a killed
 * tab never gets to run that. A session left open holds a page in the shared
 * browser and — worse — keeps background sync paused, so assignments quietly
 * stop updating. Nothing viewing it for a while means nobody is taking it.
 */
const IDLE_MS = 90_000;

setInterval(() => {
  if (!session || session.listeners.size > 0) return;
  const since = session.idleSince ?? session.startedAt;
  if (Date.now() - since < IDLE_MS) return;
  console.log(`[${new Date().toLocaleTimeString()}] attempt closed — no viewer for 90s`);
  void stop();
}, 15_000).unref();

export async function start(ctx, url) {
  if (session) await stop();

  const page = await ctx.newPage();
  await page.setViewportSize(VIEWPORT);

  const cdp = await ctx.newCDPSession(page);
  session = {
    page,
    cdp,
    listeners: new Set(),
    lastFrame: null,
    startedAt: Date.now(),
    idleSince: null,
    attemptsAtStart: null,
    finished: false,
  };
  lastFinished = false;

  cdp.on("Page.screencastFrame", async ({ data, sessionId }) => {
    if (!session) return;
    session.lastFrame = data;
    broadcast(data);
    // Chrome pauses the screencast until each frame is acknowledged.
    await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 70,
    maxWidth: VIEWPORT.width,
    maxHeight: VIEWPORT.height,
    everyNthFrame: 1,
  });

  // Baseline to compare against — anything above this means an attempt landed.
  session.attemptsAtStart = (await readAttemptState(page)).taken;
  session.watcher = setInterval(() => void pollFinished(), 4000);

  return status();
}

export async function stop() {
  if (!session) return;
  const { page, cdp, watcher } = session;
  // One last look before tearing down: the attempt may have been handed in
  // moments before the viewer closed.
  await pollFinished().catch(() => {});
  clearInterval(watcher);
  session = null;
  await cdp.send("Page.stopScreencast").catch(() => {});
  await cdp.detach().catch(() => {});
  await page.close().catch(() => {});
}

/*
 * Keys that carry no printable text still have to arrive as real key events —
 * editors and quiz widgets listen for them directly. Everything printable goes
 * through Input.insertText instead, which avoids hand-maintaining a keycode
 * table for every character and every layout.
 */
const KEYS = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  Escape: 27,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Delete: 46,
};

const BUTTONS = ["left", "middle", "right"];

/** Forward one input event from the browser into the real page. */
export async function input(event) {
  if (!session) throw new Error("No attempt is running");
  const { cdp } = session;

  const mods =
    (event.alt ? 1 : 0) | (event.ctrl ? 2 : 0) | (event.meta ? 4 : 0) | (event.shift ? 8 : 0);

  switch (event.type) {
    case "move":
      return cdp.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: event.x,
        y: event.y,
        modifiers: mods,
      });

    case "down":
    case "up":
      return cdp.send("Input.dispatchMouseEvent", {
        type: event.type === "down" ? "mousePressed" : "mouseReleased",
        x: event.x,
        y: event.y,
        button: BUTTONS[event.button ?? 0] ?? "left",
        clickCount: event.clickCount ?? 1,
        modifiers: mods,
      });

    case "wheel":
      return cdp.send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: event.x,
        y: event.y,
        deltaX: event.deltaX ?? 0,
        deltaY: event.deltaY ?? 0,
        modifiers: mods,
      });

    case "text":
      return cdp.send("Input.insertText", { text: event.text });

    case "key": {
      const code = KEYS[event.key];
      if (!code) return; // printable keys arrive as "text"
      for (const type of ["keyDown", "keyUp"]) {
        await cdp.send("Input.dispatchKeyEvent", {
          type,
          key: event.key,
          code: event.key,
          windowsVirtualKeyCode: code,
          nativeVirtualKeyCode: code,
          modifiers: mods,
        });
      }
      return;
    }

    default:
      throw new Error(`Unknown input type: ${event.type}`);
  }
}
