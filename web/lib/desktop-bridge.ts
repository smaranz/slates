import type { Mode } from "./mode";

/**
 * Apps the Mac desktop app answers from the Mac itself while the rest of
 * Slates runs on a host elsewhere: AI Usage reads the coding tools installed
 * on the computer you're using, not on the host (desktop/preload.cjs). A
 * browser or the phone has no bridge, so there these follow the host.
 */
interface DesktopBridge {
  localApps: string[];
  localFetch(path: string, init: { method: string; body?: string }): Promise<{ status: number; body: string }>;
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
