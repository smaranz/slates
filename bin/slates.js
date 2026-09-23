#!/usr/bin/env node
/**
 * `slates` — start the portal the same way `cd web && npm run dev` does.
 */
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const web = path.join(root, "web");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: slates    Start the Slates portal (http://localhost:7528)");
  process.exit(0);
}

if (!fs.existsSync(path.join(web, "package.json"))) {
  console.error("slates: could not find the web/ portal next to this package.");
  process.exit(1);
}

if (!fs.existsSync(path.join(web, "node_modules", "next"))) {
  console.log("Installing portal dependencies…");
  const install = spawnSync(npm, ["install"], {
    cwd: web,
    stdio: "inherit",
    env: process.env,
  });
  if (install.status !== 0) process.exit(install.status ?? 1);
}

const child = spawn(npm, ["run", "dev"], {
  cwd: web,
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
