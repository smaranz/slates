const fs = require("node:fs");
const path = require("node:path");

/**
 * Packaging config for the desktop app.
 *
 * This is JavaScript rather than a `build` block in package.json for one
 * reason: the portal depends on a couple of packages that ship a *different*
 * native binary per platform, and Next's standalone tracer doesn't follow
 * them. Hard-coding `-darwin-arm64` worked while macOS was the only target and
 * breaks the moment a Windows runner tries to copy a directory that its own
 * npm install was never going to create. So the list is computed from what is
 * actually on disk at build time.
 */

const WEB = path.join(__dirname, "..", "web");

/** Platform-tagged packages to bundle when this machine's install produced them. */
const NATIVE = ["@anthropic-ai/claude-agent-sdk", "@cursor/sdk"];

function nativeResources() {
  const suffix = `${process.platform}-${process.arch}`;
  const out = [];

  for (const pkg of NATIVE) {
    const dir = path.join(WEB, "node_modules", `${pkg}-${suffix}`);
    if (fs.existsSync(dir)) {
      out.push({
        from: path.relative(__dirname, dir),
        to: `web/node_modules/${pkg}-${suffix}`,
      });
    }
  }

  // Not fatal, and worth saying out loud: the app still runs, and the models
  // behind the missing binary report themselves as unconfigured.
  if (out.length < NATIVE.length) {
    console.log(
      `[slates] ${out.length}/${NATIVE.length} optional native SDKs found for ${suffix}.`
    );
  }
  return out;
}

/**
 * `public/` — but only when the standalone bundle didn't already bring it.
 *
 * Next copies public/ into .next/standalone itself, so naming it a second time
 * makes electron-builder hard-link every file twice and die on the first
 * collision (`EEXIST ... public/globe.svg`). Kept as a fallback rather than
 * deleted outright because whether standalone includes public/ is a Next
 * implementation detail, and an app missing its icons is a worse failure than
 * a redundant check.
 */
function publicDir() {
  const bundled = path.join(WEB, ".next", "standalone", "public");
  if (fs.existsSync(bundled)) return [];
  return [{ from: "../web/public", to: "web/public" }];
}

module.exports = {
  appId: "com.slates.app",
  productName: "Slates",
  directories: { output: "dist", buildResources: "build" },
  files: ["main.mjs", "splash.html", "package.json"],
  extraResources: [
    { from: "../web/.next/standalone", to: "web" },
    // Not in the standalone bundle — Next leaves the static chunks out of it
    // deliberately, on the assumption a CDN serves them.
    { from: "../web/.next/static", to: "web/.next/static" },
    // The Schoology scraper and the AI-writing detector run beside the portal.
    { from: "../scraper", to: "scraper", filter: ["**/*", "!**/.DS_Store", "!supabase/.temp/**"] },
    { from: "../detector", to: "detector", filter: ["**/*", "!**/__pycache__/**", "!**/.DS_Store"] },
    ...publicDir(),
    ...nativeResources(),
  ],
  mac: {
    icon: "build/icon.icns",
    category: "public.app-category.education",
    target: [{ target: "dmg", arch: ["arm64"] }],
  },
  win: {
    icon: "build/icon.ico",
    target: [{ target: "nsis", arch: ["x64"] }],
  },
  nsis: {
    // A per-user install needs no administrator, and this is a personal app.
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
  },
};
