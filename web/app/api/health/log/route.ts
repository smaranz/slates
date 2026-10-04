import { changeLog } from "@/lib/health/store";

/** One change to the log (see `changeLog` for the shapes); answers with the whole record. */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  try {
    return Response.json(await changeLog(body));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
