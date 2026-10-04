import { foodByBarcode, searchFoods } from "@/lib/health/foods";

/** Packaged foods from Open Food Facts: `?q=` by name, `?barcode=` by the digits under the bars. */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    const barcode = params.get("barcode");
    if (barcode) {
      const product = await foodByBarcode(barcode);
      return Response.json({ products: product ? [product] : [] });
    }
    return Response.json({ products: await searchFoods(params.get("q") ?? "") });
  } catch (error) {
    return Response.json({ error: `Couldn’t search foods: ${error instanceof Error ? error.message : String(error)}`, products: [] }, { status: 502 });
  }
}
