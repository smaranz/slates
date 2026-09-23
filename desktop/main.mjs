import { app, BrowserWindow, session, shell, dialog } from "electron";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Slates as a desktop app.
 *
 * Slates is three processes, not one page: the Next.js portal, the local
 * scraper that holds the Schoology session, and the Chrome it drives. Asking
 * someone to start two terminals before opening a browser tab is not an app.
 * This owns the whole stack — one icon starts everything and quitting stops it.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");

/**
 * The PATH a terminal would have.
 *
 * An app launched from the Dock inherits LaunchServices' environment, which is
 * `/usr/bin:/bin:/usr/sbin:/sbin` and nothing else — no Homebrew, no
 * ~/.local/bin, no npm or pnpm globals. Every CLI Slates drives lives in one
 * of those: the tutor's Claude Code and Cursor backends both do. So from the
 * Dock they simply aren't found, while the same build launched from a terminal
 * works perfectly, which is a miserable bug to be on the receiving end of.
 *
 * Asking the login shell is how a GUI app on macOS learns the PATH its owner
 * actually has. The well-known directories are appended as a fallback for a
 * shell that fails to answer, and the result is cached — a login shell takes a
 * moment to start, and this is on the path to the first window.
 */
/**
 * A real Node binary, if the machine has one.
 *
 * The portal is a Node server, and it was being run as Electron-as-node —
 * which works right up until something loads a native addon. The Cursor SDK
 * lazily loads tree-sitter's `binding.node` partway through an agent run;
 * those are built against stock Node's ABI, and registering them inside
 * Electron segfaults the process (EXC_BAD_ACCESS in node_module_register).
 * The whole portal died mid-request, taking every other feature with it, and
 * left nothing in the log because a SIGSEGV has nothing to say.
 *
 * Electron-as-node stays as the fallback, so an install with no Node still
 * runs — it just can't use the backends that pull in native modules.
 */
let cachedNode = null;
function nodeBinary() {
  if (cachedNode !== null) return cachedNode;
  try {
    const found = execFileSync("/bin/sh", ["-c", "command -v node"], {
      env: { ...process.env, PATH: userPath() },
      encoding: "utf8",
      timeout: 5000,
    }).trim();
    cachedNode = found && fs.existsSync(found) ? found : "";
  } catch {
    cachedNode = "";
  }
  return cachedNode;
}

let cachedPath = null;
function userPath() {
  if (cachedPath) return cachedPath;

  let fromShell = "";
  try {
    const shell = process.env.SHELL || "/bin/zsh";
    // -i so rc files that set PATH are read, -l for the login profile.
    fromShell = execFileSync(shell, ["-ilc", 'printf %s "$PATH"'], {
      encoding: "utf8",
      timeout: 8000,
    }).trim();
  } catch {
    // A shell that won't start non-interactively is not a reason to give up.
  }

  const home = os.homedir();
  const fallbacks = [
    path.join(home, ".local/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(home, ".bun/bin"),
    path.join(home, "Library/pnpm"),
    path.join(home, ".npm-global/bin"),
    path.join(home, ".cargo/bin"),
  ];

  const seen = new Set();
  cachedPath = [...fromShell.split(":"), ...(process.env.PATH || "").split(":"), ...fallbacks]
    .filter((dir) => dir && !seen.has(dir) && seen.add(dir))
    .join(":");

  return cachedPath;
}

/*
 * Slates' own block — 7528 is S-L-A-T on a phone keypad. It used to be 3000
 * and 4000, the two most contested ports on a developer's machine, and the
 * collision was worse than an annoyance: `ensure()` below treats a healthy
 * socket as "already running", so when another project held 3000 the app
 * opened its window onto that project's site instead of Slates.
 *
 * Kept in step with web/lib/ports.ts and scraper/serve.mjs, which cannot
 * import from here.
 */
const PORTAL = Number(process.env.SLATES_PORT || 7528);
const SCRAPER = Number(process.env.SLATES_SCRAPER_PORT || 7529);

/**
 * OPENAI_API_KEY and friends, for a process that never has them otherwise.
 *
 * The portal's `.env.local` only matters to `next dev` — the packaged
 * standalone `server.js` doesn't read `.env` files at all (Next builds that
 * output assuming a container that injects real env vars), and this app
 * itself is launched from Finder/Dock/`open`, which hands every process a
 * bare environment with none of a login shell's exports. A `.env` file
 * copied next to the packaged server does nothing, and `npm run dist`
 * overwrites it on every rebuild besides. `~/.slates` is the one place
 * that already survives both, since the scraper's own config lives there.
 */
const USER_ENV_FILE = path.join(os.homedir(), ".slates", ".env");

function readUserEnv() {
  try {
    const out = {};
    for (const line of fs.readFileSync(USER_ENV_FILE, "utf8").split("\n")) {
      const m = /^\s*([\w.-]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m || line.trim().startsWith("#")) continue;
      out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

/** Set by `npm run dev` so the window points at an already-running dev server. */
const ATTACH = process.env.SLATES_ATTACH === "1";

/**
 * Run the whole back end on another machine.
 *
 * Set `SLATES_HOST` and this app stops being three processes and becomes one
 * window. Nothing is spawned here: no portal, no scraper, no Chrome for
 * Schoology, and none of the CLIs a tutor reply shells out to. All of that
 * lives wherever the portal is, which is the point — a Mac with 4GB of swap
 * should not be running a headless browser so a gaming PC can idle.
 *
 * Read from the environment or from `~/.slates/.env`, because it has to be
 * known before the window loads anything, which is long before Settings exists
 * to ask in.
 *
 *   SLATES_HOST=https://gaming-pc.tail1234.ts.net
 *
 * Use Tailscale Serve, not a public tunnel. The portal has no login in front
 * of it and its scraper holds a live Schoology session, so anything that can
 * open the URL can act as you. Serve publishes to your tailnet only; Funnel,
 * ngrok and Cloudflare tunnels publish to the internet.
 *
 * The scraper stays bound to localhost *on that machine* and is never exposed
 * — the portal is the only thing that talks to it, and they share a host.
 */
const REMOTE = (process.env.SLATES_HOST || readUserEnv().SLATES_HOST || "").trim().replace(/\/+$/, "");

const children = [];
let win = null;

function run(name, command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...readUserEnv(),
      // Children shell out to claude and cursor-agent; see userPath().
      PATH: userPath(),
      SLATES_SCRAPER_PORT: String(SCRAPER),
      // What Next's standalone server.js reads to pick its socket.
      PORT: String(PORTAL),
      HOSTNAME: "127.0.0.1",
      // Electron's binary is also a Node runtime, but only with this set —
      // without it, handing it a .mjs makes it try to launch a second app.
      // Using it means the scraper needs no system Node install.
      ...(command === process.execPath ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    },
  });
  const log = (buf) => process.stdout.write(`[${name}] ${buf}`);
  child.stdout.on("data", log);
  child.stderr.on("data", log);
  child.on("exit", (code) => console.log(`[${name}] exited (${code})`));
  children.push(child);
  return child;
}

async function answers(port, timeoutMs = 1500) {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(timeoutMs) });
    return true;
  } catch {
    return false;
  }
}

/**
 * The same check against a full URL, for a portal on another machine.
 *
 * Any answer counts, including a 404 — this is asking "is something serving
 * here", not "is this page fine". The timeout is longer than the local one
 * because the first request over a tailnet has to bring a connection up.
 */
/** Just the hostname, so the boot screen says "gaming-pc" not a full URL. */
function hostLabel(url) {
  try {
    return new URL(url).hostname.split(".")[0] || url;
  } catch {
    return url;
  }
}

async function answersUrl(url, timeoutMs = 4000) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
    return true;
  } catch {
    return false;
  }
}

/** Wait for a remote portal, saying why it is taking a while rather than stalling. */
async function waitForRemote(url, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let slow = false;
  while (Date.now() < deadline) {
    if (await answersUrl(url)) return true;
    if (!slow && Date.now() > deadline - timeoutMs + 8000) {
      slow = true;
      boot("note", "Still reaching your host — it has to be awake and on your tailnet.");
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
}

/**
 * Tell the splash what's happening.
 *
 * Calls into the page rather than going through IPC and a preload script: the
 * splash is a local file with no privileges, and this keeps the renderer
 * sandboxed exactly as the portal window is. A failed call is ignored — losing
 * a progress line must never take the launch down with it.
 */
function boot(fn, ...args) {
  if (!win || win.isDestroyed()) return;
  const call = `window.slatesBoot && window.slatesBoot.${fn}(${args.map((a) => JSON.stringify(a)).join(", ")})`;
  win.webContents.executeJavaScript(call).catch(() => {});
}

/** Resolve once a port answers, so the window never opens on a dead server. */
async function waitForPort(port, label, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let slow = false;
  while (Date.now() < deadline) {
    if (await answers(port)) return true;
    // A first run compiles and a cold Schoology scrape is slow; say so rather
    // than letting a long wait look like a stall.
    if (!slow && Date.now() > deadline - timeoutMs + 12_000) {
      slow = true;
      boot("note", `${label} is taking a while — first start after an update usually does.`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`${label} did not start on port ${port}`);
}

/**
 * Start a service only if nothing is already serving that port. Running the
 * app while a terminal already has the dev servers up would otherwise spawn
 * duplicates that die on EADDRINUSE and take the launch down with them.
 */
async function ensure(name, port, command, args, cwd, label) {
  if (await answers(port)) {
    console.log(`[${name}] already running on ${port} — attaching`);
    boot("step", name, `${label} — already running`, "done");
    return;
  }
  boot("step", name, label, "active");
  run(name, command, args, cwd);
}

/**
 * The isolated session the UI tab browses in, and the hosts whose framing
 * headers are rewritten inside it.
 *
 * Kept in step with `needsFrameUnlock` in web/lib/ui-libraries.ts. A host not
 * named here is loaded exactly as its server sent it.
 */
const UI_PARTITION = "persist:uilibs";
const FRAME_UNLOCK_HOSTS = new Set(["bencho.dev", "tabler.io", "kage.design"]);

/**
 * Let the UI tab embed libraries that refuse to be framed.
 *
 * Three of the thirty-three send `X-Frame-Options` or a `frame-ancestors` CSP
 * naming only their own origin, which paints a blank pane and logs nothing.
 * Both directives are dropped for those hosts — and only those hosts — so the
 * page draws. Everything else in each site's CSP is passed through untouched,
 * so its own script and connect rules still bind inside the guest.
 *
 * This runs on a partition of its own, never the default session: cookies from
 * thirty outside sites have no business sharing a jar with the Schoology
 * portal, and this rewriting must never touch anything Slates itself loads.
 */
function prepareUiSession() {
  const uiSession = session.fromPartition(UI_PARTITION);

  uiSession.webRequest.onHeadersReceived((details, callback) => {
    let host = "";
    try {
      host = new URL(details.url).hostname;
    } catch {
      // A data: or blob: URL inside a guest page. Nothing to rewrite.
    }

    if (!FRAME_UNLOCK_HOSTS.has(host)) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }

    const headers = {};
    for (const [name, value] of Object.entries(details.responseHeaders ?? {})) {
      const key = name.toLowerCase();
      if (key === "x-frame-options") continue;
      if (key === "content-security-policy" || key === "content-security-policy-report-only") {
        const kept = (Array.isArray(value) ? value : [value])
          .map((v) =>
            String(v)
              .split(";")
              .filter((directive) => !/^\s*frame-ancestors\b/i.test(directive))
              .join(";")
          )
          .filter((v) => v.trim());
        if (kept.length) headers[name] = kept;
        continue;
      }
      headers[name] = value;
    }
    callback({ responseHeaders: headers });
  });
}


/**
 * Carrying the record across a port change.
 *
 * Browser storage is scoped to an origin, and an origin includes the port. So
 * moving the portal from 3000 to 7528 did not move a single tutor chat, essay
 * or tracked minute with it: the data is all still there, filed under
 * `http://localhost:3000`, and the app on the new port opens onto an empty
 * bucket. Nothing is lost and nothing is visible, which is the worst of both.
 *
 * The only way to read another origin's storage is to be that origin, so this
 * loads a page on the old one in a hidden window and reads it there. Any page
 * will do — the storage belongs to the origin, not to whatever happens to be
 * serving it — but a request that 404s is preferable to executing some other
 * project's JavaScript, and when the port is free we answer it ourselves.
 *
 * It runs once. The marker is written even when there was nothing to move, so
 * a fresh install doesn't do this on every launch.
 */
const MIGRATION_MARK = path.join(app.getPath("userData"), "storage-origin-migrated");
const LEGACY_PORTS = [3000];

/**
 * Carry the board onto a remote portal the first time it is used.
 *
 * `localStorage` is keyed by origin, and `http://localhost:7528` and
 * `https://pc.tailnet.ts.net` are different origins — so pointing the app at
 * another machine otherwise opens on an empty board, which looks exactly like
 * data loss even though nothing was lost.
 *
 * The source origin has nothing serving it in remote mode (the local portal is
 * never started), but that does not matter: `copyOrigin` stands a throwaway
 * server on the port so the hidden window has something to load, and the
 * storage it reads belongs to the origin rather than to whatever answered.
 *
 * Marked per host, because moving to a second machine later is a separate
 * event, and never clobbers a key the remote origin already has — so a board
 * you have since used over there wins over the stale local copy.
 */
async function migrateStorageToRemote(remoteUrl) {
  let mark;
  try {
    mark = path.join(
      app.getPath("userData"),
      `storage-remote-migrated-${new URL(remoteUrl).host.replace(/[^\w.-]/g, "_")}`
    );
  } catch {
    return 0;
  }
  if (fs.existsSync(mark)) return 0;

  let moved = 0;
  for (const port of [PORTAL, ...LEGACY_PORTS]) {
    try {
      moved += await copyOrigin(port, remoteUrl);
    } catch (e) {
      console.log(`[migrate] ${port} -> remote: ${e instanceof Error ? e.message : e}`);
    }
  }

  try {
    fs.writeFileSync(mark, `${new Date().toISOString()} moved=${moved}\n`);
  } catch {
    // Retrying next launch is safe; the copy never overwrites.
  }

  if (moved) console.log(`[migrate] carried ${moved} keys onto ${remoteUrl}`);
  return moved;
}

async function migrateStorageOrigins(target) {
  if (fs.existsSync(MIGRATION_MARK)) return;

  let moved = 0;
  for (const port of LEGACY_PORTS) {
    if (port === PORTAL) continue;
    try {
      moved += await copyOrigin(port, `http://localhost:${target}/`);
    } catch (e) {
      console.log(`[migrate] ${port}: ${e instanceof Error ? e.message : e}`);
    }
  }

  try {
    fs.writeFileSync(MIGRATION_MARK, `${new Date().toISOString()} moved=${moved}\n`);
  } catch {
    // A marker we can't write means we try again next launch, which is safe:
    // the copy never overwrites a key the new origin already has.
  }

  if (moved) console.log(`[migrate] carried ${moved} keys onto port ${PORTAL}`);
  return moved;
}

async function copyOrigin(from, targetUrl) {
  // Hold the old port ourselves when it's free, so the hidden window has
  // something harmless to load.
  let stand = null;
  if (!(await answers(from, 400))) {
    const { createServer } = await import("node:http");
    stand = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html><title>Slates</title>");
    });
    await new Promise((resolve) => stand.listen(from, "127.0.0.1", resolve));
  }

  const ghost = new BrowserWindow({ show: false, webPreferences: { partition: undefined } });
  try {
    await ghost.loadURL(`http://localhost:${from}/__slates-storage-migration`).catch(() => {});

    const payload = await ghost.webContents.executeJavaScript(`
      (() => {
        const out = {};
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith("slates.")) out[k] = localStorage.getItem(k);
        }
        return JSON.stringify(out);
      })()
    `);

    const entries = Object.entries(JSON.parse(payload || "{}"));
    if (!entries.length) return 0;

    // Write them on the new origin, never clobbering something already there.
    const live = new BrowserWindow({ show: false });
    try {
      await live.loadURL(targetUrl);
      const written = await live.webContents.executeJavaScript(`
        (() => {
          const incoming = ${JSON.stringify(Object.fromEntries(entries))};
          let n = 0;
          for (const [k, v] of Object.entries(incoming)) {
            if (localStorage.getItem(k) === null) { localStorage.setItem(k, v); n++; }
          }
          return n;
        })()
      `);
      return written;
    } finally {
      live.destroy();
    }
  } finally {
    ghost.destroy();
    if (stand) await new Promise((r) => stand.close(r));
  }
}

function createWindow() {
  prepareUiSession();

  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 900,
    minHeight: 600,
    show: false,
    // Keep the traffic lights but drop the OS title bar — the app draws its
    // own chrome, and a stacked title bar would waste a row above it.
    titleBarStyle: "hiddenInset",
    // Centre the lights in the 40px strip the sidebar reserves for them.
    trafficLightPosition: { x: 16, y: 14 },
    backgroundColor: "#1e1e1e",
    webPreferences: {
      // Nothing here needs Node, and the window renders a local page that
      // proxies to the scraper. Keep the renderer sandboxed.
      nodeIntegration: false,
      contextIsolation: true,
      // The UI tab embeds third-party component libraries in <webview>. Each
      // guest runs in its own process on its own session and never inherits
      // Node; this only permits the tag to exist at all.
      webviewTag: true,
    },
  });

  win.once("ready-to-show", () => win?.show());
  win.on("closed", () => (win = null));

  // Anything that isn't the portal itself belongs in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  // The splash renders instantly from disk; the portal replaces it in place
  // once it answers, so the window is up from the first second either way.
  return win.loadFile(path.join(HERE, "splash.html"));
}

/**
 * The original shape: this machine runs everything.
 *
 * Spawns the scraper and the portal, waits for both, then loads localhost.
 * Skipped entirely when SLATES_HOST points the app at another machine.
 */
async function startLocally() {
  if (!ATTACH) {
    // Inside a packaged .app everything lives under Resources; from a
    // checkout it sits next to this folder.
    const base = app.isPackaged ? process.resourcesPath : ROOT;
    const scraperDir = path.join(base, "scraper");

    await ensure(
      "scraper",
      SCRAPER,
      process.execPath,
      [path.join(scraperDir, "serve.mjs")],
      scraperDir,
      "Starting the sync service"
    );

    if (app.isPackaged) {
      // The standalone server is self-contained, so the packaged app needs
      // neither npm nor a system Node install.
      const webDir = path.join(base, "web");
      // Real Node where we can find it — see nodeBinary().
      await ensure(
        "portal",
        PORTAL,
        nodeBinary() || process.execPath,
        [path.join(webDir, "server.js")],
        webDir,
        "Starting the portal"
      );
    } else {
      // `npm run start` already pins the port; passing it again duplicates the flag.
      await ensure("portal", PORTAL, "npm", ["run", "start"], path.join(ROOT, "web"), "Starting the portal");
    }
  }

  await waitForPort(PORTAL, "Portal");
  boot("step", "portal", "Portal is up", "done");

  /*
   * Then wait on the scraper, which is the slow one — it launches its own
   * Chrome. The portal is usually up in well under a second, so handing over
   * the moment *it* answers would drop you on an empty board while the part
   * that actually has your data was still starting.
   *
   * Reported from a real check rather than from having spawned it, and never
   * fatal: the portal runs fine without it, so a scraper that didn't come up
   * is said plainly instead of holding the whole app shut.
   */
  const syncing = await waitForPort(SCRAPER, "Sync service", 25_000).catch(() => false);
  boot(
    "step",
    "scraper",
    syncing ? "Sync service running" : "Sync service didn't start — open Settings to retry",
    syncing ? "done" : "failed"
  );

  boot("step", "board", "Opening your board", "active");
  boot("done");
  // A beat on the finished state, so the last step is legible rather than a
  // flash — the whole point of the screen is knowing what happened.
  await new Promise((r) => setTimeout(r, 450));

  // Before the window shows the app, make sure the app's record came with
  // it across the port change. See migrateStorageOrigins().
  await migrateStorageOrigins(PORTAL);

  if (win && !win.isDestroyed()) await win.loadURL(`http://localhost:${PORTAL}`);
}


app.whenReady().then(async () => {
  try {
    createWindow();
    await new Promise((r) => setTimeout(r, 50)); // let the first paint land

    /*
     * Someone else's machine is the back end. Nothing is started here, and
     * nothing local is waited on — the scraper is bound to localhost on *that*
     * host by design, so checking for it from here would always fail and would
     * report a problem that isn't one.
     */
    if (REMOTE) {
      boot("step", "portal", `Connecting to ${hostLabel(REMOTE)}`, "active");
      const up = await waitForRemote(REMOTE);
      if (!up) {
        throw new Error(
          [
            `Couldn't reach ${REMOTE}.`,
            "",
            "That host runs the portal, the Schoology sync and the AI CLIs.",
            "Check it is awake, that Tailscale is up on both machines, and that",
            "`tailscale serve` is still publishing the portal there.",
            "",
            "Unset SLATES_HOST in ~/.slates/.env to go back to running it here.",
          ].join("\n")
        );
      }
      boot("step", "portal", `Connected to ${hostLabel(REMOTE)}`, "done");
      boot("step", "scraper", "Sync runs on your host", "done");
      boot("step", "board", "Opening your board", "active");

      /*
       * The board lives in localStorage, keyed by origin — so the first time
       * this host is used it would otherwise open empty. Carried across once,
       * before the window shows anything.
       */
      const carried = await migrateStorageToRemote(REMOTE).catch(() => 0);
      if (carried) boot("note", `Brought your board across (${carried} items).`);

      boot("done");
      await new Promise((r) => setTimeout(r, 450));

      if (win && !win.isDestroyed()) await win.loadURL(REMOTE);
    } else {
      await startLocally();
    }
  } catch (e) {
    const message = String(e instanceof Error ? e.message : e);
    boot("step", "portal", "Couldn't start", "failed");
    boot("failed", message);
    dialog.showErrorBox("Slates couldn't start", message);
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/**
 * The child processes are not in Electron's process group, so quitting without
 * this leaves a scraper — and its headless Chrome — running invisibly.
 */
function shutdown() {
  for (const child of children.splice(0)) {
    child.kill("SIGTERM");
  }
}

app.on("before-quit", shutdown);
app.on("window-all-closed", () => {
  shutdown();
  app.quit();
});
process.on("exit", shutdown);
