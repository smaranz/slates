import { z } from "zod";

import { recordProgress } from "@/lib/study/jobs";
import { isStudyId } from "@/lib/study/store";

/** Save which cards the student knows and how their practice answers went. */

export const dynamic = "force-dynamic";

const Progress = z.object({
  id: z.string(),
  cards: z.record(z.string().max(40), z.enum(["again", "good"])).optional(),
  answers: z
    .record(
      z.string().max(40),
      z.object({
        correct: z.boolean().nullable(),
        picked: z.number().int().min(0).max(10).optional(),
        text: z.string().max(4_000).optional(),
        feedback: z.string().max(4_000).optional(),
        at: z.number(),
      }),
    )
    .optional(),
});

export async function POST(request: Request) {
  const parsed = Progress.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isStudyId(parsed.data.id)) return Response.json({ error: "Bad request." }, { status: 400 });
  const set = await recordProgress(parsed.data.id, parsed.data);
  if (!set) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json({ ok: true });
}
