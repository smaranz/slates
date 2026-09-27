import { z } from "zod";

import { changeHidden, hiddenList, isStudyId } from "@/lib/study/store";

/**
 * Tests the student took off the Study list. Kept on the host, like the sets,
 * so a test removed on the laptop is gone on the phone too; the Schoology item
 * itself is untouched.
 */

export const dynamic = "force-dynamic";

const Change = z.object({
  hide: z
    .array(z.object({ id: z.string().refine(isStudyId), title: z.string().min(1).max(500), courseId: z.string().regex(/^\d{1,24}$/) }))
    .max(300)
    .optional(),
  show: z.union([z.array(z.string().refine(isStudyId)).max(300), z.literal("all")]).optional(),
});

export async function POST(request: Request) {
  const parsed = Change.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That isn't a change Slates can make to the list." }, { status: 400 });
  const { hide = [], show = [] } = parsed.data;
  const hidden = await changeHidden((current) => {
    const next = show === "all" ? {} : Object.fromEntries(Object.entries(current).filter(([id]) => !show.includes(id)));
    for (const test of hide) next[test.id] = { title: test.title, courseId: test.courseId, at: Date.now() };
    return next;
  });
  return Response.json({ hidden: hiddenList(hidden) });
}
