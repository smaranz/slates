import { deleteUpload, isUploadId, MAX_UPLOAD_BYTES, saveUpload } from "@/lib/study/uploads";

/** Files a student adds to a study set: stored on the host, read once on arrival. */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: `Couldn’t read the upload. Files can be up to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File) || !file.name) return Response.json({ error: "Choose a file to upload." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return Response.json({ error: `That file is over ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` }, { status: 413 });
  try {
    return Response.json({ upload: await saveUpload(file.name, await file.arrayBuffer()) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!isUploadId(id)) return Response.json({ error: "Not found." }, { status: 404 });
  await deleteUpload(id);
  return Response.json({ ok: true });
}
