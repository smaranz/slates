import { z } from "zod";

import { settle, startBuild } from "@/lib/study/jobs";
import { deleteSet, getSet, isStudyId, listSets } from "@/lib/study/store";
import { mastery, type BuildRequest, type StudySet } from "@/lib/study/types";

/** Study sets: list them, read one, build one from Schoology, or throw one away. */

export const dynamic = "force-dynamic";

const numericId = z.string().regex(/^\d{1,24}$/);

const Attachment = z.object({
  kind: z.enum(["file", "link", "page"]),
  title: z.string().max(500),
  url: z.string().max(2000),
  target: z.string().max(2000).optional(),
  filename: z.string().max(500).optional(),
  size: z.string().max(50).optional(),
});

const Item = z.object({
  id: numericId,
  title: z.string().min(1).max(500),
  kind: z.string().max(40).optional(),
  brief: z.string().max(20_000).optional(),
  due: z.string().max(200).optional(),
  dateOffset: z.number().int().nullable().optional(),
  url: z.string().max(2000).nullable().optional(),
  attachments: z.array(Attachment).max(40).optional(),
});

const Build = z.object({
  target: Item.extend({ courseId: numericId, testKind: z.enum(["test", "quiz", "exam"]) }),
  course: z.object({ id: numericId, name: z.string().min(1).max(200) }),
  related: z.array(Item).max(300),
});

function summary(set: StudySet) {
  return {
    id: set.id,
    courseId: set.courseId,
    course: set.course,
    title: set.title,
    status: set.status,
    step: set.step,
    error: set.error,
    cards: set.cards.length,
    questions: set.questions.length,
    sources: set.sources.filter((source) => source.read).length,
    mastery: mastery(set),
    updatedAt: set.updatedAt,
  };
}

export type StudySummary = ReturnType<typeof summary>;

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (id !== null) {
    if (!isStudyId(id)) return Response.json({ error: "Not found." }, { status: 404 });
    const set = await getSet(id);
    if (!set) return Response.json({ error: "Not found." }, { status: 404 });
    return Response.json({ set: await settle(set) });
  }
  const sets = await Promise.all((await listSets()).map(settle));
  return Response.json({ sets: sets.map(summary) });
}

export async function POST(request: Request) {
  const parsed = Build.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That isn't something Slates can build a study set for." }, { status: 400 });
  const set = await startBuild(parsed.data as BuildRequest);
  return Response.json({ set }, { status: 202 });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!isStudyId(id)) return Response.json({ error: "Not found." }, { status: 404 });
  await deleteSet(id);
  return Response.json({ ok: true });
}
