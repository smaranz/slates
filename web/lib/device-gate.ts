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

/**
 * Paths anyone may reach: the desktop app's "is the host up?" check, which
 * says nothing about the student, and the "not paired" page's code form, where
 * the code is the credential (lib/devices.ts limits the guesses).
 */
export function isPublicPath(method: string, pathname: string): boolean {
  return (method === "GET" && pathname === "/api/host") || (method === "POST" && pathname === "/api/devices/pair");
}

const PAIRING_PROBLEMS = {
  wrong: "That code isn’t right. Check it and try again.",
  expired: "That code has run out. Get a new one on the paired device.",
};

/** What a device without a key sees, with why its last code failed, if one did. Colours are Slates' own. */
export function unpairedPage(problem?: string | null): string {
  const message = problem === "wrong" || problem === "expired" ? PAIRING_PROBLEMS[problem] : null;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Slates</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:oklch(0.26 0 0);color:oklch(0.907 0 0);font:15px/1.55 -apple-system,BlinkMacSystemFont,system-ui,sans-serif">
<main style="box-sizing:border-box;width:100%;max-width:420px;padding:24px">
<h1 style="margin:0 0 10px;font-size:18px;font-weight:600">This device isn’t paired with Slates yet</h1>
<p style="margin:0 0 22px;color:oklch(0.798 0 0)">On a device that’s already paired, open Settings › General › Devices and choose Get a code. Then type the code here.</p>
<form method="post" action="/api/devices/pair">
<label for="code" style="display:block;margin:0 0 6px;font-size:13px;color:oklch(0.683 0 0)">Pairing code</label>
<div style="display:flex;gap:8px">
<input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="9" placeholder="1234 5678" required${message ? ' aria-invalid="true" aria-describedby="problem"' : ""} style="flex:1;min-width:0;box-sizing:border-box;height:44px;padding:0 14px;border:1px solid oklch(1 0 0 / 0.12);border-radius:10px;background:oklch(0.301 0 0);color:inherit;font:17px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:0.08em">
<button style="height:44px;padding:0 20px;border:0;border-radius:9999px;background:linear-gradient(oklch(0.42 0 0),oklch(0.37 0 0));color:inherit;font:500 15px -apple-system,BlinkMacSystemFont,system-ui,sans-serif;box-shadow:0 1px 2px oklch(0 0 0 / 0.4),inset 0 1px 0 oklch(1 0 0 / 0.08);cursor:pointer">Pair</button>
</div>
${message ? `<p id="problem" role="alert" style="margin:8px 0 0;font-size:13px;color:oklch(0.78 0.18 25)">${message}</p>` : ""}
</form>
<p style="margin:22px 0 0;font-size:13px;color:oklch(0.683 0 0)">Or turn on Tailscale on this device and open Slates once.</p>
</main></body></html>`;
}
