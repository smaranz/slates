/**
 * Where a request came from, told by the headers Tailscale's proxy sets.
 *
 * Checked against the live host: Serve and Funnel overwrite X-Forwarded-Proto
 * and X-Forwarded-For, add Tailscale-User-Login only for a signed-in tailnet
 * user (stripping any a client sends), and mark internet traffic with
 * Tailscale-Funnel-Request. The portal listens on 127.0.0.1 only, so a request
 * without Tailscale's marks can only come from the host itself — which is why
 * nothing but Tailscale may publish the portal: another tunnel would look like
 * the host. The Host header proves nothing: Funnel passes a forged one through.
 */

export type Origin =
  /** On the host itself: its own window, a local dev server. */
  | { kind: "local" }
  /** Over Tailscale from the student's tailnet, with the account Tailscale verified. */
  | { kind: "tailnet"; login: string }
  /** Over Tailscale, but not as a known user: the internet through Funnel, or a shared or tagged device. */
  | { kind: "outside" };

export function originOf(headers: Headers): Origin {
  const viaTailscale = headers.get("x-forwarded-proto") === "https" || headers.has("tailscale-funnel-request");
  if (!viaTailscale) return { kind: "local" };
  const login = headers.get("tailscale-user-login")?.trim();
  if (login && !headers.has("tailscale-funnel-request")) return { kind: "tailnet", login };
  return { kind: "outside" };
}

/** Paths anyone may reach: the desktop app's "is the host up?" check, which says nothing about the student. */
export function isPublicPath(method: string, pathname: string): boolean {
  return method === "GET" && pathname === "/api/host";
}

export const UNPAIRED_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Slates</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#262626;color:#e7e7e7;font:15px/1.55 -apple-system,BlinkMacSystemFont,system-ui,sans-serif">
<main style="max-width:420px;padding:24px">
<h1 style="margin:0 0 10px;font-size:18px;font-weight:600">This device isn’t paired with Slates yet</h1>
<p style="margin:0;color:#b4b4b4">Turn on Tailscale on this device and open Slates once. Slates will remember it, and after that you won’t need Tailscale here.</p>
</main></body></html>`;
