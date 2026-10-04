import { f45Schedule, isStudioSlug } from "@/lib/health/f45";
import { getProfile } from "@/lib/health/store";

/** The student's F45 studio: the week behind and ahead, every class, and today's workout. */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const asked = new URL(request.url).searchParams.get("studio");
  const studio = isStudioSlug(asked) ? asked : (await getProfile()).studio;
  try {
    return Response.json({ schedule: await f45Schedule(studio) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
