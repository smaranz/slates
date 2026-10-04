import { activeUrl, browserCookies, openInBrowser } from "@/lib/agent/browser";
import { SCRAPER_URL } from "@/lib/ports";

/**
 * Sign Schoology back in from wherever the student is.
 *
 * The sync browser on the PC runs headless and unattended, so when its
 * session lapses there is no window to sign in through, and the old fix was
 * a terminal command at the PC. Instead: `open` puts Schoology in the agents'
 * browser, whose screen the student watches and drives from Slates (Agent ›
 * Computer, the same view); they sign in there as they always do; and `check`
 * copies the Schoology and Google cookies it ends up with into the sync
 * browser, which only counts it once Schoology's signed-in home renders.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Only what the sync profile is meant to hold: Schoology, and the Google sign-in its SSO goes through. */
const SIGN_IN_HOSTS = (host: string) => /(^|\.)schoology\.com$/.test(host) || /(^|\.)google\.com$/.test(host);

async function scraper<T>(path: string, init?: RequestInit, timeout = 15_000): Promise<T> {
  const response = await fetch(`${SCRAPER_URL}${path}`, { ...init, cache: "no-store", signal: AbortSignal.timeout(timeout) });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok || body.error) throw new Error(body.error ?? `The sync service answered ${response.status}.`);
  return body;
}

export async function POST(request: Request) {
  let body: { op?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  try {
    // Not through `scraper()`: health reports the last sync's error ("Signed out…"), which is why we're here.
    const health = await fetch(`${SCRAPER_URL}/health`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const { domain } = (await health.json()) as { domain: string | null };
    if (!domain) return Response.json({ error: "Schoology isn't set up on the PC yet." }, { status: 400 });

    if (body.op === "open") {
      await openInBrowser(`https://${domain}/home`);
      return Response.json({ ok: true, domain });
    }

    // Still on a sign-in page (Schoology's or Google's): nothing to copy yet.
    const url = await activeUrl();
    let host = "";
    let pathname = "";
    try {
      ({ hostname: host, pathname } = new URL(url ?? ""));
    } catch {
      // No page yet.
    }
    if (!host.endsWith("schoology.com") || /^\/(login|sso)/.test(pathname)) return Response.json({ signedIn: false });

    const cookies = (await browserCookies(SIGN_IN_HOSTS)).map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires > 0 ? c.expires : -1,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite ?? "Lax",
    }));
    if (!cookies.some((c) => c.domain.replace(/^\./, "").endsWith("schoology.com"))) return Response.json({ signedIn: false });

    const result = await scraper<{ signedIn: boolean }>(
      "/session/import",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cookies }) },
      90_000,
    );
    return Response.json({ signedIn: result.signedIn });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
