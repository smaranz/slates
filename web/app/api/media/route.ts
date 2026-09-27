import { hasSecret } from "@/lib/ai-usage/store";
import { refreshLibrary, refreshPending, startGeneration } from "@/lib/media/generate";
import { ElevenLabsError, MissingElevenLabsKeyError } from "@/lib/media/elevenlabs";
import { deleteMedia, getMedia, isMediaId, listMedia, mediaFilePath } from "@/lib/media/library";
import type { GenerateInput, MediaItem, MediaKind } from "@/lib/media/types";
import { MediaInputError } from "@/lib/media/validate";

/** The media library API; every read can resume a persisted remote job. */

export const dynamic = "force-dynamic";

const KINDS: MediaKind[] = ["image", "video", "speech", "sfx", "music"];

type MediaResponseItem = MediaItem & { filePath?: string };

function withPath(item: MediaItem): MediaResponseItem {
  return item.file ? { ...item, filePath: mediaFilePath(item) } : item;
}

function statusFor(error: unknown): number {
  if (error instanceof MediaInputError || error instanceof MissingElevenLabsKeyError) return 400;
  if (error instanceof ElevenLabsError) return 502;
  return 500;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  try {
    if (id !== null) {
      if (!isMediaId(id)) return Response.json({ error: "Media item not found." }, { status: 404 });
      const found = await getMedia(id);
      if (!found) return Response.json({ error: "Media item not found." }, { status: 404 });
      const item = await refreshPending(found);
      return Response.json({ item: withPath(item) });
    }

    const requestedKind = url.searchParams.get("kind");
    const kind = requestedKind && KINDS.includes(requestedKind as MediaKind) ? requestedKind as MediaKind : undefined;
    const rawLimit = Number(url.searchParams.get("limit"));
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(200, Math.floor(rawLimit)) : undefined;
    const items = await refreshLibrary(await listMedia({ kind, query: url.searchParams.get("q") ?? undefined, limit }));
    return Response.json({ items: items.map(withPath), connected: hasSecret("elevenlabs") });
  } catch (error) {
    return Response.json({ error: messageOf(error) }, { status: statusFor(error) });
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  try {
    const item = await startGeneration(body as GenerateInput, "studio");
    return Response.json({ item: withPath(item) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: messageOf(error) }, { status: statusFor(error) });
  }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!isMediaId(id)) return Response.json({ error: "Media item not found." }, { status: 404 });
  try {
    const item = await getMedia(id);
    if (!item) return Response.json({ error: "Media item not found." }, { status: 404 });
    const current = await refreshPending(item);
    if (current.status === "generating") return Response.json({ error: "This item is still generating." }, { status: 409 });
    await deleteMedia(id);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: messageOf(error) }, { status: 500 });
  }
}
