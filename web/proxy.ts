import { NextResponse, type NextRequest } from "next/server";

import { isPublicPath, originOf, unpairedPage } from "@/lib/device-gate";
import { DEVICE_COOKIE, DEVICE_COOKIE_OPTIONS, enroll, isOwner, touch, verifyKey } from "@/lib/devices";

/**
 * Who may reach Slates, and only from Slates' own pages.
 *
 * The API can message teachers, hand in work, drive a live quiz and run the
 * agents' commands on the host, so every request that arrives through
 * Tailscale — the tailnet, or the internet through Funnel — must carry a
 * paired device's key (see lib/devices.ts). A device on the student's tailnet
 * is paired on its first request, any other by typing a code a paired device
 * shows; requests on the host itself need nothing.
 *
 * Then, for the API: browsers label every request with where it came from
 * (`Sec-Fetch-Site`, `Origin`), and a page that rebinds its DNS to this
 * machine still sends its own name as `Host`, so both are checked before any
 * route runs. Non-browser callers (the desktop shell, scripts) send neither
 * label and pass.
 */

/** GET endpoints that open as documents — a new tab, or the system browser. */
const DOCUMENTS = new Set(["/api/tutor/files", "/api/materials/file", "/api/media/file"]);

const EXTRA_HOSTS = new Set(
  (process.env.SLATES_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
);

function hostnameOf(host: string | null): string {
  if (!host) return "";
  try {
    return new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Loopback, a LAN or tailnet address, or a Tailscale name — never a name an outside page controls. */
function knownHost(name: string): boolean {
  return (
    name === "localhost" ||
    name.endsWith(".localhost") ||
    name.endsWith(".ts.net") ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(name) ||
    name.startsWith("[") ||
    EXTRA_HOSTS.has(name)
  );
}

function fromElsewhere(req: NextRequest): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site === "same-origin") return false;
  if (site === "none") return !(req.method === "GET" && DOCUMENTS.has(req.nextUrl.pathname));
  if (site) return true;

  // Older browsers without Fetch Metadata still send Origin on anything cross-origin.
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const from = new URL(origin).host.toLowerCase();
    return from !== req.headers.get("host")?.toLowerCase() && from !== req.headers.get("x-forwarded-host")?.toLowerCase();
  } catch {
    return true;
  }
}

function unpaired(req: NextRequest): NextResponse {
  const page = req.method === "GET" && (req.headers.get("sec-fetch-dest") === "document" || (req.headers.get("accept") ?? "").includes("text/html"));
  if (page) return new NextResponse(unpairedPage(req.nextUrl.searchParams.get("pairing")), { status: 401, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  return NextResponse.json({ error: "This device isn't paired with Slates. Pair it with a code from Settings › General › Devices on a paired device." }, { status: 401 });
}

export function proxy(req: NextRequest) {
  if (!knownHost(hostnameOf(req.headers.get("host")))) {
    return NextResponse.json({ error: "Unknown host." }, { status: 403 });
  }

  let issue: string | null = null;
  const origin = originOf(req.headers);
  if (origin.kind !== "local" && !isPublicPath(req.method, req.nextUrl.pathname)) {
    const cookie = req.cookies.get(DEVICE_COOKIE)?.value;
    const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
    const device = verifyKey(cookie ?? bearer);
    if (device) {
      touch(device);
      // Renewed on every page load, so a device in use never ages out.
      if (cookie && req.headers.get("sec-fetch-dest") === "document") issue = cookie;
    } else if (origin.kind === "tailnet") {
      if (!isOwner(origin.login)) return unpaired(req);
      // Only a browser can keep the key; a script on the tailnet gets in on Tailscale's word alone.
      // (Node's fetch sends Sec-Fetch-Mode as well, but only browsers send Sec-Fetch-Dest.)
      if (req.headers.has("sec-fetch-dest")) issue = enroll(origin.login, req.headers.get("user-agent") ?? "")?.key ?? null;
    } else {
      return unpaired(req);
    }
  }

  if (req.nextUrl.pathname.startsWith("/api/") && fromElsewhere(req)) {
    return NextResponse.json({ error: "Slates only accepts requests from its own pages." }, { status: 403 });
  }

  const response = NextResponse.next();
  if (issue) {
    response.cookies.set(DEVICE_COOKIE, issue, DEVICE_COOKIE_OPTIONS);
  }
  return response;
}

export const config = {
  matcher: "/:path*",
};
