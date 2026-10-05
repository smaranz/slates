import type { Mode } from "@/lib/mode";

export const dynamic = "force-dynamic";

/**
 * Which apps the machine running the portal can serve.
 *
 * AI Usage reads that machine's coding-tool logs with macOS-only commands (the
 * keychain, sqlite3, Terminal), so on a Windows or Linux host it would show
 * wrong or broken numbers — it is hidden there instead. Vitals reads macOS's
 * own process tools, so the same goes for it. The Mac app answers both from
 * the Mac itself, which brings them back there.
 */
export function GET() {
  const unavailable: Mode[] = process.platform === "darwin" ? [] : ["usage", "vitals"];
  return Response.json({ platform: process.platform, unavailable });
}
