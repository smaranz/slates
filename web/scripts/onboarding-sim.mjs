#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 3002);
const LOCK = path.join(WEB_DIR, ".next", "dev-onboarding-sim", "dev", "lock");

function pids(args) {
  try {
    return execFileSync("lsof", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n")
      .map((line) => Number(line.trim()))
      .filter((pid) => pid && pid !== process.pid);
  } catch {
    return [];
  }
}

const leftovers = pids(["-t", LOCK]);
for (const pid of leftovers) {
  try {
    process.kill(pid, "SIGTERM");
  } catch {}
}
if (leftovers.length) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && pids(["-t", LOCK]).length) execFileSync("sleep", ["0.1"]);
  console.log(`Stopped the simulator that was already running (${leftovers.join(", ")}).`);
}

const holders = pids(["-tnP", `-iTCP:${PORT}`, "-sTCP:LISTEN"]);
if (holders.length) {
  console.error(`Port ${PORT} is held by pid ${holders.join(", ")}. Stop it, or run with PORT=<another port>.`);
  process.exit(1);
}

console.log(`Onboarding simulator  →  http://localhost:${PORT}`);

const child = spawn("npx", ["next", "dev", "-p", String(PORT), "-H", "127.0.0.1"], {
  cwd: WEB_DIR,
  stdio: "inherit",
  env: { ...process.env, SLATES_ONBOARDING_SIM: "1", SLATES_USAGE_ONLY: "1" },
});

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
