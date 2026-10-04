import type {
  Activity,
  CustomGoals,
  Diet,
  Effort,
  ExerciseKind,
  FoodEntry,
  Goal,
  HealthState,
  Meal,
  Nutrition,
  Profile,
  Sex,
  Units,
} from "./types";

/**
 * The arithmetic behind the Health room: calorie and macro targets from a
 * profile, a day's totals, scores and streaks, and what a class burns.
 *
 * Ported from CalAi's NutritionCalculator, DayStats and DiaryMath (Mifflin–St
 * Jeor, ~7,700 kcal per kg, sex-specific floors, a protein floor for people
 * who train), so the phone app and Slates give the same numbers. Pure: the
 * room and the host both import it.
 */

/* ── units ─────────────────────────────────────────────────────────────── */

export const LB_PER_KG = 2.2046226218;
export const ML_PER_OZ = 29.5735295625;

export const kgToLb = (kg: number) => kg * LB_PER_KG;
export const lbToKg = (lb: number) => lb / LB_PER_KG;
export const mlToOz = (ml: number) => ml / ML_PER_OZ;
export const ozToMl = (oz: number) => oz * ML_PER_OZ;

/** A weight in the student's units, to one decimal. */
export function weightIn(kg: number, units: Units): number {
  return Math.round((units === "imperial" ? kgToLb(kg) : kg) * 10) / 10;
}

export function weightFrom(value: number, units: Units): number {
  return units === "imperial" ? lbToKg(value) : value;
}

export const weightUnit = (units: Units) => (units === "imperial" ? "lb" : "kg");

export function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const total = Math.round(cm / 2.54);
  return { feet: Math.floor(total / 12), inches: total % 12 };
}

export const feetInchesToCm = (feet: number, inches: number) => (feet * 12 + inches) * 2.54;

export function waterIn(ml: number, units: Units): number {
  return units === "imperial" ? Math.round(mlToOz(ml)) : Math.round(ml);
}

export const waterUnit = (units: Units) => (units === "imperial" ? "oz" : "ml");

/* ── days ──────────────────────────────────────────────────────────────── */

const pad = (n: number) => String(n).padStart(2, "0");

/** The local calendar day of a moment, "YYYY-MM-DD". */
export function dayKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Noon on the day, so adding days never trips over a DST change. */
export function dayDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1, 12);
}

export function addDays(day: string, n: number): string {
  const date = dayDate(day);
  date.setDate(date.getDate() + n);
  return dayKey(date);
}

/** Whole days from `a` to `b`. */
export function daysBetween(a: string, b: string): number {
  return Math.round((dayDate(b).getTime() - dayDate(a).getTime()) / 86_400_000);
}

/** The Sunday that starts the week holding `day`. */
export function weekStart(day: string): string {
  return addDays(day, -dayDate(day).getDay());
}

export const isDay = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(dayDate(value).getTime());

export function ageOn(birthDate: string, today: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  if (!by || !ty) return 30;
  let age = ty - by;
  if ((tm ?? 0) < (bm ?? 0) || ((tm ?? 0) === (bm ?? 0) && (td ?? 0) < (bd ?? 0))) age -= 1;
  return Math.max(13, Math.min(100, age));
}

/** Breakfast before 11, lunch to 4, dinner to 10, otherwise a snack. */
export function suggestedMeal(hour: number = new Date().getHours()): Meal {
  if (hour >= 4 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 16) return "lunch";
  if (hour >= 16 && hour < 22) return "dinner";
  return "snack";
}

/* ── the profile ───────────────────────────────────────────────────────── */

export const ACTIVITY: Record<Activity, { label: string; detail: string; factor: number }> = {
  sedentary: { label: "Mostly sitting", detail: "Little or no exercise", factor: 1.2 },
  light: { label: "1–2 workouts a week", detail: "Light exercise", factor: 1.375 },
  moderate: { label: "3–4 workouts a week", detail: "Regular training", factor: 1.55 },
  active: { label: "5–6 workouts a week", detail: "F45 most days", factor: 1.725 },
  veryActive: { label: "Twice a day", detail: "Or a physical job on top", factor: 1.9 },
};

export const ACTIVITIES: Activity[] = ["sedentary", "light", "moderate", "active", "veryActive"];

export const GOAL_LABEL: Record<Goal, string> = { lose: "Lose weight", maintain: "Maintain", gain: "Gain weight" };

export const DIET_LABEL: Record<Diet, string> = {
  classic: "No restrictions",
  pescatarian: "Pescatarian",
  vegetarian: "Vegetarian",
  vegan: "Vegan",
};

/** Weekly paces on offer, kg: about ½, 1 and 2 lb. Two pounds a week is the ceiling. */
export const PACES_KG = [0.25, 0.5, 0.9] as const;
export const MAX_PACE_KG = 0.9;

export function defaultProfile(): Profile {
  return {
    setUp: false,
    sex: "male",
    birthDate: "2009-01-01",
    heightCm: 175,
    startWeightKg: 70,
    weightKg: 70,
    targetWeightKg: 70,
    activity: "active",
    goal: "maintain",
    paceKg: 0.5,
    diet: "classic",
    units: "imperial",
    custom: null,
    fiberG: 38,
    sugarG: 96,
    sodiumMg: 2300,
    waterMl: 2500,
    glassMl: 237,
    addBurned: false,
    rollover: false,
    studio: "cupertino",
    updatedAt: 0,
  };
}

/** Basal metabolic rate, Mifflin–St Jeor, kcal/day. */
export function bmr(sex: Sex, kg: number, cm: number, age: number): number {
  return 10 * kg + 6.25 * cm - 5 * age + (sex === "male" ? 5 : -161);
}

export function tdee(profile: Profile, today: string): number {
  return bmr(profile.sex, profile.weightKg, profile.heightCm, ageOn(profile.birthDate, today)) * ACTIVITY[profile.activity].factor;
}

/** The stated goal, unless the target weight plainly contradicts it. */
export function effectiveGoal(profile: Profile): Goal {
  const gap = profile.targetWeightKg - profile.weightKg;
  if (profile.goal === "lose" && gap > 0.5) return "maintain";
  if (profile.goal === "gain" && gap < -0.5) return "maintain";
  return profile.goal;
}

/** Kg a week, capped at two pounds and at what's left to the target. */
export function weeklyPace(profile: Profile): number {
  if (effectiveGoal(profile) === "maintain") return 0;
  const asked = Math.min(Math.max(profile.paceKg, 0), MAX_PACE_KG);
  const left = Math.abs(profile.targetWeightKg - profile.weightKg);
  return left < 0.05 ? asked : Math.min(asked, left);
}

const floorFor = (sex: Sex) => (sex === "female" ? 1200 : 1500);

function macroSplit(diet: Diet): { protein: number; carbs: number; fat: number } {
  return diet === "vegetarian" || diet === "vegan" ? { protein: 0.25, carbs: 0.5, fat: 0.25 } : { protein: 0.25, carbs: 0.45, fat: 0.3 };
}

/** What the numbers recommend: TDEE with the pace's deficit or surplus, then macros to fit. */
export function recommendedGoals(profile: Profile, today: string): CustomGoals {
  const goal = effectiveGoal(profile);
  const perDay = (weeklyPace(profile) * 7700) / 7;
  const raw = tdee(profile, today) + (goal === "lose" ? -perDay : goal === "gain" ? perDay : 0);
  const calories = Math.round(Math.max(raw, floorFor(profile.sex)));

  const split = macroSplit(profile.diet);
  // Percent-only protein undershoots on a deficit; people who train get a floor per kg.
  const perKg = profile.activity === "active" || profile.activity === "veryActive" ? 1.6 : profile.activity !== "sedentary" || goal !== "maintain" ? 1.4 : 0.8;
  const protein = Math.min(Math.max(Math.round((calories * split.protein) / 4), Math.round(profile.weightKg * perKg)), Math.floor((calories * 0.35) / 4));
  const fat = Math.min(Math.max(Math.round((calories * split.fat) / 9), Math.ceil((calories * 0.2) / 9)), Math.floor((calories * 0.35) / 9));
  const carbs = Math.round(Math.max(0, calories - protein * 4 - fat * 9) / 4);
  return { calories, protein, carbs, fat };
}

/** The day's targets: the student's own if they set them, otherwise the recommendation. */
export function dailyGoals(profile: Profile, today: string): CustomGoals {
  return profile.custom ?? recommendedGoals(profile, today);
}

export function bmi(kg: number, cm: number): number {
  const m = cm / 100;
  return m > 0 ? kg / (m * m) : 0;
}

export function bmiBand(value: number): { label: string; tone: "info" | "good" | "warn" | "bad" } {
  if (value < 18.5) return { label: "Underweight", tone: "info" };
  if (value < 25) return { label: "Healthy", tone: "good" };
  if (value < 30) return { label: "Overweight", tone: "warn" };
  return { label: "Obese", tone: "bad" };
}

/** When the target weight lands at this pace, or null when maintaining. */
export function goalDay(profile: Profile, today: string): string | null {
  const pace = weeklyPace(profile);
  const left = Math.abs(profile.weightKg - profile.targetWeightKg);
  if (!pace || left < 0.05) return null;
  return addDays(today, Math.round((left / pace) * 7));
}

/* ── food ──────────────────────────────────────────────────────────────── */

export const ZERO: Nutrition = { calories: 0, protein: 0, carbs: 0, fat: 0 };

export function scaled(n: Nutrition, factor: number): Nutrition {
  const opt = (v: number | undefined) => (v === undefined ? undefined : v * factor);
  return {
    calories: n.calories * factor,
    protein: n.protein * factor,
    carbs: n.carbs * factor,
    fat: n.fat * factor,
    fiber: opt(n.fiber),
    sugar: opt(n.sugar),
    sodium: opt(n.sodium),
  };
}

export function sum(a: Nutrition, b: Nutrition): Nutrition {
  const opt = (x?: number, y?: number) => (x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0));
  return {
    calories: a.calories + b.calories,
    protein: a.protein + b.protein,
    carbs: a.carbs + b.carbs,
    fat: a.fat + b.fat,
    fiber: opt(a.fiber, b.fiber),
    sugar: opt(a.sugar, b.sugar),
    sodium: opt(a.sodium, b.sodium),
  };
}

/** Whole calories and milligrams, macros to a tenth of a gram. */
export function roundNutrition(n: Nutrition): Nutrition {
  const one = (v: number) => Math.round(v * 10) / 10;
  return {
    calories: Math.round(n.calories),
    protein: one(n.protein),
    carbs: one(n.carbs),
    fat: one(n.fat),
    ...(n.fiber !== undefined ? { fiber: one(n.fiber) } : {}),
    ...(n.sugar !== undefined ? { sugar: one(n.sugar) } : {}),
    ...(n.sodium !== undefined ? { sodium: Math.round(n.sodium) } : {}),
  };
}

/** What a logged entry adds up to: one serving times how many were eaten. */
export const eaten = (entry: Pick<FoodEntry, "per" | "servings">) => scaled(entry.per, entry.servings);

export const totals = (entries: FoodEntry[]) => entries.reduce((acc, entry) => sum(acc, eaten(entry)), ZERO);

const FRIED = ["fry", "fries", "fried", "tender", "nugget", "wing", "mozzarella stick", "onion ring", "breaded", "crispy", "fast food", "burger", "pizza", "hot dog", "corn dog", "chips", "nachos"];
const PROCESSED = ["processed", "frozen meal", "instant", "packaged", "candy", "soda", "donut", "pastry", "ice cream", "cookie", "cake"];
const WHOLE = ["avocado", "salad", "vegetable", "broccoli", "spinach", "kale", "oat", "quinoa", "brown rice", "whole grain", "fruit", "berry", "lentil", "bean", "salmon", "grilled fish", "egg", "yogurt", "smoothie bowl"];

/** 1–10 from macro balance and the name, for when nothing better is known. */
export function estimateHealthScore(n: Nutrition, name = ""): number {
  let score = 5;
  const cal = Math.max(n.calories, 1);
  const proteinPct = (n.protein * 4) / cal;
  const fatPct = (n.fat * 9) / cal;
  const fiberPer100 = ((n.fiber ?? 0) / cal) * 100;

  if (proteinPct >= 0.25) score += 1.5;
  else if (proteinPct >= 0.15) score += 0.75;

  if (fiberPer100 >= 2) score += 1.5;
  else if (fiberPer100 >= 1) score += 0.75;
  else if (fiberPer100 < 0.5) score -= 1;

  // High fat is fine with fiber (avocado, nuts); without it, it's usually the fryer.
  const wholeFat = fiberPer100 >= 1.5;
  if (fatPct >= 0.5 && !wholeFat) score -= 2;
  else if (fatPct >= 0.4 && !wholeFat) score -= 1.5;
  else if (fatPct >= 0.35 && !wholeFat) score -= 1;
  if (fatPct >= 0.35 && fiberPer100 < 1) score -= 1.5;

  if (n.sugar !== undefined) {
    const sugarPct = (n.sugar * 4) / cal;
    if (sugarPct <= 0.08) score += 0.5;
    else if (sugarPct > 0.25) score -= 1.5;
    else if (sugarPct > 0.15) score -= 0.75;
  }

  const lower = name.toLowerCase();
  if (FRIED.some((w) => lower.includes(w))) score -= 2;
  if (PROCESSED.some((w) => lower.includes(w))) score -= 1;
  if (WHOLE.some((w) => lower.includes(w))) score += 1;
  return Math.max(1, Math.min(10, Math.round(score)));
}

/** A model's score, pulled down only when the heuristic sees an unmistakably poor pattern. */
export function reconcileHealthScore(ai: number, heuristic: number): number {
  if (heuristic <= 2 && ai > heuristic + 1) return Math.max(1, Math.min(10, heuristic + 1));
  return Math.max(1, Math.min(10, Math.round(ai)));
}

/* ── a day ─────────────────────────────────────────────────────────────── */

export interface Amount {
  value: number;
  goal: number;
}

export interface DayStats {
  goal: number;
  eaten: number;
  burned: number;
  /** Burned calories that count toward the goal (only with addBurned). */
  burnBonus: number;
  rollover: number;
  left: number;
  protein: Amount;
  carbs: Amount;
  fat: Amount;
  fiber: Amount;
  sugar: Amount;
  sodium: Amount;
  waterMl: number;
  waterGoalMl: number;
  score: number | null;
  scoreNote: string;
}

const onDay = <T extends { day: string }>(items: T[], day: string) => items.filter((item) => item.day === day);

/** Up to 200 calories left over from the day before, when rollover is on and that day was logged. */
export function rolloverInto(state: HealthState, day: string, today: string): number {
  if (!state.profile.rollover) return 0;
  const before = onDay(state.log.foods, addDays(day, -1));
  if (!before.length) return 0;
  const goal = dailyGoals(state.profile, today).calories;
  return Math.max(0, Math.min(200, Math.round(goal - totals(before).calories)));
}

export function dayStats(state: HealthState, day: string, today: string): DayStats {
  const { profile, log } = state;
  const goals = dailyGoals(profile, today);
  const foods = onDay(log.foods, day);
  const sumUp = totals(foods);
  const burned = Math.round(onDay(log.exercises, day).reduce((acc, e) => acc + e.calories, 0));
  const burnBonus = profile.addBurned ? burned : 0;
  const rollover = rolloverInto(state, day, today);
  const eatenCal = Math.round(sumUp.calories);
  // Entries without a sodium figure count at CalAi's rough 0.45 mg per calorie.
  const sodium = Math.round(foods.reduce((acc, f) => acc + (f.per.sodium ?? f.per.calories * 0.45) * f.servings, 0));

  const amount = (value: number, goal: number): Amount => ({ value: Math.round(value), goal: Math.round(goal) });
  const stats: DayStats = {
    goal: goals.calories,
    eaten: eatenCal,
    burned,
    burnBonus,
    rollover,
    left: goals.calories + burnBonus + rollover - eatenCal,
    protein: amount(sumUp.protein, goals.protein),
    carbs: amount(sumUp.carbs, goals.carbs),
    fat: amount(sumUp.fat, goals.fat),
    fiber: amount(sumUp.fiber ?? 0, profile.fiberG),
    sugar: amount(sumUp.sugar ?? 0, profile.sugarG),
    sodium: amount(sodium, profile.sodiumMg),
    waterMl: Math.round(log.water[day] ?? 0),
    waterGoalMl: profile.waterMl,
    score: null,
    scoreNote: "Log a meal to see today's score. It weighs protein, fiber, sugar and sodium against your goals.",
  };
  if (!foods.length) return stats;

  let balance = 5;
  if (stats.protein.goal > 0) {
    const share = stats.protein.value / stats.protein.goal;
    balance += share >= 0.8 ? 2 : share >= 0.5 ? 1 : 0;
  }
  if (stats.sugar.value <= stats.sugar.goal) balance += 1;
  if (stats.sodium.value <= stats.sodium.goal) balance += 1;
  if (stats.fiber.value >= stats.fiber.goal / 2) balance += 1;
  balance = Math.max(1, Math.min(10, Math.round(balance)));

  // Each food's own score, weighted by its calories, blended with the day's balance.
  let weighted = 0;
  let weight = 0;
  for (const food of foods) {
    const n = eaten(food);
    const w = Math.max(n.calories, 50);
    weighted += (food.healthScore ?? estimateHealthScore(food.per, food.name)) * w;
    weight += w;
  }
  const quality = weight ? weighted / weight : balance;
  stats.score = Math.max(1, Math.min(10, Math.round(quality * 0.4 + balance * 0.6)));
  stats.scoreNote =
    stats.score >= 8
      ? "Protein is on track, and sugar and sodium are under your limits."
      : stats.score >= 6
        ? "A solid day. More protein and fiber would round it out."
        : "Light on protein and fiber so far. Keep an eye on sugar and sodium.";
  return stats;
}

/** Days in a row with food logged, still alive today if yesterday counted. */
export function streak(state: HealthState, today: string): number {
  const days = new Set(state.log.foods.map((f) => f.day));
  let day = days.has(today) ? today : addDays(today, -1);
  let count = 0;
  while (days.has(day)) {
    count += 1;
    day = addDays(day, -1);
  }
  return count;
}

/* ── exercise ──────────────────────────────────────────────────────────── */

/**
 * Metabolic equivalents for F45's three class types, from the Compendium of
 * Physical Activities: vigorous circuit training for cardio days, circuit-style
 * resistance work for strength days, the hybrid between them. LionHeart reads
 * heart rate and beats any estimate, so its number replaces this one.
 */
export const F45_MET: Record<string, number> = { Cardio: 8, Hybrid: 7, Resistance: 6, Recovery: 2.5 };

export const KIND_MET: Record<ExerciseKind, number> = { f45: 7, run: 9.8, lift: 5, walk: 3.5, cycle: 7.5, other: 5 };

export const KIND_LABEL: Record<ExerciseKind, string> = {
  f45: "F45 class",
  run: "Run",
  lift: "Weights",
  walk: "Walk",
  cycle: "Bike",
  other: "Workout",
};

export const EFFORT_FACTOR: Record<Effort, number> = { easy: 0.85, steady: 1, hard: 1.15 };

export function burnEstimate(input: { kind: ExerciseKind; type?: string; minutes: number; kg: number; effort?: Effort }): number {
  const met = input.kind === "f45" ? (F45_MET[input.type ?? ""] ?? KIND_MET.f45) : KIND_MET[input.kind];
  const factor = EFFORT_FACTOR[input.effort ?? "steady"];
  return Math.max(0, Math.round(met * input.kg * (input.minutes / 60) * factor));
}
