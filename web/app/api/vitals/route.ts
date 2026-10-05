import { quitApp, stopServers } from "@/lib/vitals/actions";
import { snapshot } from "@/lib/vitals/mac";
import { appIcons } from "@/lib/vitals/probe";

export const dynamic = "force-dynamic";

/**
 * Vitals: this Mac right now (GET), app icons, and the two things the room
 * can do, quit an app and stop a dev server (POST). The Mac app answers it
 * from the Mac itself when Slates is hosted elsewhere; see /api/host.
 */

function offMac(): Response | null {
  if (process.platform === "darwin") return null;
  return Response.json({ error: "Vitals reads the Mac it runs on, and this isn't one." }, { status: 404 });
}

export async function GET() {
  const unsupported = offMac();
  if (unsupported) return unsupported;
  try {
    return Response.json(await snapshot());
  } catch (err) {
    console.error("[vitals] reading this Mac failed", err);
    return Response.json({ error: "Couldn't read this Mac." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const unsupported = offMac();
  if (unsupported) return unsupported;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "icons": {
        const apps = Array.isArray(body.apps) ? body.apps.filter((a): a is string => typeof a === "string") : [];
        return Response.json({ icons: await appIcons(apps) });
      }
      case "quit":
        if (typeof body.app !== "string" || !body.app) return Response.json({ error: "Which app?" }, { status: 400 });
        return Response.json(await quitApp(body.app));
      case "stop": {
        const pids = Array.isArray(body.pids) ? body.pids.filter((p): p is number => Number.isInteger(p) && (p as number) > 1) : [];
        if (!pids.length) return Response.json({ error: "Which server?" }, { status: 400 });
        return Response.json(await stopServers(pids));
      }
      default:
        return Response.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (err) {
    console.error("[vitals] action failed", err);
    return Response.json({ ok: false, message: err instanceof Error ? err.message : "That didn't work." }, { status: 500 });
  }
}
