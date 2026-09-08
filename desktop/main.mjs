import { app, BrowserWindow, shell, dialog } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Slates as a desktop app.
 *
 * The portal is a Next.js server, not a static page, so opening Slates means
 * starting one. Asking someone to run a terminal command before opening a
 * browser tab is not an app: this owns the process — one icon starts it and
 * quitting stops it.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");

const PORTAL = Number(process.env.SLATES_PORT || 3000);

/**
 * OPENAI_API_KEY and friends, for a process that never has them otherwise.
 *
 * The portal's `.env.local` only matters to `next dev` — the packaged
 * standalone `server.js` doesn't read `.env` files at all (Next builds that
 * output assuming a container that injects real env vars), and this app
 * itself is launched from Finder/Dock/`open`, which hands every process a
 * bare environment with none of a login shell's exports. A `.env` file
 * copied next to the packaged server does nothing, and `npm run dist`
 * overwrites it on every rebuild besides. `~/.slates` is the one place that
 * survives both, and is where Slates keeps its own settings anyway.
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

const children = [];
let win = null;

function run(name, command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...readUserEnv(),
      // What Next's standalone server.js reads to pick its socket.
      PORT: String(PORTAL),
      HOSTNAME: "127.0.0.1",
      // Electron's binary is also a Node runtime, but only with this set —
      // without it, handing it a .mjs makes it try to launch a second app.
      // Using it means the packaged app needs no system Node install.
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

function createWindow() {
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
      // Nothing here needs Node — the window just renders the local portal.
      // Keep the renderer sandboxed.
      nodeIntegration: false,
      contextIsolation: true,
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

app.whenReady().then(async () => {
  try {
    createWindow();
    await new Promise((r) => setTimeout(r, 50)); // let the first paint land

    if (!ATTACH) {
      // Inside a packaged .app everything lives under Resources; from a
      // checkout it sits next to this folder.
      const base = app.isPackaged ? process.resourcesPath : ROOT;

      if (app.isPackaged) {
        // The standalone server is self-contained, so the packaged app needs
        // neither npm nor a system Node install.
        const webDir = path.join(base, "web");
        await ensure(
          "portal",
          PORTAL,
          process.execPath,
          [path.join(webDir, "server.js")],
          webDir,
          "Starting the portal"
        );
      } else {
        // `npm run start` already pins the port; passing it again duplicates the flag.
        await ensure(
          "portal",
          PORTAL,
          "npm",
          ["run", "start"],
          path.join(ROOT, "web"),
          "Starting the portal"
        );
      }
    }

    await waitForPort(PORTAL, "Portal");
    boot("step", "portal", "Portal is up", "done");

    boot("step", "board", "Opening your board", "active");
    boot("done");
    // A beat on the finished state, so the last step is legible rather than a
    // flash — the whole point of the screen is knowing what happened.
    await new Promise((r) => setTimeout(r, 450));

    if (win && !win.isDestroyed()) await win.loadURL(`http://localhost:${PORTAL}`);
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
 * The portal is not in Electron's process group, so quitting without this
 * leaves a Next.js server running invisibly on the port.
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
