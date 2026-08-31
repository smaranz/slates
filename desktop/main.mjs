import { app, BrowserWindow, shell, dialog } from "electron";
import { spawn } from "node:child_process";
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

const PORTAL = Number(process.env.SLATES_PORT || 3000);
const SCRAPER = Number(process.env.SLATES_SCRAPER_PORT || 4000);

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

/** Resolve once a port answers, so the window never opens on a dead server. */
async function waitForPort(port, label, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await answers(port)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`${label} did not start on port ${port}`);
}

/**
 * Start a service only if nothing is already serving that port. Running the
 * app while a terminal already has the dev servers up would otherwise spawn
 * duplicates that die on EADDRINUSE and take the launch down with them.
 */
async function ensure(name, port, command, args, cwd) {
  if (await answers(port)) {
    console.log(`[${name}] already running on ${port} — attaching`);
    return;
  }
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
      // Nothing here needs Node, and the window renders a local page that
      // proxies to the scraper. Keep the renderer sandboxed.
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

  void win.loadURL(`http://localhost:${PORTAL}`);
}

app.whenReady().then(async () => {
  try {
    if (!ATTACH) {
      // Inside a packaged .app everything lives under Resources; from a
      // checkout it sits next to this folder.
      const base = app.isPackaged ? process.resourcesPath : ROOT;
      const scraperDir = path.join(base, "scraper");

      await ensure("scraper", SCRAPER, process.execPath, [path.join(scraperDir, "serve.mjs")], scraperDir);

      if (app.isPackaged) {
        // The standalone server is self-contained, so the packaged app needs
        // neither npm nor a system Node install.
        const webDir = path.join(base, "web");
        await ensure("portal", PORTAL, process.execPath, [path.join(webDir, "server.js")], webDir);
      } else {
        // `npm run start` already pins the port; passing it again duplicates the flag.
        await ensure("portal", PORTAL, "npm", ["run", "start"], path.join(ROOT, "web"));
      }
    }
    await waitForPort(PORTAL, "Portal");
    createWindow();
  } catch (e) {
    dialog.showErrorBox("Slates couldn't start", String(e instanceof Error ? e.message : e));
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
