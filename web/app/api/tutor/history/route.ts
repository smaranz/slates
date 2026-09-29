import { deleteTutorTranscript, isTutorChatId } from "@/lib/learning/recall";

/**
 * The host's copy of a tutor chat, kept so helpers can recall it. Deleting a
 * chat in the tutor deletes this too, so a deleted chat can't come back in
 * someone's search.
 */

export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!isTutorChatId(id)) return Response.json({ error: "Unknown chat." }, { status: 404 });
  deleteTutorTranscript(id);
  return Response.json({ ok: true });
}
