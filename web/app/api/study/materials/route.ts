import { listMaterials, readable } from "@/lib/study/gather";

/**
 * One level of a class's Schoology Materials, for picking what a study set is
 * built from. Read through the sync service's session, like the builder does.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const course = url.searchParams.get("course") ?? "";
  const folder = url.searchParams.get("folder");
  if (!/^\d{1,24}$/.test(course) || (folder !== null && !/^\d{1,24}$/.test(folder))) {
    return Response.json({ error: "That isn't a Schoology class or folder." }, { status: 400 });
  }
  try {
    const items = await listMaterials(course, folder);
    return Response.json({
      items: items.map((item) => ({
        kind: item.kind,
        title: item.title || item.filename || "Untitled",
        url: item.url,
        folderId: item.folderId,
        readable: item.kind !== "folder" && readable(item.url),
      })),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
