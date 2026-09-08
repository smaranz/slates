import { SchoologyError, keysFromEnv, schoology } from "@/lib/schoology/client";
import { buildSnapshot } from "@/lib/schoology/snapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Sync, straight from the Schoology REST API.
 *
 * GET reports whether the key works, which is what the app polls to decide
 * between "connected" and a setup prompt. POST pulls a whole snapshot.
 *
 * The route keeps its path because the store, the settings screen and the
 * desktop shell all call it by name, and renaming it would be churn for no
 * change in behaviour.
 */

const SETUP =
  "Slates isn't connected to Schoology yet. Add SCHOOLOGY_KEY and SCHOOLOGY_SECRET to web/.env.local — generate them at https://<your-district>.schoology.com/api";

export async function GET() {
  try {
    keysFromEnv();
  } catch {
    return Response.json({ running: false, error: SETUP });
  }

  try {
    const me = await schoology.me();
    return Response.json({
      running: true,
      student: me.name_display?.trim() || me.name_first?.trim() || "",
    });
  } catch (e) {
    const error =
      e instanceof SchoologyError ? e.message : "Couldn't reach Schoology. Check your connection.";
    return Response.json({ running: false, error });
  }
}

export async function POST() {
  try {
    const { snapshot, stats, student } = await buildSnapshot();
    return Response.json({ snapshot, stats, student });
  } catch (e) {
    if (e instanceof SchoologyError) {
      // A rejected key is a setup problem, not an outage — say which.
      return Response.json({ error: e.unauthorized ? SETUP : e.message }, { status: 502 });
    }
    return Response.json({ error: e instanceof Error ? e.message : "Sync failed." }, { status: 500 });
  }
}
