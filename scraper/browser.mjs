import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * A dedicated browser profile that only ever holds Schoology.
 *
 * Kept separate from the user's day-to-day Chrome on purpose: the login here is
 * long-lived and unattended, and mixing it into the main profile would mean
 * this code could see every other logged-in site. It drives the installed
 * Chrome binary rather than downloading one.
 */
export const HOME = path.join(os.homedir(), ".slates");
export const PROFILE = path.join(HOME, "chrome-profile");
export const CONFIG = path.join(HOME, "config.json");

export function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  } catch {
    return {};
  }
}

export function writeConfig(patch) {
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify({ ...readConfig(), ...patch }, null, 2));
}

/**
 * Clear a lock left behind by a browser that died without tidying up.
 *
 * Chrome claims a profile with a `SingletonLock` symlink pointing at
 * `<host>-<pid>`. A clean exit removes it; a SIGKILL, a crash or a power cut
 * does not, and every later launch then fails against a process that no longer
 * exists. The profile is ours alone and only one browser ever uses it, so a
 * lock naming a dead pid is always stale and never a second live session.
 */
function clearStaleProfileLock() {
  let target;
  try {
    target = fs.readlinkSync(path.join(PROFILE, "SingletonLock"));
  } catch {
    return; // No lock, or not a symlink. Nothing to do.
  }

  const pid = Number(/-(\d+)$/.exec(target)?.[1]);
  if (Number.isFinite(pid) && pid > 0) {
    try {
      process.kill(pid, 0); // Signal 0 only tests for existence.
      return; // Still running — leave it alone.
    } catch (err) {
      // ESRCH means no such process; EPERM means it exists but isn't ours,
      // which is still a live process and not ours to clear.
      if (err?.code === "EPERM") return;
    }
  }

  for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    try {
      fs.unlinkSync(path.join(PROFILE, name));
    } catch {
      // Already gone.
    }
  }
  console.log(`[browser] cleared a stale profile lock from pid ${pid || "?"}`);
}

export async function launch({ headless = true } = {}) {
  fs.mkdirSync(PROFILE, { recursive: true });
  clearStaleProfileLock();
  return chromium.launchPersistentContext(PROFILE, {
    channel: "chrome", // use the installed Chrome; no browser download
    headless,
    viewport: { width: 1440, height: 900 },
    // Headless Chrome advertises "HeadlessChrome/…", which some login flows
    // treat differently. Present the same UA as the headed session that the
    // profile was authenticated in.
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    args: ["--disable-blink-features=AutomationControlled"],
  });
}

/** Schoology bounces to a login form when the session is gone. */
export async function isLoggedIn(page) {
  const url = page.url();
  if (/\/login|\/sso|accounts\.google\.com/.test(url)) return false;
  return (await page.locator('input[type="password"]').count()) === 0;
}

/** True once we're on Schoology with the app chrome rendered. */
async function onSchoologyHome(page) {
  try {
    if (!new URL(page.url()).hostname.endsWith("schoology.com")) return false;
    if ((await page.locator('input[type="password"]').count()) > 0) return false;
    return await page.evaluate(
      () => !!document.querySelector("#todo, #header, .sgy-header, [class*=user-menu], #main-inner")
    );
  } catch {
    return false; // mid-navigation
  }
}

/**
 * Re-complete Google SSO without a human.
 *
 * Schoology's own session cookie is session-scoped, so it dies whenever the
 * browser closes — but the Google login in this profile persists. That leaves
 * us on Google's account chooser, one click from being signed back in. Clicking
 * it here is what makes unattended scraping possible; otherwise you'd have to
 * re-run `npm run login` before every sync.
 */
async function continueSso(page) {
  const host = new URL(page.url()).hostname;
  if (!host.endsWith("google.com")) return false;

  const candidates = [
    "[data-identifier]", // account chooser rows
    'li[class*="aZvCDf"]',
    'div[role="link"]',
    'button:has-text("Continue")',
    'button:has-text("Allow")',
  ];

  for (const sel of candidates) {
    const el = page.locator(sel).first();
    if ((await el.count()) === 0) continue;
    await el.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(1_200);
    return true;
  }
  return false;
}

export async function openHome(ctx, domain) {
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(`https://${domain}/home`, { waitUntil: "domcontentloaded", timeout: 45_000 });

  // Follow up to a few SSO hops (chooser → consent → redirect back).
  for (let i = 0; i < 5; i++) {
    if (await onSchoologyHome(page)) return page;
    if (!(await continueSso(page))) break;
  }

  if (!(await onSchoologyHome(page))) {
    await page.goto(`https://${domain}/home`, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(1_500);
  }
  return page;
}
