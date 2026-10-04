import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ACTIVITIES, addDays, dayKey, defaultProfile, isDay, MAX_PACE_KG, suggestedMeal } from "./nutrition";
import { isStudioSlug } from "./f45";
import {
  MEALS,
  type CustomGoals,
  type Effort,
  type ExerciseEntry,
  type ExerciseKind,
  type FoodEntry,
  type FoodSource,
  type HealthLog,
  type HealthState,
  type Nutrition,
  type Profile,
  type WeightEntry,
} from "./types";

/**
 * The Health record, on the host under ~/.slates/health.
 *
 * On the server rather than in browser storage so a meal logged on the phone
 * at the gym is on the Mac that evening: both are windows onto the same host.
 * One profile, one log, and the meal photos beside them. Everything that
 * arrives is checked field by field, since it comes from a request body.
 */

const dir = () => path.join(os.homedir(), ".slates", "health");
const profileFile = () => path.join(dir(), "profile.json");
const logFile = () => path.join(dir(), "log.json");
const photosDir = () => path.join(dir(), "photos");

async function writeAtomic(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await fs.rename(temporary, file);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

let queue: Promise<unknown> = Promise.resolve();

/** Changes run one after another: a phone and a Mac logging at once must not drop each other's write. */
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work);
  queue = next.catch(() => {});
  return next;
}

const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;

/* ── checking what arrives ─────────────────────────────────────────────── */

type Raw = Record<string, unknown>;

const isObject = (value: unknown): value is Raw => !!value && typeof value === "object" && !Array.isArray(value);

function number(value: unknown, min: number, max: number): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function oneOf<T extends string>(value: unknown, options: readonly T[]): T | undefined {
  return options.includes(value as T) ? (value as T) : undefined;
}

export const isPhotoId = (id: unknown): id is string => typeof id === "string" && /^p[a-z0-9]{10,40}$/.test(id);

function nutrition(raw: unknown): Nutrition {
  const n = isObject(raw) ? raw : {};
  const out: Nutrition = {
    calories: number(n.calories, 0, 10_000) ?? 0,
    protein: number(n.protein, 0, 1000) ?? 0,
    carbs: number(n.carbs, 0, 1500) ?? 0,
    fat: number(n.fat, 0, 1000) ?? 0,
  };
  const fiber = number(n.fiber, 0, 300);
  const sugar = number(n.sugar, 0, 1000);
  const sodium = number(n.sodium, 0, 50_000);
  if (fiber !== undefined) out.fiber = fiber;
  if (sugar !== undefined) out.sugar = sugar;
  if (sodium !== undefined) out.sodium = sodium;
  return out;
}

const SOURCES: FoodSource[] = ["photo", "describe", "search", "barcode", "manual"];
const KINDS: ExerciseKind[] = ["f45", "run", "lift", "walk", "cycle", "other"];
const EFFORTS: Effort[] = ["easy", "steady", "hard"];

function food(raw: Raw, base?: FoodEntry): FoodEntry {
  const day = isDay(raw.day) ? raw.day : (base?.day ?? dayKey());
  const name = text(raw.name, 120) ?? base?.name;
  if (!name) throw new Error("A food needs a name.");
  const entry: FoodEntry = {
    id: base?.id ?? newId("f"),
    day,
    at: number(raw.at, 0, 8.64e15) ?? base?.at ?? Date.now(),
    meal: oneOf(raw.meal, MEALS) ?? base?.meal ?? suggestedMeal(),
    name,
    serving: text(raw.serving, 80) ?? base?.serving ?? "1 serving",
    servings: number(raw.servings, 0.05, 50) ?? base?.servings ?? 1,
    per: "per" in raw ? nutrition(raw.per) : (base?.per ?? nutrition({})),
    source: oneOf(raw.source, SOURCES) ?? base?.source ?? "manual",
  };
  const score = "healthScore" in raw ? number(raw.healthScore, 1, 10) : base?.healthScore;
  if (score !== undefined) entry.healthScore = Math.round(score);
  const ingredients = Array.isArray(raw.ingredients)
    ? raw.ingredients.map((i) => text(i, 40)).filter((i): i is string => !!i).slice(0, 12)
    : base?.ingredients;
  if (ingredients?.length) entry.ingredients = ingredients;
  const photo = "photo" in raw ? raw.photo : base?.photo;
  if (isPhotoId(photo)) entry.photo = photo;
  const confidence = "confidence" in raw ? number(raw.confidence, 0, 1) : base?.confidence;
  if (confidence !== undefined) entry.confidence = confidence;
  const brand = "brand" in raw ? text(raw.brand, 60) : base?.brand;
  if (brand) entry.brand = brand;
  const barcode = "barcode" in raw ? (typeof raw.barcode === "string" ? raw.barcode.replace(/\D/g, "") : "") : base?.barcode;
  if (barcode && barcode.length >= 8 && barcode.length <= 14) entry.barcode = barcode;
  return entry;
}

function exercise(raw: Raw, base?: ExerciseEntry): ExerciseEntry {
  const kind = oneOf(raw.kind, KINDS) ?? base?.kind ?? "other";
  const entry: ExerciseEntry = {
    id: base?.id ?? newId("e"),
    day: isDay(raw.day) ? raw.day : (base?.day ?? dayKey()),
    at: number(raw.at, 0, 8.64e15) ?? base?.at ?? Date.now(),
    kind,
    name: text(raw.name, 80) ?? base?.name ?? "Workout",
    minutes: Math.round(number(raw.minutes, 1, 600) ?? base?.minutes ?? 45),
    calories: Math.round(number(raw.calories, 0, 5000) ?? base?.calories ?? 0),
  };
  const effort = "effort" in raw ? oneOf(raw.effort, EFFORTS) : base?.effort;
  if (effort) entry.effort = effort;
  const heartRate = "heartRate" in raw ? number(raw.heartRate, 40, 230) : base?.heartRate;
  if (heartRate !== undefined) entry.heartRate = Math.round(heartRate);
  const measured = "measured" in raw ? raw.measured === true : base?.measured;
  if (measured) entry.measured = true;
  const f45 = isObject(raw.f45) ? raw.f45 : base?.f45;
  if (kind === "f45" && f45) {
    const workout = text(f45.workout, 60);
    if (workout) {
      entry.f45 = { workout, type: text(f45.type, 20) ?? "", studio: isStudioSlug(f45.studio) ? f45.studio : "cupertino" };
      const classId = number(f45.classId, 1, 1e12);
      if (classId !== undefined) entry.f45.classId = Math.round(classId);
      if (typeof f45.time === "string" && /^\d{2}:\d{2}$/.test(f45.time)) entry.f45.time = f45.time;
      const coach = text(f45.coach, 60);
      if (coach) entry.f45.coach = coach;
    }
  }
  return entry;
}

function weight(raw: Raw, base?: WeightEntry): WeightEntry {
  const kg = number(raw.kg, 25, 400) ?? base?.kg;
  if (kg === undefined) throw new Error("A weigh-in needs a weight.");
  return {
    id: base?.id ?? newId("w"),
    day: isDay(raw.day) ? raw.day : (base?.day ?? dayKey()),
    at: number(raw.at, 0, 8.64e15) ?? base?.at ?? Date.now(),
    kg: Math.round(kg * 100) / 100,
  };
}

function customGoals(raw: unknown): CustomGoals | null | undefined {
  if (raw === null) return null;
  if (!isObject(raw)) return undefined;
  const calories = number(raw.calories, 800, 8000);
  const protein = number(raw.protein, 0, 500);
  const carbs = number(raw.carbs, 0, 1200);
  const fat = number(raw.fat, 0, 400);
  if ([calories, protein, carbs, fat].some((v) => v === undefined)) return undefined;
  return { calories: Math.round(calories!), protein: Math.round(protein!), carbs: Math.round(carbs!), fat: Math.round(fat!) };
}

/** The fields of a profile change that check out; the rest are ignored. */
export function profilePatch(raw: unknown): Partial<Profile> {
  if (!isObject(raw)) return {};
  const out: Partial<Profile> = {};
  if (typeof raw.setUp === "boolean") out.setUp = raw.setUp;
  const sex = oneOf(raw.sex, ["male", "female"] as const);
  if (sex) out.sex = sex;
  if (isDay(raw.birthDate) && raw.birthDate > "1900-01-01" && raw.birthDate < dayKey()) out.birthDate = raw.birthDate;
  const heightCm = number(raw.heightCm, 100, 250);
  if (heightCm !== undefined) out.heightCm = Math.round(heightCm * 10) / 10;
  for (const key of ["startWeightKg", "weightKg", "targetWeightKg"] as const) {
    const kg = number(raw[key], 25, 400);
    if (kg !== undefined) out[key] = Math.round(kg * 100) / 100;
  }
  const activity = oneOf(raw.activity, ACTIVITIES);
  if (activity) out.activity = activity;
  const goal = oneOf(raw.goal, ["lose", "maintain", "gain"] as const);
  if (goal) out.goal = goal;
  const pace = number(raw.paceKg, 0, MAX_PACE_KG);
  if (pace !== undefined) out.paceKg = pace;
  const diet = oneOf(raw.diet, ["classic", "pescatarian", "vegetarian", "vegan"] as const);
  if (diet) out.diet = diet;
  const units = oneOf(raw.units, ["imperial", "metric"] as const);
  if (units) out.units = units;
  const custom = customGoals(raw.custom);
  if (custom !== undefined) out.custom = custom;
  const limits = { fiberG: [5, 150], sugarG: [5, 400], sodiumMg: [500, 10_000], waterMl: [250, 8000], glassMl: [50, 2000] } as const;
  for (const [key, [min, max]] of Object.entries(limits) as [keyof typeof limits, readonly [number, number]][]) {
    const value = number(raw[key], min, max);
    if (value !== undefined) out[key] = Math.round(value);
  }
  if (typeof raw.addBurned === "boolean") out.addBurned = raw.addBurned;
  if (typeof raw.rollover === "boolean") out.rollover = raw.rollover;
  if (isStudioSlug(raw.studio)) out.studio = raw.studio;
  return out;
}

/* ── reading and writing ───────────────────────────────────────────────── */

export async function getProfile(): Promise<Profile> {
  const saved = await readJson<Partial<Profile>>(profileFile());
  return { ...defaultProfile(), ...(saved ?? {}) };
}

export async function getLog(): Promise<HealthLog> {
  const saved = await readJson<Partial<HealthLog>>(logFile());
  return { foods: saved?.foods ?? [], exercises: saved?.exercises ?? [], weights: saved?.weights ?? [], water: saved?.water ?? {} };
}

/** How far back a device is sent: enough for any chart the room draws, without the whole history. */
export const WINDOW_DAYS = 400;

export function windowed(log: HealthLog, today = dayKey()): HealthLog {
  const since = addDays(today, -WINDOW_DAYS);
  return {
    foods: log.foods.filter((f) => f.day >= since),
    exercises: log.exercises.filter((e) => e.day >= since),
    weights: log.weights,
    water: Object.fromEntries(Object.entries(log.water).filter(([day]) => day >= since)),
  };
}

export async function getState(): Promise<HealthState> {
  const [profile, log] = await Promise.all([getProfile(), getLog()]);
  return { profile, log: windowed(log) };
}

export function updateProfile(raw: unknown): Promise<Profile> {
  return serial(async () => {
    const next: Profile = { ...(await getProfile()), ...profilePatch(raw), updatedAt: Date.now() };
    await writeAtomic(profileFile(), next);
    return next;
  });
}

const byTime = <T extends { day: string; at: number }>(a: T, b: T) => a.day.localeCompare(b.day) || a.at - b.at;

export type LogKind = "food" | "exercise" | "weight";

/**
 * One change to the log, as a device sends it:
 * `{ op: "add" | "update" | "remove", kind, entry | id + patch | id }`, or
 * `{ op: "water", day, ml }` to set a day's total. Returns the whole record.
 */
export function changeLog(raw: unknown): Promise<HealthState> {
  return serial(async () => {
    if (!isObject(raw)) throw new Error("Nothing to change.");
    const [log, profile] = await Promise.all([getLog(), getProfile()]);
    const kind = oneOf(raw.kind, ["food", "exercise", "weight"] as const);
    let removedPhoto: string | undefined;

    if (raw.op === "water") {
      if (!isDay(raw.day)) throw new Error("Water needs a day.");
      const ml = number(raw.ml, 0, 20_000) ?? 0;
      if (ml > 0) log.water[raw.day] = Math.round(ml);
      else delete log.water[raw.day];
    } else if (raw.op === "add" && kind && isObject(raw.entry)) {
      if (kind === "food") log.foods.push(food(raw.entry));
      if (kind === "exercise") log.exercises.push(exercise(raw.entry));
      if (kind === "weight") log.weights.push(weight(raw.entry));
    } else if ((raw.op === "update" || raw.op === "remove") && kind && typeof raw.id === "string") {
      const id = raw.id;
      const list = (kind === "food" ? log.foods : kind === "exercise" ? log.exercises : log.weights) as { id: string }[];
      const index = list.findIndex((item) => item.id === id);
      if (index < 0) throw new Error("That entry is gone; it may have been deleted on another device.");
      if (raw.op === "remove") {
        const [gone] = list.splice(index, 1);
        removedPhoto = (gone as FoodEntry).photo;
      } else {
        const patch = isObject(raw.patch) ? raw.patch : {};
        if (kind === "food") log.foods[index] = food(patch, log.foods[index]);
        if (kind === "exercise") log.exercises[index] = exercise(patch, log.exercises[index]);
        if (kind === "weight") log.weights[index] = weight(patch, log.weights[index]);
      }
    } else {
      throw new Error("Unknown change.");
    }

    log.foods.sort(byTime);
    log.exercises.sort(byTime);
    log.weights.sort(byTime);
    await writeAtomic(logFile(), log);

    // The newest weigh-in is the profile's weight, so targets follow the scale.
    let nextProfile = profile;
    const latest = log.weights.at(-1);
    if (kind === "weight" && latest && latest.kg !== profile.weightKg) {
      nextProfile = { ...profile, weightKg: latest.kg, updatedAt: Date.now() };
      await writeAtomic(profileFile(), nextProfile);
    }
    if (removedPhoto && !log.foods.some((f) => f.photo === removedPhoto)) await deletePhoto(removedPhoto);
    return { profile: nextProfile, log: windowed(log) };
  });
}

/* ── meal photos ───────────────────────────────────────────────────────── */

const PHOTO_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

export async function savePhoto(data: Uint8Array, mediaType: string): Promise<string> {
  const ext = PHOTO_TYPES[mediaType];
  if (!ext) throw new Error("Photos need to be JPEG, PNG or WebP.");
  if (data.byteLength > MAX_PHOTO_BYTES) throw new Error("That photo is too large.");
  const id = `p${Date.now().toString(36)}${randomBytes(6).toString("hex")}`;
  await fs.mkdir(photosDir(), { recursive: true });
  await fs.writeFile(path.join(photosDir(), `${id}.${ext}`), data, { mode: 0o600 });
  void prunePhotos();
  return id;
}

export async function readPhoto(id: string): Promise<{ data: Buffer; type: string } | null> {
  if (!isPhotoId(id)) return null;
  for (const [type, ext] of Object.entries(PHOTO_TYPES)) {
    try {
      return { data: await fs.readFile(path.join(photosDir(), `${id}.${ext}`)), type };
    } catch {
      /* try the next extension */
    }
  }
  return null;
}

async function deletePhoto(id: string): Promise<void> {
  if (!isPhotoId(id)) return;
  await Promise.all(Object.values(PHOTO_TYPES).map((ext) => fs.rm(path.join(photosDir(), `${id}.${ext}`), { force: true })));
}

/** Photos read but never logged: kept a day, in case the sheet is reopened, then dropped. */
async function prunePhotos(): Promise<void> {
  try {
    const [names, log] = await Promise.all([fs.readdir(photosDir()), getLog()]);
    const used = new Set(log.foods.map((f) => f.photo).filter(Boolean));
    const cutoff = Date.now() - 24 * 3600_000;
    for (const name of names) {
      const id = name.replace(/\.[a-z]+$/, "");
      if (used.has(id) || !isPhotoId(id)) continue;
      const stat = await fs.stat(path.join(photosDir(), name));
      if (stat.mtimeMs < cutoff) await fs.rm(path.join(photosDir(), name), { force: true });
    }
  } catch {
    /* nothing to prune */
  }
}
