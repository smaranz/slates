import { roundNutrition, scaled } from "./nutrition";
import type { FoodProduct, Nutrition } from "./types";

/**
 * Packaged foods from Open Food Facts: a search by name, and a lookup by the
 * digits under a barcode. Free and keyless, as CalAi used it; asked from the
 * host so the phone never talks to a third party and answers are shared.
 */

const UA = "Slates/0.1 (personal health tracker; https://github.com/smaranz/slates)";
const FIELDS = "code,product_name,brands,nutriments,serving_quantity,serving_size,nutrition_grades,image_front_small_url";

type Raw = Record<string, unknown>;

const num = (value: unknown) => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

function nutrientsAt(raw: Raw, suffix: "_100g" | "_serving"): Nutrition | null {
  const get = (key: string) => num(raw[`${key}${suffix}`]);
  const kcal = get("energy-kcal") ?? (get("energy") !== undefined ? get("energy")! / 4.184 : undefined);
  if (kcal === undefined) return null;
  const sodium = get("sodium") ?? (get("salt") !== undefined ? get("salt")! / 2.5 : undefined);
  return {
    calories: kcal,
    protein: get("proteins") ?? 0,
    carbs: get("carbohydrates") ?? 0,
    fat: get("fat") ?? 0,
    ...(get("fiber") !== undefined ? { fiber: get("fiber") } : {}),
    ...(get("sugars") !== undefined ? { sugar: get("sugars") } : {}),
    ...(sodium !== undefined ? { sodium: sodium * 1000 } : {}),
  };
}

const GRADE_SCORE: Record<string, number> = { a: 9, b: 7, c: 5, d: 3, e: 1 };

/** One Open Food Facts product as a serving the student can log, or null when it has no name or no numbers. */
export function productFrom(raw: Raw): FoodProduct | null {
  const name = typeof raw.product_name === "string" ? raw.product_name.trim() : "";
  const code = typeof raw.code === "string" ? raw.code : "";
  const nutriments = (raw.nutriments ?? {}) as Raw;
  if (!name || !code) return null;
  const brands = Array.isArray(raw.brands) ? raw.brands : typeof raw.brands === "string" ? raw.brands.split(",") : [];
  const brand = brands.map((b) => String(b).trim()).find(Boolean);
  const grams = num(raw.serving_quantity);
  const servingSize = typeof raw.serving_size === "string" ? raw.serving_size.trim() : "";

  // The label's own per-serving numbers when there are any, else per 100 g scaled to the serving.
  const perServing = nutrientsAt(nutriments, "_serving");
  const per100 = nutrientsAt(nutriments, "_100g");
  let per: Nutrition | null;
  let serving: string;
  if (perServing && (servingSize || grams)) {
    per = perServing;
    serving = servingSize || `${Math.round(grams!)} g`;
  } else if (per100 && grams && grams > 0) {
    per = scaled(per100, grams / 100);
    serving = servingSize || `${Math.round(grams)} g`;
  } else {
    per = per100;
    serving = "100 g";
  }
  if (!per) return null;

  const grade = typeof raw.nutrition_grades === "string" ? raw.nutrition_grades.toLowerCase() : "";
  return {
    id: code,
    name,
    brand,
    serving,
    per: roundNutrition(per),
    healthScore: GRADE_SCORE[grade],
    image: typeof raw.image_front_small_url === "string" ? raw.image_front_small_url : undefined,
    barcode: code,
  };
}

const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return value;
}

async function getJson(url: string): Promise<Raw> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`Open Food Facts answered ${res.status}.`);
  return (await res.json()) as Raw;
}

export function searchFoods(query: string): Promise<FoodProduct[]> {
  const q = query.trim().slice(0, 80);
  if (q.length < 2) return Promise.resolve([]);
  return cached(`q:${q.toLowerCase()}`, 10 * 60_000, async () => {
    const body = await getJson(`https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&page_size=24&fields=${FIELDS}`);
    const hits = Array.isArray(body.hits) ? (body.hits as Raw[]) : [];
    const seen = new Set<string>();
    return hits
      .map(productFrom)
      .filter((p): p is FoodProduct => {
        if (!p) return false;
        const key = `${p.brand ?? ""}|${p.name}`.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 15);
  });
}

export function foodByBarcode(barcode: string): Promise<FoodProduct | null> {
  const code = barcode.replace(/\D/g, "");
  if (code.length < 8 || code.length > 14) return Promise.resolve(null);
  return cached(`b:${code}`, 24 * 3600_000, async () => {
    const body = await getJson(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${FIELDS}`);
    return body.status === 1 && body.product ? productFrom({ ...(body.product as Raw), code }) : null;
  });
}
