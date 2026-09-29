import type { Mode } from "./mode";

/**
 * Apps the Mac desktop app answers from the Mac itself while the rest of
 * Slates runs on a host elsewhere: AI Usage reads the coding tools installed
 * on the computer you're using, not on the host (desktop/preload.cjs). A
 * browser or the phone has no bridge, so there these follow the host.
 *
 * The bridge also carries files the other way: something an agent made on
 * the host is saved into this Mac's Downloads › Slates and opened in its own
 * app, since the Mac can't reach the host's disk.
 */
interface SaveOptions {
  /** After saving: open it in its app, or show it in Finder. */
  then?: "open" | "reveal";
  /** A notification to post once it's saved; clicking it opens the file. */
  notify?: { title: string; body: string };
}

interface DesktopBridge {
  localApps: string[];
  localFetch(path: string, init: { method: string; body?: string }): Promise<{ status: number; body: string }>;
  /** Builds from before files could be sent don't have this. */
  saveFile?(url: string, name: string, options?: SaveOptions): Promise<{ path: string; name: string }>;
}

declare global {
  interface Window {
    slatesDesktop?: DesktopBridge;
  }
}

function bridge(): DesktopBridge | null {
  return typeof window === "undefined" ? null : (window.slatesDesktop ?? null);
}

export function servedLocally(mode: Mode): boolean {
  return bridge()?.localApps.includes(mode) ?? false;
}

/** `fetch` for AI Usage's `/api/usage/coding`. */
export async function usageFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const desktop = bridge();
  if (!desktop?.localApps.includes("usage")) return fetch(path, init);
  const res = await desktop.localFetch(path, {
    method: init.method ?? "GET",
    body: typeof init.body === "string" ? init.body : undefined,
  });
  return new Response(res.body, { status: res.status, headers: { "content-type": "application/json" } });
}

/* ---------- files from the host ---------- */

/** Whether this window can put files on the computer it's running on (the Mac app). */
export function canSaveToComputer(): boolean {
  return typeof bridge()?.saveFile === "function";
}

export function saveToComputer(url: string, name: string, options?: SaveOptions): Promise<{ path: string; name: string }> | null {
  const desktop = bridge();
  return desktop?.saveFile ? desktop.saveFile(url, name, options) : null;
}

function withDownload(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}download=1`;
}

/**
 * The phone app's web view can't open a second window onto a signed-in
 * page, so there a file goes to the share sheet, whose preview opens it and
 * whose Save to Files keeps it.
 */
function onPhoneApp(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent.includes("SlatesApp") && typeof navigator.canShare === "function";
}

async function shareOnPhone(url: string, name: string): Promise<boolean> {
  if (!onPhoneApp()) return false;
  const response = await fetch(withDownload(url));
  if (!response.ok) throw new Error(`Couldn't fetch ${name} (${response.status}).`);
  const blob = await response.blob();
  const file = new File([blob], name, { type: blob.type || "application/octet-stream" });
  if (!navigator.canShare({ files: [file] })) return false;
  await navigator.share({ files: [file], title: name });
  return true;
}

/** Open a file from the host where the student is: its own app on the Mac, a tab in a browser, the share sheet on the phone. */
export async function openHostFile(url: string, name: string): Promise<void> {
  const saved = saveToComputer(url, name, { then: "open" });
  if (saved) {
    await saved;
    return;
  }
  // Opened before anything is awaited, so a browser still counts it as the click's.
  if (!onPhoneApp()) {
    window.open(url, "_blank", "noopener");
    return;
  }
  if (!(await shareOnPhone(url, name).catch(() => false))) window.open(url, "_blank", "noopener");
}

/** Keep a copy: Downloads › Slates (shown in Finder) on the Mac, a download anywhere else. */
export async function saveHostFile(url: string, name: string): Promise<void> {
  const saved = saveToComputer(withDownload(url), name, { then: "reveal" });
  if (saved) {
    await saved;
    return;
  }
  if (await shareOnPhone(url, name).catch(() => false)) return;
  const link = document.createElement("a");
  link.href = withDownload(url);
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
}
