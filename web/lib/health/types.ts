/**
 * Shapes shared by the Health room and the host's record of it.
 *
 * Everything is stored metric (kg, cm, ml) and converted where it's shown, the
 * way CalAi did it. Days are the phone's or Mac's own calendar day as
 * "YYYY-MM-DD", picked on the device that logged the entry, so a meal eaten at
 * 11pm stays on that day whatever the host's clock says.
 */

export type Sex = "male" | "female";
export type Activity = "sedentary" | "light" | "moderate" | "active" | "veryActive";
export type Goal = "lose" | "maintain" | "gain";
export type Units = "imperial" | "metric";
export type Diet = "classic" | "pescatarian" | "vegetarian" | "vegan";
export type Meal = "breakfast" | "lunch" | "dinner" | "snack";
export type FoodSource = "photo" | "describe" | "search" | "barcode" | "manual";
export type ExerciseKind = "f45" | "run" | "lift" | "walk" | "cycle" | "other";
export type Effort = "easy" | "steady" | "hard";

/** Calories in kcal, macros in grams, sodium in milligrams. */
export interface Nutrition {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
}

/** Targets the student set by hand, used as they are until reset. */
export interface CustomGoals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface Profile {
  /** False until the first-run setup is finished. */
  setUp: boolean;
  sex: Sex;
  birthDate: string;
  heightCm: number;
  startWeightKg: number;
  /** The latest weigh-in, kept here so targets don't need the whole log. */
  weightKg: number;
  targetWeightKg: number;
  activity: Activity;
  goal: Goal;
  /** Weekly change asked for, in kg. */
  paceKg: number;
  diet: Diet;
  units: Units;
  custom: CustomGoals | null;
  fiberG: number;
  sugarG: number;
  sodiumMg: number;
  waterMl: number;
  glassMl: number;
  /** Count exercise back toward the day's calories (off: activity level already covers it). */
  addBurned: boolean;
  /** Carry up to 200 unused calories into the next day. */
  rollover: boolean;
  /** The F45 studio's page slug, f45training.com/studio/<slug>/. */
  studio: string;
  updatedAt: number;
}

export interface FoodEntry {
  id: string;
  day: string;
  at: number;
  meal: Meal;
  name: string;
  /** One serving, as read or described: "1 bowl (~350 g)". */
  serving: string;
  servings: number;
  /** Nutrition for one serving; what was eaten is this times `servings`. */
  per: Nutrition;
  healthScore?: number;
  ingredients?: string[];
  photo?: string;
  source: FoodSource;
  confidence?: number;
  brand?: string;
  barcode?: string;
}

export interface F45Attendance {
  workout: string;
  type: string;
  studio: string;
  classId?: number;
  time?: string;
  coach?: string;
}

export interface ExerciseEntry {
  id: string;
  day: string;
  at: number;
  kind: ExerciseKind;
  name: string;
  minutes: number;
  calories: number;
  effort?: Effort;
  /** Average heart rate, when a monitor gave one. */
  heartRate?: number;
  /** Calories came off a heart-rate monitor (LionHeart), not the estimate. */
  measured?: boolean;
  f45?: F45Attendance;
}

export interface WeightEntry {
  id: string;
  day: string;
  at: number;
  kg: number;
}

export interface HealthLog {
  foods: FoodEntry[];
  exercises: ExerciseEntry[];
  weights: WeightEntry[];
  /** Millilitres drunk, by day. */
  water: Record<string, number>;
}

export interface HealthState {
  profile: Profile;
  log: HealthLog;
}

/** What the vision model (or a typed description) made of a meal, per serving. */
export interface FoodAnalysis {
  name: string;
  serving: string;
  /** How many of that serving were shown or described: three cookies, one plate. */
  servings: number;
  per: Nutrition;
  healthScore: number;
  confidence: number;
  /** Worth a second look before trusting: a blurry photo, a corrected name, odd numbers. */
  needsCheck: boolean;
  ingredients: string[];
  /** What the photo showed: a plate, a nutrition label, or a barcode. */
  kind: "meal" | "label" | "barcode";
  brand?: string;
  barcode?: string;
}

/** A packaged food from Open Food Facts. */
export interface FoodProduct {
  id: string;
  name: string;
  brand?: string;
  serving: string;
  per: Nutrition;
  healthScore?: number;
  image?: string;
  barcode?: string;
}

export interface F45Studio {
  id: number;
  slug: string;
  name: string;
  address: string;
  timezone: string;
  url: string;
}

export interface F45Class {
  id: number;
  /** Usually the day's workout; a studio can run something else in the slot (HYROX skills). */
  name: string;
  /** Studio-local wall time, "06:00". */
  start: string;
  end: string;
  minutes: number;
  coach: string | null;
  assistants: string[];
  size: number;
  booked: number;
  status: string;
}

export interface F45Day {
  date: string;
  workout: string;
  type: string;
  logo: string | null;
  description: string;
  classes: F45Class[];
}

export interface F45Schedule {
  studio: F45Studio;
  /** The studio's own date, in its timezone. */
  today: string;
  days: F45Day[];
  fetchedAt: number;
  /** F45 couldn't be reached; this is the last copy that came back. */
  stale?: boolean;
}

export const MEALS: Meal[] = ["breakfast", "lunch", "dinner", "snack"];

export const MEAL_LABEL: Record<Meal, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snacks",
};
