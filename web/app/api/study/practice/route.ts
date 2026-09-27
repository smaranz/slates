import { startRound } from "@/lib/study/jobs";
import { isStudyId } from "@/lib/study/store";

/** Write another round of practice, weighted toward what the student has missed. */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!isStudyId(id)) return Response.json({ error: "Not found." }, { status: 404 });
  const set = await startRound(id);
  if (!set) return Response.json({ error: "Not found." }, { status: 404 });
  if (set.status !== "ready") return Response.json({ error: "This study set isn't ready yet." }, { status: 409 });
  return Response.json({ set }, { status: 202 });
}
