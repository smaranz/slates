import { estimateHealthScore, reconcileHealthScore, roundNutrition } from "./nutrition";
import type { FoodAnalysis, Nutrition } from "./types";

/**
 * A meal's nutrition from a photo or a few typed words, read by a vision model.
 *
 * The prompts are CalAi's (conservative portions, one serving, macros that add
 * up, a 1–10 score), widened to take the two other things people photograph
 * when logging: a Nutrition Facts panel, copied exactly, and a barcode, whose
 * digits the route then looks up in Open Food Facts. Whatever comes back goes
 * through CalAi's validator before the student sees it.
 */

/**
 * GPT-6 Luna, which reads photos: through OpenRouter first, since that's the
 * key that works on the host, then straight from OpenAI. The same order Study
 * Studio reads scans in.
 */
export const FOOD_READERS = [
  { backend: "openrouter", model: "openai/gpt-6-luna" },
  { backend: "openai", model: "gpt-6-luna" },
] as const;

export interface ReadInput {
  prompt: string;
  image?: { data: Uint8Array; mediaType: string };
}

export type FoodReader = (input: ReadInput) => Promise<string>;

const SYSTEM = [
  "You are a careful nutrition analyst for a food-logging app.",
  "You ONLY describe food that is clearly visible or described; never invent dishes, brands or ingredients you cannot see.",
  'If unsure, use a simple generic name (e.g. "Mixed salad bowl") and lower your confidence.',
  "Estimate portions conservatively: when size is ambiguous, choose the smaller reasonable serving and round calories slightly down, not up.",
  "Respond ONLY with a JSON object, no prose or markdown.",
].join(" ");

const SCHEMA = `Return JSON with exactly these keys:
- "kind": "meal" for food on a plate, in a bowl or in a hand; "label" when a Nutrition Facts panel is readable; "barcode" when the photo is mainly a product's barcode; "none" when no food or food packaging is shown.
- "name" (string): short, plain name for what is being eaten: one dish, or the foods on the plate joined ("Eggs, toast and oat latte"). Real food a person would order or cook, never a nonsense mashup (BAD: "ice cream shower"; GOOD: "Vanilla ice cream scoop", "Grilled chicken salad"). For packaging, the product's name.
- "brand" (string or null): the brand, when printed on a package.
- "barcode" (string or null): the digits printed under a barcode, when they are readable.
- "servingDescription" (string): ONE serving, e.g. "1 scoop (~65 g)", "1 slice", "1 bowl (~250 g)", "1 plate". For a label, its own serving size.
- "servings" (number): how many of that serving are shown or described, usually 1. Three identical cookies are 3 servings of "1 cookie"; a plate of different foods is 1 serving of "1 plate".
- "confidence" (number 0.0-1.0): how sure you are of identity AND portion. At most 0.5 when blurry, partly hidden or generic; 0.85 or more only when the food or label is clear.
- "healthScore" (integer 1-10).
- "ingredients" (array of strings): visible or clearly implied components of ONE serving, short and lowercase ("grilled chicken", "romaine lettuce"). Composed dishes (salads, bowls, burgers, sandwiches, pasta, pizza, stir-fry) list 3-8; a simple whole food lists 1-3.
- "calories", "protein", "carbs", "fat", "fiber", "sugar" (numbers; grams for all but calories) and "sodium" (number, milligrams): nutrition for exactly ONE serving. When the serving is a plate or a meal of different foods, that is all of them together; never another person's food at the edge of the photo. Use 0 when negligible.

For a Nutrition Facts label, copy the per-serving values exactly as printed.
Calorie rules: protein*4 + carbs*4 + fat*9 should come within about 15% of calories. Prefer USDA-style reference values for common foods. Do not inflate portions.`;

const SCORE = `healthScore rates one serving's overall nutritional quality:
9-10 mostly whole or minimally processed foods (vegetables, fruit, legumes, whole grains, lean protein, healthy fats like avocado or olive oil);
7-8 balanced home-style meals with reasonable fiber and moderate fat and sugar;
5-6 mixed quality, some refined carbs or moderate processing;
3-4 fried, breaded, fast food, heavy sauces, low fiber, high fat or sodium;
1-2 deep-fried combos, sugary desserts, ultra-processed snacks.
Avocado toast on whole grain is about 7-8; veggie tenders with fries about 3-4. Do not inflate scores for plant-based junk food.`;

/** A provider's "wrong key" error, which for OpenAI also echoes part of the key: never shown as is. */
const REFUSED = /api key|unauthori[sz]ed|\b401\b|auth(?:entication)? credentials|no auth/i;

async function readWithModel({ prompt, image }: ReadInput): Promise<string> {
  // Loaded on first use: the provider clients are server-only, and tests swap the reader out.
  const [{ generateText }, { openaiModel, openrouterModel }, { noteFromUsage }] = await Promise.all([
    import("ai"),
    import("../ai-usage/clients"),
    import("../ai-usage/note"),
  ]);
  const refused: string[] = [];
  let failure: string | null = null;
  for (const { backend, model } of FOOD_READERS) {
    try {
      const { text, usage } = await generateText({
        model: backend === "openrouter" ? openrouterModel(model) : openaiModel(model),
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: image
              ? [
                  { type: "text", text: prompt },
                  { type: "file", data: image.data, mediaType: image.mediaType, filename: "meal.jpg" },
                ]
              : [{ type: "text", text: prompt }],
          },
        ],
        // Reading a plate is quick work; low effort keeps a scan to a few seconds.
        providerOptions: backend === "openai" ? { openai: { reasoningEffort: "low" } } : { openrouter: { reasoning: { effort: "low" } } },
        abortSignal: AbortSignal.timeout(90_000),
      });
      noteFromUsage("health", model, backend, usage);
      return text;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (REFUSED.test(message)) refused.push(backend === "openai" ? "OpenAI" : "OpenRouter");
      else failure ??= message.split("\n")[0]!;
    }
  }
  throw new Error(failure ?? `the ${refused.join(" and ")} ${refused.length === 1 ? "key was" : "keys were"} refused. Add a working one in AI Usage`);
}

let reader: FoodReader = readWithModel;

/** For tests: read meals with something other than the model. */
export function setFoodReader(next: FoodReader | null): void {
  reader = next ?? readWithModel;
}

/* ── reading the reply ─────────────────────────────────────────────────── */

function num(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value.replace(/[^\d.-]/g, "")) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function ingredientsOf(value: unknown): string[] {
  const list = Array.isArray(value)
    ? value.map((item) => (typeof item === "string" ? item : item && typeof item === "object" ? ((item as Record<string, unknown>).name ?? (item as Record<string, unknown>).ingredient) : null))
    : typeof value === "string"
      ? value.split(",")
      : [];
  return list
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 10);
}

/** Splits "chicken with rice and beans" into parts when the model lists none. */
export function fallbackIngredients(name: string): string[] {
  const parts = name
    .toLowerCase()
    .replace(/ with | and | & | \+ /g, ",")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 1);
  return parts.length >= 2 ? parts.slice(0, 8) : [];
}

export class NoFoodError extends Error {
  constructor() {
    super("No food in that photo. Try again closer up, or describe it instead.");
  }
}

/** The JSON object in a model's reply, fences and chatter around it ignored. */
export function parseAnalysis(content: string): FoodAnalysis {
  const cleaned = content.replace(/```(?:json)?/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Couldn’t read the analysis. Try again.");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new Error("Couldn’t read the analysis. Try again.");
  }

  const kindRaw = str(raw.kind)?.toLowerCase();
  const name = str(raw.name) ?? "";
  const per: Nutrition = {
    calories: num(raw.calories) ?? 0,
    protein: num(raw.protein) ?? 0,
    carbs: num(raw.carbs) ?? 0,
    fat: num(raw.fat) ?? 0,
    fiber: num(raw.fiber),
    sugar: num(raw.sugar),
    sodium: num(raw.sodium),
  };
  if (kindRaw === "none" || (!name && per.calories <= 0)) throw new NoFoodError();

  const confidenceRaw = num(raw.confidence);
  const barcode = str(raw.barcode)?.replace(/\D/g, "");
  const servings = num(raw.servings);
  const analysis: FoodAnalysis = {
    name,
    serving: str(raw.servingDescription) ?? str(raw.serving_description) ?? "1 serving",
    servings: servings === undefined ? 1 : Math.min(20, Math.max(0.25, Math.round(servings * 4) / 4)),
    per,
    healthScore: 0,
    confidence: confidenceRaw === undefined ? 0.75 : Math.min(1, Math.max(0, confidenceRaw)),
    needsCheck: false,
    ingredients: ingredientsOf(raw.ingredients),
    kind: kindRaw === "label" || kindRaw === "barcode" ? kindRaw : "meal",
    brand: str(raw.brand),
    barcode: barcode && barcode.length >= 8 && barcode.length <= 14 ? barcode : undefined,
  };
  if (!analysis.ingredients.length) analysis.ingredients = fallbackIngredients(analysis.name);

  const heuristic = estimateHealthScore(analysis.per, analysis.name);
  const ai = num(raw.healthScore) ?? num(raw.health_score);
  analysis.healthScore = ai === undefined ? heuristic : reconcileHealthScore(ai, heuristic);
  return validate(analysis, confidenceRaw === undefined);
}

/* ── CalAi's validator ─────────────────────────────────────────────────── */

const NOT_FOOD = new RegExp(
  `\\b(?:${[
    "shower", "bathroom", "toilet", "sink", "faucet", "mirror", "towel", "bedroom", "living room", "couch", "sofa",
    "television", "phone", "laptop", "computer", "keyboard", "desk", "chair", "empty plate", "background", "wall",
    "floor", "ceiling", "window", "door", "street", "building", "person", "hand only", "finger",
  ].join("|")})\\b`,
);

const FOOD_HINTS = [
  "chicken", "beef", "pork", "fish", "salmon", "tuna", "shrimp", "egg", "tofu", "rice", "pasta", "noodle", "bread",
  "toast", "pizza", "burger", "sandwich", "salad", "soup", "stew", "curry", "bowl", "wrap", "taco", "burrito", "apple",
  "banana", "berry", "fruit", "vegetable", "broccoli", "carrot", "potato", "fries", "chips", "cookie", "cake",
  "brownie", "donut", "pastry", "ice cream", "gelato", "yogurt", "milk", "cheese", "coffee", "latte", "tea",
  "smoothie", "shake", "juice", "soda", "oatmeal", "cereal", "granola", "avocado", "beans", "lentil", "chickpea",
  "steak", "bacon", "sausage", "ham", "turkey", "lamb", "sushi", "roll", "dumpling", "nugget", "wing", "meatball",
  "lasagna", "quinoa", "hummus", "sauce", "dressing", "salsa", "guacamole", "bar", "protein", "drink", "water",
];

const GENERIC_OK = ["meal", "snack", "dish", "food", "plate", "serving", "breakfast", "lunch", "dinner", "dessert", "beverage", "side"];

function genericName(lower: string): string {
  if (/ice cream|gelato|sorbet/.test(lower)) return "Ice cream scoop";
  if (/cookie|brownie|cake/.test(lower)) return "Baked dessert";
  if (lower.includes("salad")) return "Salad";
  if (lower.includes("pizza")) return "Pizza slice";
  if (lower.includes("burger")) return "Burger";
  if (lower.includes("sandwich")) return "Sandwich";
  if (/coffee|latte/.test(lower)) return "Coffee drink";
  if (/smoothie|shake/.test(lower)) return "Smoothie";
  if (lower.includes("soup")) return "Soup bowl";
  if (/rice|bowl/.test(lower)) return "Rice bowl";
  if (/pasta|noodle/.test(lower)) return "Pasta dish";
  return "Prepared food";
}

/** A sensible name, and whether the one the model gave looked made up. */
export function sanitizedName(raw: string, packaged = false): { name: string; suspicious: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) return { name: "Unidentified food", suspicious: true };
  const lower = trimmed.toLowerCase();
  const words = lower.split(/[^a-z0-9]+/).filter(Boolean);
  const hasFood = FOOD_HINTS.some((hint) => lower.includes(hint));
  if (NOT_FOOD.test(lower)) return { name: genericName(lower), suspicious: true };
  // A packaged product's name is often a brand word with no food in it; that's fine.
  if (!packaged && words.length >= 3 && !hasFood && !GENERIC_OK.some((w) => lower.includes(w))) return { name: genericName(lower), suspicious: true };
  if (trimmed.length > 80) return { name: trimmed.slice(0, 60).trim(), suspicious: true };
  return { name: trimmed, suspicious: false };
}

function maxCalories(name: string): number {
  const lower = name.toLowerCase();
  if (/whole pizza|large pizza/.test(lower)) return 2400;
  if (lower.includes("pizza")) return 450;
  if (/ice cream|gelato|scoop/.test(lower)) return 450;
  if (/shake|smoothie/.test(lower)) return 900;
  if (lower.includes("burger")) return 950;
  if (/fries|chips/.test(lower)) return 650;
  if (lower.includes("salad")) return 700;
  if (lower.includes("bowl")) return 900;
  if (/dessert|cake|cookie/.test(lower)) return 600;
  return 1200;
}

/** Calories within reason for one serving, and in line with what the macros add up to. */
export function sanitizedNutrition(n: Nutrition, name: string): { per: Nutrition; changed: boolean } {
  const per: Nutrition = { ...n };
  let changed = false;
  const max = maxCalories(name);
  if (per.calories > max) {
    per.calories = max;
    changed = true;
  } else if (per.calories < 5 && per.protein + per.carbs + per.fat > 1) {
    per.calories = 5;
    changed = true;
  }
  for (const key of ["protein", "carbs", "fat", "fiber", "sugar", "sodium"] as const) {
    if (per[key] !== undefined) per[key] = Math.max(0, per[key]!);
  }
  // Fiber sits inside total carbs but gives closer to 2 kcal/g than 4.
  const fiber = Math.min(per.fiber ?? 0, per.carbs);
  const fromMacros = per.protein * 4 + (per.carbs - fiber) * 4 + fiber * 2 + per.fat * 9;
  if (fromMacros > 0) {
    const ratio = per.calories / fromMacros;
    // Sauces, alcohol and rounding open a gap; only a wide one is reconciled, and not always downward.
    if (ratio > 1.3 || ratio < 0.7) {
      const blended = per.calories * 0.65 + fromMacros * 0.35;
      per.calories = Math.min(ratio > 1.3 ? Math.min(blended, fromMacros * 1.25) : blended, max);
      changed = true;
    }
  }
  return { per, changed };
}

function validate(analysis: FoodAnalysis, guessedConfidence: boolean): FoodAnalysis {
  const packaged = analysis.kind !== "meal" || !!analysis.brand;
  const named = sanitizedName(analysis.name, packaged);
  // A label's numbers are printed fact; only a plate's estimate is reined in.
  const nutrition = analysis.kind === "label" ? { per: analysis.per, changed: false } : sanitizedNutrition(analysis.per, named.name);
  const adjusted = named.name !== analysis.name || nutrition.changed;
  let confidence = analysis.confidence;
  if (guessedConfidence && (named.suspicious || adjusted)) confidence = Math.min(confidence, 0.55);
  return {
    ...analysis,
    name: named.name,
    per: roundNutrition(nutrition.per),
    confidence,
    needsCheck: confidence < 0.65 || named.suspicious || adjusted,
  };
}

/* ── the three ways in ─────────────────────────────────────────────────── */

export async function analyzePhoto(data: Uint8Array, mediaType: string, note?: string): Promise<FoodAnalysis> {
  const hint = note?.trim() ? `\nThe person logging it says: "${note.trim().slice(0, 300)}".` : "";
  return parseAnalysis(await reader({ prompt: `Analyze this photo for a food log.${hint}\n\n${SCHEMA}\n\n${SCORE}`, image: { data, mediaType } }));
}

export async function analyzeText(text: string): Promise<FoodAnalysis> {
  return parseAnalysis(await reader({ prompt: `Meal: ${text.trim().slice(0, 600)}\n\nEstimate this meal for a food log. Use "kind": "meal".\n\n${SCHEMA}\n\n${SCORE}` }));
}

/** A second pass with the student's correction, and the photo again when there was one. */
export async function reviseAnalysis(current: FoodAnalysis, correction: string, image?: { data: Uint8Array; mediaType: string }): Promise<FoodAnalysis> {
  const n = current.per;
  const prompt = `A previous nutrition analysis was wrong. Revise it using the person's correction${image ? " and what the photo shows" : ""}.

Current analysis, per one serving:
- name: ${current.name}
- servingDescription: ${current.serving}
- servings: ${current.servings}
- calories: ${Math.round(n.calories)} kcal; protein ${Math.round(n.protein)} g, carbs ${Math.round(n.carbs)} g, fat ${Math.round(n.fat)} g, fiber ${Math.round(n.fiber ?? 0)} g, sugar ${Math.round(n.sugar ?? 0)} g, sodium ${Math.round(n.sodium ?? 0)} mg
- ingredients: ${current.ingredients.join(", ") || "none listed"}

Correction: ${correction.trim().slice(0, 500)}

Apply the correction. Keep a realistic food name and conservative calories, and return the full updated JSON.

${SCHEMA}

${SCORE}`;
  const revised = parseAnalysis(await reader({ prompt, image }));
  return { ...revised, kind: current.kind === "label" && revised.kind === "meal" ? "label" : revised.kind, barcode: revised.barcode ?? current.barcode };
}
