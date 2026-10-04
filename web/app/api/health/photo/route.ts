import { readPhoto } from "@/lib/health/store";

/** A logged meal's photo. Only images are ever stored, and they're sent as what they are. */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const photo = await readPhoto(new URL(request.url).searchParams.get("id") ?? "");
  if (!photo) return Response.json({ error: "Not found." }, { status: 404 });
  return new Response(new Uint8Array(photo.data), {
    headers: {
      "content-type": photo.type,
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
