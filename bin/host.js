/**
 * `slates host` — run Slates' back end for your other devices.
 *
 * The portal, the Schoology scraper and its Chrome, and the CLIs a tutor reply
 * spawns are the heavy part of Slates. This runs them on one always-on machine
 * so a laptop and a phone can use it as thin windows (docs/remote-host-setup.md).
 * Both services listen on 127.0.0.1 only; `tailscale serve` is the way in.
 *
 * The portal runs as `next start` from web/, not the standalone server.js:
 * standalone ships without .next/static and changes its working directory,
 * which the tutor's skills and the detector resolve their paths against.
 */
const { spawn, spawnSync, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const WIN = process.platform === "win32";
const ROOT = path.resolve(__dirname, "..");
const WEB = path.join(ROOT, "web");
const SCRAPER = path.join(ROOT, "scraper");
const HOME = path.join(os.homedir(), ".slates");
const LOG_FILE = path.join(HOME, "logs", "host.log");
const LOCK_FILE = path.join(HOME, "host.lock.json");
const NEXT_BIN = path.join(WEB, "node_modules", "next", "dist", "bin", "next");
const BUILD_STAMP = path.join(WEB, ".next", "slates-host-build.json");

/** `~/.slates/.env`, read the way desktop/main.mjs reads it. Nothing else loads it. */
function readUserEnv() {
  try {
    const out = {};
    for (const line of fs.readFileSync(path.join(HOME, ".env"), "utf8").split(/\r?\n/)) {
      const m = /^\s*([\w.-]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m || line.trim().startsWith("#")) continue;
      out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

const env = { ...process.env, ...readUserEnv() };
const PORTAL = Number(env.SLATES_PORT) || 7528;
const SCRAPER_PORT = Number(env.SLATES_SCRAPER_PORT) || 7529;
env.SLATES_PORT = String(PORTAL);
env.SLATES_SCRAPER_PORT = String(SCRAPER_PORT);

/* ---------- logging: console and ~/.slates/logs/host.log ---------- */

fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
try {
  if (fs.statSync(LOG_FILE).size > 10 * 1024 * 1024) fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
} catch {
  // No log yet.
}
const logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });
process.stdout.on("error", () => {});

function log(name, text) {
  const stamp = new Date().toLocaleString("sv-SE");
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const out = `${stamp} [${name}] ${line}\n`;
    logStream.write(out);
    process.stdout.write(out);
  }
}

/* ---------- processes ---------- */

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

function commandLine(pid) {
  try {
    if (WIN) {
      return execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`],
        { encoding: "utf8", windowsHide: true, timeout: 15_000, stdio: ["ignore", "pipe", "ignore"] }
      ).trim();
    }
    return execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

/** Windows doesn't take children down with a parent, so kill the whole tree there. */
function killTree(pid, signal = "SIGTERM") {
  try {
    if (WIN) spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else process.kill(pid, signal);
  } catch {
    // Already gone.
  }
}

function readLock() {
  try {
    return JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writeLock(children) {
  fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, root: ROOT, children }));
}

/**
 * One host per machine. A lock naming a live `slates host` means it is already
 * running; children left behind by one that was killed outright still hold
 * the ports, and are only ours to stop if their command line points into
 * this checkout.
 */
function takeLock() {
  const held = readLock();
  if (held?.pid && held.pid !== process.pid && alive(held.pid) && commandLine(held.pid).includes("slates.js")) {
    console.log(`slates host is already running (pid ${held.pid}). Log: ${LOG_FILE}`);
    process.exit(0);
  }
  for (const pid of held?.children ?? []) {
    if (alive(pid) && commandLine(pid).includes(ROOT)) {
      log("host", `stopping pid ${pid}, left over from an earlier run`);
      killTree(pid);
    }
  }
  writeLock([]);
}

function stopRunning() {
  const held = readLock();
  if (!held?.pid || !alive(held.pid)) {
    console.log("slates host isn't running.");
    return;
  }
  for (const pid of [held.pid, ...(held.children ?? [])]) killTree(pid);
  console.log(`Stopped slates host (pid ${held.pid}).`);
}

function portBusy(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

function run(name, command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true });
    child.stdout.on("data", (b) => log(name, b));
    child.stderr.on("data", (b) => log(name, b));
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${name} failed (exit ${code})`))));
  });
}

/* ---------- install and build, only when something changed ---------- */

/** npm's own entry script, run with this Node — no .cmd shims or shells on Windows. */
function npmCli() {
  const dir = path.dirname(process.execPath);
  const found = [
    process.env.npm_execpath,
    path.join(dir, "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(dir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ].find((p) => p && p.endsWith("npm-cli.js") && fs.existsSync(p));
  if (!found) throw new Error("Couldn't find npm next to this Node install.");
  return found;
}

/** A lockfile newer than the installed tree means a pull changed dependencies. */
function depsStale(dir) {
  try {
    const lock = fs.statSync(path.join(dir, "package-lock.json")).mtimeMs;
    return lock > fs.statSync(path.join(dir, "node_modules", ".package-lock.json")).mtimeMs;
  } catch {
    return true;
  }
}

function headCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function buildStale() {
  if (!fs.existsSync(path.join(WEB, ".next", "BUILD_ID"))) return true;
  const commit = headCommit();
  if (!commit) return false;
  try {
    return JSON.parse(fs.readFileSync(BUILD_STAMP, "utf8")).commit !== commit;
  } catch {
    return true;
  }
}

async function prepare(forceBuild) {
  let reinstalled = false;
  for (const dir of [WEB, SCRAPER]) {
    if (!depsStale(dir)) continue;
    log("host", `installing dependencies in ${path.basename(dir)}/`);
    await run("npm", process.execPath, [npmCli(), "ci", "--no-audit", "--no-fund"], dir);
    reinstalled ||= dir === WEB;
  }
  if (forceBuild || reinstalled || buildStale()) {
    log("host", "building the portal (a few minutes)");
    await run("build", process.execPath, [NEXT_BIN, "build"], WEB);
    fs.writeFileSync(BUILD_STAMP, JSON.stringify({ commit: headCommit(), at: new Date().toISOString() }));
  }
}

/* ---------- the two services ---------- */

const services = [
  { name: "scraper", port: SCRAPER_PORT, cwd: SCRAPER, args: [path.join(SCRAPER, "serve.mjs")], child: null },
  {
    name: "portal",
    port: PORTAL,
    cwd: WEB,
    args: [NEXT_BIN, "start", "-H", "127.0.0.1", "-p", String(PORTAL)],
    child: null,
  },
];
let stopping = false;

function saveChildren() {
  writeLock(services.map((s) => s.child?.pid).filter(Boolean));
}

/** Keep a service up: restart it when it exits, backing off if it keeps failing. */
function supervise(service) {
  let failures = 0;
  const start = () => {
    if (stopping) return;
    const startedAt = Date.now();
    const child = spawn(process.execPath, service.args, { cwd: service.cwd, env, windowsHide: true });
    service.child = child;
    saveChildren();
    child.stdout.on("data", (b) => log(service.name, b));
    child.stderr.on("data", (b) => log(service.name, b));
    child.once("error", (e) => log(service.name, `couldn't start: ${e.message}`));
    child.once("exit", (code, signal) => {
      service.child = null;
      if (stopping) return;
      failures = Date.now() - startedAt > 60_000 ? 1 : failures + 1;
      const delay = Math.min(30_000, 1000 * 2 ** (failures - 1));
      log("host", `${service.name} exited (${signal ?? code}); restarting in ${delay / 1000}s`);
      setTimeout(start, delay);
    });
  };
  start();
}

function shutdown() {
  if (stopping) return;
  stopping = true;
  log("host", "stopping");
  for (const s of services) if (s.child) killTree(s.child.pid);
  const deadline = Date.now() + 5000;
  const wait = setInterval(() => {
    const left = services.filter((s) => s.child);
    if (left.length && Date.now() < deadline) return;
    for (const s of left) killTree(s.child.pid, "SIGKILL");
    clearInterval(wait);
    try {
      fs.unlinkSync(LOCK_FILE);
    } catch {
      // Nothing to remove.
    }
    process.exit(0);
  }, 200);
}

async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portBusy(port)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function tailscale(args) {
  const candidates = WIN
    ? [path.join(process.env.ProgramFiles || "C:\\Program Files", "Tailscale", "tailscale.exe")]
    : ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"];
  for (const bin of candidates) {
    try {
      return execFileSync(bin, args, { encoding: "utf8", timeout: 5000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      // Try the next location.
    }
  }
  return null;
}

/** Where the other devices should point, if Tailscale is publishing the portal. */
function announce() {
  log("host", `portal ready on http://127.0.0.1:${PORTAL}`);
  let name = null;
  try {
    name = JSON.parse(tailscale(["status", "--json"]) ?? "null")?.Self?.DNSName?.replace(/\.$/, "") ?? null;
  } catch {
    // Not JSON — treat as no Tailscale.
  }
  if (!name) {
    log("host", "Tailscale isn't running here, so only this machine can reach the portal.");
    return;
  }
  if ((tailscale(["serve", "status"]) ?? "").includes(`:${PORTAL}`)) {
    log("host", `your devices reach it at https://${name}  (SLATES_HOST on the Mac, SLATES_MOBILE_SERVER_URL for the phone)`);
  } else {
    log("host", `publish it to your tailnet with:  tailscale serve --bg ${PORTAL}`);
  }
}

module.exports = async function host(flags = []) {
  if (flags.includes("--help") || flags.includes("-h")) {
    console.log(
      [
        "Usage: slates host [--rebuild] [--no-setup] [--stop]",
        "",
        "Runs the portal and the Schoology scraper on this machine for your other devices,",
        "restarting either if it exits. Reads keys from ~/.slates/.env; logs to ~/.slates/logs/host.log.",
        "",
        "  --rebuild    rebuild the portal even if nothing changed",
        "  --no-setup   skip the dependency and build checks",
        "  --stop       stop a running `slates host`",
      ].join("\n")
    );
    return;
  }
  if (flags.includes("--stop")) {
    stopRunning();
    return;
  }

  takeLock();
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) process.on(signal, shutdown);
  log("host", `starting from ${ROOT} (keys from ${Object.keys(readUserEnv()).length ? "~/.slates/.env" : "the environment only"})`);

  try {
    if (!flags.includes("--no-setup")) await prepare(flags.includes("--rebuild"));
    for (const s of services) {
      if (await portBusy(s.port)) {
        throw new Error(`port ${s.port} (${s.name}) is already taken by another program. Quit it, or set SLATES_PORT / SLATES_SCRAPER_PORT.`);
      }
    }
  } catch (e) {
    log("host", e instanceof Error ? e.message : String(e));
    try {
      fs.unlinkSync(LOCK_FILE);
    } catch {
      // Nothing to remove.
    }
    process.exit(1);
  }

  services.forEach(supervise);
  if (await waitForPort(PORTAL, 120_000)) announce();
  else log("host", `the portal hasn't answered on ${PORTAL} yet — see the [portal] lines above`);
};
