"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { dayDate, dayKey } from "@/lib/health/nutrition";
import type {
  ExerciseEntry,
  F45Schedule,
  FoodAnalysis,
  FoodEntry,
  FoodProduct,
  HealthState,
  Profile,
  WeightEntry,
} from "@/lib/health/types";

/**
 * The Health record as this device sees it.
 *
 * The host owns it; this keeps the last copy in storage so the room opens at
 * once (and still reads at the gym on a weak signal), changes it optimistically
 * so a tap lands immediately, and re-reads it whenever the window comes back,
 * since the same record is being changed from the phone and the Mac.
 */

const CACHE = "slates.health.v1";
const F45_CACHE = "slates.health.f45.v1";

function readCache<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked; the host still has it */
  }
}

async function send<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error || `Slates answered ${res.status}.`);
  return body;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** Re-reads on return to the window, and on an interval while it's in front. */
function useRevisit(load: () => void, everyMs: number) {
  useEffect(() => {
    const onShow = () => {
      if (document.visibilityState === "visible") load();
    };
    const timer = window.setInterval(onShow, everyMs);
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", onShow);
    };
  }, [load, everyMs]);
}

type NewFood = Omit<FoodEntry, "id">;
type NewExercise = Omit<ExerciseEntry, "id">;
type NewWeight = Omit<WeightEntry, "id">;
export type EntryKind = "food" | "exercise" | "weight";

/** The cached copy, when it's whole. The room mounts only after hydration, so storage is there to read. */
function cachedState(): HealthState | null {
  if (typeof window === "undefined") return null;
  const cached = readCache<HealthState>(CACHE);
  return cached?.profile && cached.log ? cached : null;
}

/** When an entry happened: now for today, midday for a day being filled in after. */
export const stampFor = (day: string, today: string) => (day === today ? Date.now() : dayDate(day).getTime());

const temp = () => `tmp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function useHealth() {
  const [state, setState] = useState<HealthState | null>(cachedState);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const latest = useRef<HealthState | null>(state);
  const pending = useRef(0);

  const accept = useCallback((next: HealthState) => {
    latest.current = next;
    setState(next);
    writeCache(CACHE, next);
  }, []);

  const refresh = useCallback(async () => {
    // A read that lands mid-change would undo the optimistic copy; the change's own answer follows.
    if (pending.current) return;
    try {
      const next = await send<HealthState>("/api/health");
      if (!pending.current) accept(next);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, [accept]);

  useEffect(() => {
    const first = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(first);
  }, [refresh]);

  useRevisit(refresh, 120_000);

  /** Shows the change at once, sends it, and puts things back if the host refuses. */
  const change = useCallback(
    async (body: Record<string, unknown>, optimistic: (s: HealthState) => HealthState) => {
      const before = latest.current;
      if (before) {
        const guess = optimistic(before);
        latest.current = guess;
        setState(guess);
      }
      pending.current += 1;
      try {
        const next = await send<HealthState>("/api/health/log", json("POST", body));
        pending.current -= 1;
        accept(next);
        return true;
      } catch (error) {
        pending.current -= 1;
        if (before) {
          latest.current = before;
          setState(before);
        }
        setNotice(error instanceof Error ? error.message : String(error));
        return false;
      }
    },
    [accept],
  );

  const addFood = useCallback(
    (entry: NewFood) => change({ op: "add", kind: "food", entry }, (s) => ({ ...s, log: { ...s.log, foods: [...s.log.foods, { ...entry, id: temp() }] } })),
    [change],
  );

  const updateFood = useCallback(
    (id: string, patch: Partial<NewFood>) =>
      change({ op: "update", kind: "food", id, patch }, (s) => ({ ...s, log: { ...s.log, foods: s.log.foods.map((f) => (f.id === id ? { ...f, ...patch } : f)) } })),
    [change],
  );

  const addExercise = useCallback(
    (entry: NewExercise) =>
      change({ op: "add", kind: "exercise", entry }, (s) => ({ ...s, log: { ...s.log, exercises: [...s.log.exercises, { ...entry, id: temp() }] } })),
    [change],
  );

  const updateExercise = useCallback(
    (id: string, patch: Partial<NewExercise>) =>
      change({ op: "update", kind: "exercise", id, patch }, (s) => ({
        ...s,
        log: { ...s.log, exercises: s.log.exercises.map((e) => (e.id === id ? { ...e, ...patch } : e)) },
      })),
    [change],
  );

  const addWeight = useCallback(
    (entry: NewWeight) =>
      change({ op: "add", kind: "weight", entry }, (s) => ({
        profile: { ...s.profile, weightKg: entry.kg },
        log: { ...s.log, weights: [...s.log.weights, { ...entry, id: temp() }] },
      })),
    [change],
  );

  const remove = useCallback(
    (kind: EntryKind, id: string) =>
      change({ op: "remove", kind, id }, (s) => ({
        ...s,
        log: {
          ...s.log,
          foods: kind === "food" ? s.log.foods.filter((f) => f.id !== id) : s.log.foods,
          exercises: kind === "exercise" ? s.log.exercises.filter((e) => e.id !== id) : s.log.exercises,
          weights: kind === "weight" ? s.log.weights.filter((w) => w.id !== id) : s.log.weights,
        },
      })),
    [change],
  );

  const setWater = useCallback(
    (day: string, ml: number) =>
      change({ op: "water", day, ml }, (s) => {
        const water = { ...s.log.water };
        if (ml > 0) water[day] = ml;
        else delete water[day];
        return { ...s, log: { ...s.log, water } };
      }),
    [change],
  );

  const saveProfile = useCallback(
    async (patch: Partial<Profile>) => {
      const before = latest.current;
      if (before) accept({ ...before, profile: { ...before.profile, ...patch } });
      pending.current += 1;
      try {
        const { profile } = await send<{ profile: Profile }>("/api/health", json("PUT", patch));
        pending.current -= 1;
        if (latest.current) accept({ ...latest.current, profile });
        return true;
      } catch (error) {
        pending.current -= 1;
        if (before) accept(before);
        setNotice(error instanceof Error ? error.message : String(error));
        return false;
      }
    },
    [accept],
  );

  return {
    state,
    loadError,
    notice,
    notify: setNotice,
    clearNotice: useCallback(() => setNotice(null), []),
    refresh,
    addFood,
    updateFood,
    addExercise,
    updateExercise,
    addWeight,
    remove,
    setWater,
    saveProfile,
  };
}

export type Health = ReturnType<typeof useHealth>;

/** The studio's schedule, refreshed every few minutes while the room is open: spots fill up. */
export function useF45(studio: string | null) {
  const [schedule, setSchedule] = useState<F45Schedule | null>(() => (typeof window === "undefined" ? null : readCache<F45Schedule>(F45_CACHE)));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!studio) return;
    try {
      const { schedule: next } = await send<{ schedule: F45Schedule }>(`/api/health/f45?studio=${encodeURIComponent(studio)}`);
      setSchedule(next);
      setError(null);
      writeCache(F45_CACHE, next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [studio]);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(first);
  }, [load]);

  useRevisit(load, 300_000);
  return { schedule: schedule?.studio?.slug === studio ? schedule : null, error, refresh: load };
}

/** Today's date, which moves on at midnight even if the room stays open. */
export function useToday(): string {
  const [today, setToday] = useState(() => dayKey());
  useEffect(() => {
    const timer = window.setInterval(() => setToday((current) => (dayKey() === current ? current : dayKey())), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return today;
}

/* ── reading meals ─────────────────────────────────────────────────────── */

/**
 * A phone photo is 3–12 MB of HEIC or JPEG; the model needs a fraction of
 * that. Redrawn at 1600 px as JPEG it's a few hundred KB, so it uploads over
 * a gym's signal in a second or two.
 */
async function shrink(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob) throw new Error("no blob");
    return blob;
  } catch {
    if (/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    throw new Error("That image couldn’t be read. Try a JPEG or PNG.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function readMealPhoto(file: File, note?: string): Promise<{ analysis: FoodAnalysis; photo: string }> {
  const form = new FormData();
  form.append("photo", await shrink(file), "meal.jpg");
  if (note?.trim()) form.append("note", note.trim());
  return send("/api/health/analyze", { method: "POST", body: form });
}

export async function readMealText(text: string): Promise<FoodAnalysis> {
  return (await send<{ analysis: FoodAnalysis }>("/api/health/analyze", json("POST", { text }))).analysis;
}

export async function fixMeal(current: FoodAnalysis, fix: string, photo?: string): Promise<FoodAnalysis> {
  return (await send<{ analysis: FoodAnalysis }>("/api/health/analyze", json("POST", { fix, current, photo }))).analysis;
}

export async function findFoods(query: string): Promise<FoodProduct[]> {
  return (await send<{ products: FoodProduct[] }>(`/api/health/foods?q=${encodeURIComponent(query)}`)).products;
}

export const photoUrl = (id: string) => `/api/health/photo?id=${encodeURIComponent(id)}`;

/**
 * Whether a photo input may offer the camera here. iOS ends an app on the spot
 * when it asks for the camera without a camera usage string, WebKit offers
 * "Take Photo" on any image input regardless, and iPhone builds of Slates from
 * before Health have no such string. Builds that do add "SlatesCamera" to the
 * user agent (mobile/capacitor.config.ts); browsers bring their own.
 */
export function cameraSafe(): boolean {
  if (typeof navigator === "undefined") return true;
  const ua = navigator.userAgent;
  return !(/SlatesApp/.test(ua) && /iPhone|iPad|iPod/.test(ua)) || /SlatesCamera/.test(ua);
}

export const CAMERA_BLOCKED = "Scanning needs the updated Slates app on this iPhone. Plug the phone into the Mac to reinstall it; until then, describe or search the meal.";
