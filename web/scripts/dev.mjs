#!/usr/bin/env node
/**
 * `npm run dev`, made to actually start.
 *
 * Two things reliably stopped it before, and neither said so plainly:
 *
 * 1. Next 16 records the dev server running for a directory and refuses a
 *    second one. Any server left behind — a crashed run, a terminal closed
 *    without Ctrl-C, an agent that forgot to clean up — bricks every later
 *    `npm run dev` until someone finds the pid by hand. The error names a pid
 *    to kill, which is no help when the process is already gone and only the
 *    record remains.
 *
 * 2. Port 7528 belongs to the installed Slates.app whenever it is open, and
 *    the app is the normal way to use Slates. Asking someone to quit the app
 *    to look at a change in the app is a silly trade, so dev moves aside
 *    instead and says where it went.
 *
 * So: clear our own leftovers, take 7528 if it's free, step to the next port
 * if it isn't, and print which.
 */

import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIRST_PORT = Number(process.env.PORT || 7528);
const LAST_PORT = FIRST_PORT + 20;

/** pids listening on a TCP port. Empty when nothing holds it. */
function listenersOn(port) {
  try {
    const out = execFileSync("lsof", ["-tnP", `-iTCP:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\n").map((s) => s.trim()).filter(Boolean).map(Number);
  } catch {
    // lsof exits non-zero when nothing matches, which is the common case.
    return [];
  }
}

function commandOf(pid) {
  try {
    return execFileSync("ps", ["-o", "command=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/*
 * Where the dev lock lives. `.next/dev` is the dist directory in dev mode, so
 * that is the one that matters here; `.next/lock` is `next build`'s and is
 * checked only so a half-finished build can't wedge this too.
 */
const LOCKS = [path.join(WEB_DIR, ".next", "dev", "lock"), path.join(WEB_DIR, ".next", "lock")];

/**
 * Stop whatever still holds this directory's dev lock.
 *
 * The lock is asked for by hand rather than matched on a command line,
 * because the command line is the wrong thing to match: `next dev` starts a
 * server in a child process, and killing the parent hard leaves that child
 * running and still holding the lock. `lsof` on the lock file finds whoever
 * actually has it, parent or orphan, whatever it happens to be called.
 *
 * They get SIGTERM first so Next can release the lock and shut its workers
 * down cleanly; SIGKILL is only for what ignores that.
 */
function clearDevLockHolders() {
  const holders = () => {
    const pids = new Set();
    for (const lock of LOCKS) {
      try {
        const out = execFileSync("lsof", ["-t", lock], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        for (const line of out.split("\n")) {
          const pid = Number(line.trim());
          if (pid && pid !== process.pid) pids.add(pid);
        }
      } catch {
        // No such file, or nobody holds it. Both are the good case.
      }
    }
    return [...pids];
  };

  const found = holders();
  if (found.length === 0) return [];

  for (const pid of found) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }

  // Give them a moment to let go before insisting.
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && holders().length > 0) {
    execFileSync("sleep", ["0.1"]);
  }
  for (const pid of holders()) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
  return found;
}

function describeHolder(pids) {
  for (const pid of pids) {
    const cmd = commandOf(pid);
    if (cmd.includes("Slates.app")) return "the installed Slates app";
    if (cmd.includes("next-server") || cmd.includes("next start")) return "a Next server";
    if (cmd) return path.basename(cmd.split(" ")[0]);
  }
  return "something else";
}

const killed = clearDevLockHolders();
if (killed.length > 0) {
  console.log(`Cleared ${killed.length} leftover dev server${killed.length > 1 ? "s" : ""} (${killed.join(", ")}).`);
}

let port = FIRST_PORT;
let holder = "";
while (port <= LAST_PORT) {
  const pids = listenersOn(port);
  if (pids.length === 0) break;
  if (port === FIRST_PORT) holder = describeHolder(pids);
  port += 1;
}

if (port > LAST_PORT) {
  console.error(`Every port from ${FIRST_PORT} to ${LAST_PORT} is taken. Close something and try again.`);
  process.exit(1);
}

if (port !== FIRST_PORT) {
  console.log(`Port ${FIRST_PORT} is held by ${holder}, so dev is on ${port} instead.`);
  console.log(`  →  http://localhost:${port}`);
}

const child = spawn("npx", ["next", "dev", "-p", String(port), ...process.argv.slice(2)], {
  cwd: WEB_DIR,
  stdio: "inherit",
});

// Hand signals through so Ctrl-C stops the server rather than orphaning it —
// an orphan here is exactly what makes the next run fail.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});
