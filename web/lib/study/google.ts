import { extractText, type TextLimits } from "../attachment-text";
import { SCRAPER_URL } from "../ports";

/**
 * Google Docs, Slides, Sheets and Drive files a class posts in Schoology.
 *
 * Most are shared only inside the school, so they're read as the student:
 * first with the Agent app's browser session (sign in once in Agent ›
 * Computer), then through the sync service's browser, then as a public link.
 */

/** Thrown when every way in ended at Google's sign-in page. */
export class NeedsGoogleSignIn extends Error {}

/** Where a Google Doc, Slides deck, Sheet or Drive file can be downloaded as text, or null for anything else. */
export function googleExport(url: string): string | null {
  const doc = /^https:\/\/docs\.google\.com\/(document|presentation|spreadsheets)\/d\/([\w-]{20,})/.exec(url);
  if (doc) {
    const [, kind, id] = doc;
    if (kind === "document") return `https://docs.google.com/document/d/${id}/export?format=txt`;
    if (kind === "presentation") return `https://docs.google.com/presentation/d/${id}/export/txt`;
    return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`;
  }
  const drive = /^https:\/\/drive\.google\.com\/(?:file\/d\/|open\?id=)([\w-]{20,})/.exec(url);
  return drive ? `https://drive.google.com/uc?export=download&id=${drive[1]}` : null;
}

/** When the sync browser last said it has no Google sign-in; each check opens a tab, so it isn't repeated for a while. */
let syncSignedOutAt = 0;

export async function readGoogle(url: string, limits: TextLimits): Promise<string> {
  const target = googleExport(url);
  if (!target) throw new Error("Only Google Docs, Slides, Sheets and Drive files can be read directly. Open other sites in the browser.");
  const attempts: (() => Promise<Response | null>)[] = [
    async () => {
      const cookie = await agentBrowserCookies(new URL(target).hostname);
      return cookie ? fetch(target, { headers: { cookie }, redirect: "follow", signal: AbortSignal.timeout(30_000) }) : null;
    },
    async () => {
      if (Date.now() - syncSignedOutAt < 10 * 60_000) return null;
      const response = await fetch(`${SCRAPER_URL}/google/file?url=${encodeURIComponent(target)}`, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok && /isn't signed in/.test(await response.clone().text())) syncSignedOutAt = Date.now();
      return response;
    },
    () => fetch(target, { redirect: "follow", signal: AbortSignal.timeout(30_000) }),
  ];
  for (const attempt of attempts) {
    const response = await attempt().catch(() => null);
    const type = response?.headers.get("content-type") ?? "";
    if (!response?.ok || type.includes("text/html") || type.includes("application/json")) continue;
    if (type.startsWith("text/")) return (await response.text()).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, limits.chars);
    const ext = type.includes("pdf") ? "pdf" : type.includes("wordprocessingml") ? "docx" : type.includes("presentationml") ? "pptx" : "";
    const text = ext ? await extractText(await response.arrayBuffer(), ext, limits) : "";
    if (text) return text;
    throw new Error("Slates can't read text from that kind of Google Drive file.");
  }
  throw new NeedsGoogleSignIn("A Google file shared only inside your school. Sign in to your school Google account once in Agent › Computer, then rebuild.");
}

/**
 * The Agent app's Chrome keeps its sign-ins; its Google cookies let a plain
 * request read what the student can. Read over the DevTools port that only
 * listens on this machine, used only for Google's own hosts, and never logged.
 */
async function agentBrowserCookies(host: string): Promise<string | null> {
  // Same port as lib/agent/browser.ts, which can't be imported outside Next.
  const cdp = `http://127.0.0.1:${Number(process.env.SLATES_AGENT_CDP_PORT) || 7532}`;
  const version = (await fetch(`${cdp}/json/version`, { signal: AbortSignal.timeout(1_500) }).then((r) => r.json(), () => null)) as { webSocketDebuggerUrl?: string } | null;
  if (!version?.webSocketDebuggerUrl) return null;
  const cookies = await new Promise<{ name: string; value: string; domain: string }[]>((resolve) => {
    const socket = new WebSocket(version.webSocketDebuggerUrl!);
    const done = (value: { name: string; value: string; domain: string }[]) => {
      clearTimeout(timer);
      socket.close();
      resolve(value);
    };
    const timer = setTimeout(() => done([]), 5_000);
    socket.addEventListener("open", () => socket.send(JSON.stringify({ id: 1, method: "Storage.getCookies" })));
    socket.addEventListener("message", (event) => {
      const data = JSON.parse(String(event.data)) as { id?: number; result?: { cookies?: { name: string; value: string; domain: string }[] } };
      if (data.id === 1) done(data.result?.cookies ?? []);
    });
    socket.addEventListener("error", () => done([]));
  });
  const matching = cookies.filter((cookie) => cookie.domain === ".google.com" || cookie.domain === host || cookie.domain === `.${host}`);
  // Without a session cookie Google treats the request as signed out, so don't bother.
  if (!matching.some((cookie) => /^(SID|__Secure-1PSID|__Secure-3PSID)$/.test(cookie.name))) return null;
  return matching.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}
