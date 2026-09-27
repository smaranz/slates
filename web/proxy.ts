import { NextResponse, type NextRequest } from "next/server";

/**
 * Only Slates' own pages may call its API.
 *
 * The API can message teachers, hand in work and drive a live quiz as the
 * student, and there is no login in front of it. Browsers label every request
 * with where it came from (`Sec-Fetch-Site`, `Origin`), and a page that
 * rebinds its DNS to this machine still sends its own name as `Host` — so
 * both are checked before any route runs. Non-browser callers (the desktop
 * shell, scripts) send neither label and pass.
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

export function proxy(req: NextRequest) {
  if (!knownHost(hostnameOf(req.headers.get("host")))) {
    return NextResponse.json({ error: "Unknown host." }, { status: 403 });
  }
  if (fromElsewhere(req)) {
    return NextResponse.json({ error: "Slates only accepts requests from its own pages." }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
