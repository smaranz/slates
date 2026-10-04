import { getState, updateProfile } from "@/lib/health/store";

/** The Health record: the profile and the log, as every device sees it. */

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getState());
}

/** A change to the profile; only the fields that check out are kept. */
export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  return Response.json({ profile: await updateProfile(body) });
}
