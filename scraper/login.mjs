/**
 * One-time interactive login.
 *
 * Opens a visible browser on the dedicated Slates profile. You sign in to
 * Schoology exactly as normal — including any Google/SSO redirect — and the
 * session is stored in that profile so later scrapes run unattended and
 * headless.
 *
 * Nothing here reads or types your password. It watches for the signed-in home
 * page to appear and then saves, so there's no terminal step to remember.
 */
import { launch, writeConfig, readConfig, PROFILE } from "./browser.mjs";

const arg = process.argv[2];
const domain = (arg || readConfig().domain || "")
  .replace(/^https?:\/\//, "")
  .replace(/\/.*$/, "")
  .trim();

if (!domain) {
  console.error("\n  Usage: npm run login -- <your-district>.schoology.com\n");
  process.exit(1);
}

const DEADLINE_MS = 10 * 60_000;
const SERVICE = `http://127.0.0.1:${process.env.SLATES_SCRAPER_PORT || 4000}`;

/**
 * Ask a running sync service to let go of the browser profile.
 *
 * Chrome permits one process per user-data-dir, and the service holds this
 * one open continuously — so signing in used to fail with a profile-lock
 * error unless you already knew to stop the service first. Which is a trap,
 * because "run npm run login" is the advice the service itself prints when
 * the session expires.
 *
 * Best-effort by design: no service running is the normal first-run case.
 */
async function releaseProfile() {
  try {
    const res = await fetch(`${SERVICE}/browser/release`, {
      method: "POST",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return false;
    console.log("  Asked the running sync service to release the browser.");
    // Chrome takes a moment to actually let the lock go.
    await new Promise((r) => setTimeout(r, 1500));
    return true;
  } catch {
    return false; // not running, or too old to know the endpoint
  }
}

const paused = await releaseProfile();

let ctx;
try {
  ctx = await launch({ headless: false });
} catch (e) {
  // The lock is the one failure worth explaining, because the fix isn't obvious.
  const locked = /ProcessSingleton|SingletonLock|already (in use|running)/i.test(String(e?.message));
  console.error(`\n  ✗ Couldn't open the Slates browser profile.`);
  console.error(
    locked
      ? `    Something else is using it. Stop the sync service and try again:\n      pkill -f "scraper/serve.mjs" ; npm run login\n`
      : `    ${e?.message}\n`
  );
  process.exit(1);
}
const page = ctx.pages()[0] ?? (await ctx.newPage());

console.log(`\n  Opening https://${domain}`);
console.log(`  Profile: ${PROFILE}`);
console.log(`\n  Sign in to Schoology in the window that just opened.`);
console.log(`  Leave this running — it saves automatically once you're in.\n`);

await page.goto(`https://${domain}`, { waitUntil: "domcontentloaded" }).catch(() => {});

/** Signed in = on the Schoology host, no password field, and the app chrome is present. */
async function signedIn() {
  try {
    const host = new URL(page.url()).hostname;
    if (!host.endsWith("schoology.com")) return false; // mid-SSO, e.g. on Google
    if ((await page.locator('input[type="password"]').count()) > 0) return false;
    return await page.evaluate(
      () => !!document.querySelector("#todo, #header, .sgy-header, [class*=user-menu], #main-inner")
    );
  } catch {
    return false; // navigating; try again next tick
  }
}

const started = Date.now();
let ok = false;

while (Date.now() - started < DEADLINE_MS) {
  if (await signedIn()) {
    // Confirm against /home specifically, so a stray public page can't pass.
    await page.goto(`https://${domain}/home`, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(1200);
    if (await signedIn()) {
      ok = true;
      break;
    }
  }
  if (ctx.pages().length === 0) break; // window closed
  await page.waitForTimeout(2000);
}

if (ok) {
  writeConfig({ domain, loggedInAt: new Date().toISOString() });
  console.log(`\n  ✓ Signed in and saved — ${domain}`);
  console.log(`    The sync service picks it up straight away.\n`);
} else {
  console.log(`\n  ✗ Didn't detect a signed-in Schoology page.`);
  console.log(`    Run again and complete the sign-in:  npm run login -- ${domain}\n`);
}

await ctx.close().catch(() => {});

// Hand the profile back, so the service doesn't sit out its whole pause.
if (paused) {
  await fetch(`${SERVICE}/browser/resume`, {
    method: "POST",
    signal: AbortSignal.timeout(8000),
  }).catch(() => {});
}

process.exit(ok ? 0 : 1);
