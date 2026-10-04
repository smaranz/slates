import { analyzePhoto, analyzeText, NoFoodError, reviseAnalysis } from "@/lib/health/analyze";
import { foodByBarcode } from "@/lib/health/foods";
import { isPhotoId, MAX_PHOTO_BYTES, readPhoto, savePhoto } from "@/lib/health/store";
import type { FoodAnalysis } from "@/lib/health/types";

/**
 * Reads a meal: a photo (multipart `photo`, optional `note`), a description
 * (`{ text }`), or a correction to an earlier read (`{ fix, current, photo }`).
 * A photo is kept on the host so the logged meal can show it.
 */

export const dynamic = "force-dynamic";

/** A barcode's own product record beats a guess at it; a label's printed numbers beat the record. */
async function withProduct(analysis: FoodAnalysis): Promise<FoodAnalysis> {
  if (!analysis.barcode || analysis.kind === "meal") return analysis;
  const product = await foodByBarcode(analysis.barcode).catch(() => null);
  if (!product) return analysis;
  if (analysis.kind === "label") return { ...analysis, brand: analysis.brand ?? product.brand };
  return {
    ...analysis,
    name: product.name,
    brand: product.brand,
    serving: product.serving,
    servings: 1,
    per: product.per,
    healthScore: product.healthScore ?? analysis.healthScore,
    confidence: 0.95,
    needsCheck: false,
  };
}

function failure(error: unknown) {
  if (error instanceof NoFoodError) return Response.json({ error: error.message }, { status: 422 });
  const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
  return Response.json({ error: `Couldn’t read that meal: ${message}` }, { status: 502 });
}

const isAnalysis = (value: unknown): value is FoodAnalysis =>
  !!value && typeof value === "object" && typeof (value as FoodAnalysis).name === "string" && !!(value as FoodAnalysis).per;

export async function POST(request: Request) {
  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return Response.json({ error: "Couldn’t read the photo." }, { status: 400 });
    }
    const file = form.get("photo");
    if (!(file instanceof File) || !file.size) return Response.json({ error: "Choose a photo." }, { status: 400 });
    if (file.size > MAX_PHOTO_BYTES) return Response.json({ error: "That photo is over 12 MB." }, { status: 413 });
    const data = new Uint8Array(await file.arrayBuffer());
    const note = form.get("note");
    let photo: string;
    try {
      photo = await savePhoto(data, file.type);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
    try {
      const analysis = await withProduct(await analyzePhoto(data, file.type, typeof note === "string" ? note : undefined));
      return Response.json({ analysis, photo });
    } catch (error) {
      return failure(error);
    }
  }

  let body: { text?: unknown; fix?: unknown; current?: unknown; photo?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  try {
    if (typeof body.fix === "string" && body.fix.trim() && isAnalysis(body.current)) {
      const stored = isPhotoId(body.photo) ? await readPhoto(body.photo) : null;
      const image = stored ? { data: new Uint8Array(stored.data), mediaType: stored.type } : undefined;
      return Response.json({ analysis: await withProduct(await reviseAnalysis(body.current, body.fix, image)) });
    }
    if (typeof body.text === "string" && body.text.trim()) return Response.json({ analysis: await analyzeText(body.text) });
    return Response.json({ error: "Describe the meal first." }, { status: 400 });
  } catch (error) {
    return failure(error);
  }
}
