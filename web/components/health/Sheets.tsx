"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  burnEstimate,
  eaten,
  estimateHealthScore,
  KIND_LABEL,
  roundNutrition,
  suggestedMeal,
  weightFrom,
  weightIn,
  weightUnit,
} from "@/lib/health/nutrition";
import {
  MEAL_LABEL,
  MEALS,
  type Effort,
  type ExerciseEntry,
  type ExerciseKind,
  type F45Day,
  type F45Schedule,
  type FoodAnalysis,
  type FoodEntry,
  type FoodProduct,
  type FoodSource,
  type HealthState,
  type Meal,
  type Nutrition,
} from "@/lib/health/types";
import { Icon, ICON, Spinner } from "../ui";
import s from "./health.module.css";
import { clock, dayLabel, dec, H, HIcon, num, NumberField, Segmented, Sheet, Stepper, Toggle, TypeChip, WorkoutLogo } from "./parts";
import { PhotoPicker } from "./TodayView";
import { findFoods, fixMeal, photoUrl, readMealPhoto, readMealText, stampFor, type Health } from "./useHealth";

/* ── the + menu ────────────────────────────────────────────────────────── */

export function AddMenu({
  onClose,
  onPhoto,
  onDescribe,
  onSearch,
  onManual,
  onF45,
  onExercise,
  onWeigh,
  f45,
  when,
  onBlocked,
}: {
  onClose: () => void;
  onPhoto: (file: File) => void;
  onBlocked: () => void;
  onDescribe: () => void;
  onSearch: () => void;
  onManual: () => void;
  onF45: () => void;
  onExercise: () => void;
  onWeigh: () => void;
  f45: F45Day | undefined;
  /** The day being logged, when it isn't today. */
  when: string | null;
}) {
  return (
    <Sheet title={when ? `Log for ${when}` : "Log"} onClose={onClose}>
      <div className={s.addGrid}>
        <PhotoPicker className={`${s.addTile} ${s.addTileMain}`} onFile={onPhoto} onBlocked={onBlocked}>
          <HIcon path={H.camera} size={22} />
          <b>Scan food</b>
          <small>A plate, a label or a barcode</small>
        </PhotoPicker>
        <button type="button" className={s.addTile} onClick={onDescribe}>
          <Icon path={ICON.pencil} size={19} />
          <b>Describe</b>
          <small>Type what you ate</small>
        </button>
        <button type="button" className={s.addTile} onClick={onSearch}>
          <Icon path={ICON.magnifier} size={19} />
          <b>Search</b>
          <small>Your foods and packaged ones</small>
        </button>
        <button type="button" className={s.addTile} onClick={onManual}>
          <Icon path={ICON.plus} size={19} />
          <b>Quick add</b>
          <small>Calories and macros</small>
        </button>
      </div>
      <PhotoPicker className={s.fromPhotos} camera={false} onFile={onPhoto} onBlocked={onBlocked}>
        Or choose a photo you already took
      </PhotoPicker>
      <div className={`${s.card} ${s.rows}`}>
        <button type="button" className={s.linkRow} onClick={onF45}>
          <span className={s.linkIcon}>{f45 ? <WorkoutLogo src={f45.logo} name={f45.workout} size={34} /> : <HIcon path={H.dumbbell} size={18} />}</span>
          <span className={s.linkText}>
            <b>Log an F45 class</b>
            <small>{f45 ? `${when ?? "Today"}: ${f45.workout}${f45.type ? ` · ${f45.type}` : ""}` : "With what it burned"}</small>
          </span>
          <HIcon path={H.chevronRight} size={14} />
        </button>
        <button type="button" className={s.linkRow} onClick={onExercise}>
          <span className={s.linkIcon}>
            <HIcon path={H.dumbbell} size={18} />
          </span>
          <span className={s.linkText}>
            <b>Another workout</b>
            <small>A run, weights, a walk or a ride</small>
          </span>
          <HIcon path={H.chevronRight} size={14} />
        </button>
        <button type="button" className={s.linkRow} onClick={onWeigh}>
          <span className={s.linkIcon}>
            <HIcon path={H.scale} size={18} />
          </span>
          <span className={s.linkText}>
            <b>Log weight</b>
            <small>Moves your targets with you</small>
          </span>
          <HIcon path={H.chevronRight} size={14} />
        </button>
      </div>
    </Sheet>
  );
}

/* ── food ──────────────────────────────────────────────────────────────── */

export type FoodStart = { mode: "photo"; file: File } | { mode: "describe" } | { mode: "search" } | { mode: "manual" } | { mode: "edit"; entry: FoodEntry };

interface Draft {
  name: string;
  serving: string;
  servings: number;
  per: Nutrition;
  meal: Meal;
  source: FoodSource;
  healthScore?: number;
  ingredients: string[];
  confidence?: number;
  needsCheck: boolean;
  photo?: string;
  brand?: string;
  barcode?: string;
  kind: FoodAnalysis["kind"];
}

const blank = (meal: Meal): Draft => ({
  name: "",
  serving: "1 serving",
  servings: 1,
  per: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  meal,
  source: "manual",
  ingredients: [],
  needsCheck: false,
  kind: "meal",
});

function fromAnalysis(a: FoodAnalysis, base: Draft, source: FoodSource, photo?: string): Draft {
  return {
    ...base,
    name: a.name,
    serving: a.serving,
    servings: a.servings,
    per: a.per,
    source: a.kind === "barcode" ? "barcode" : source,
    healthScore: a.healthScore,
    ingredients: a.ingredients,
    confidence: a.confidence,
    needsCheck: a.needsCheck,
    photo: photo ?? base.photo,
    brand: a.brand,
    barcode: a.barcode,
    kind: a.kind,
  };
}

function fromProduct(p: FoodProduct, base: Draft): Draft {
  return { ...base, name: p.name, serving: p.serving, per: p.per, source: p.barcode ? "barcode" : "search", healthScore: p.healthScore, brand: p.brand, barcode: p.barcode, ingredients: [], needsCheck: false, kind: "label" };
}

function fromEntry(e: FoodEntry, keepMeal?: Meal): Draft {
  return {
    name: e.name,
    serving: e.serving,
    servings: e.servings,
    per: e.per,
    meal: keepMeal ?? e.meal,
    source: e.source,
    healthScore: e.healthScore,
    ingredients: e.ingredients ?? [],
    confidence: e.confidence,
    needsCheck: false,
    photo: e.photo,
    brand: e.brand,
    barcode: e.barcode,
    kind: "meal",
  };
}

/** Distinct foods already logged, newest first: what most meals are. */
function recents(state: HealthState): FoodEntry[] {
  const seen = new Set<string>();
  const out: FoodEntry[] = [];
  for (const f of [...state.log.foods].sort((a, b) => b.at - a.at)) {
    const key = f.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
    if (out.length >= 40) break;
  }
  return out;
}

export function FoodSheet({ start, day, today, state, health, onClose }: { start: FoodStart; day: string; today: string; state: HealthState; health: Health; onClose: () => void }) {
  const editing = start.mode === "edit" ? start.entry : null;
  const meal = day === today ? suggestedMeal() : "snack";
  const [draft, setDraft] = useState<Draft>(() => (editing ? fromEntry(editing) : blank(meal)));
  const [stage, setStage] = useState<"input" | "reading" | "result" | "error">(start.mode === "describe" || start.mode === "search" ? "input" : start.mode === "photo" ? "reading" : "result");
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [fix, setFix] = useState("");
  const [fixing, setFixing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<FoodProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const started = useRef(false);
  const file = start.mode === "photo" ? start.file : null;

  // The photo shows straight away while it's read.
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const frame = requestAnimationFrame(() => setPreview(url));
    return () => {
      cancelAnimationFrame(frame);
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const runRead = useCallback(async () => {
    if (!file) return;
    try {
      const { analysis, photo } = await readMealPhoto(file);
      setDraft((d) => fromAnalysis(analysis, d, "photo", photo));
      setStage("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage("error");
    }
  }, [file]);

  const readPhoto = () => {
    setStage("reading");
    setError(null);
    void runRead();
  };

  // Read once per sheet; "Try again" reads again.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void runRead();
  }, [runRead]);

  const yours = useMemo(() => (start.mode === "search" ? recents(state) : []), [start.mode, state]);
  const yoursShown = query.trim() ? yours.filter((f) => f.name.toLowerCase().includes(query.trim().toLowerCase())) : yours.slice(0, 8);

  const q = query.trim();
  useEffect(() => {
    if (start.mode !== "search" || q.length < 2) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      findFoods(q)
        .then((found) => !cancelled && setProducts(found))
        .catch(() => !cancelled && setProducts([]))
        .finally(() => !cancelled && setSearching(false));
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q, start.mode]);
  const found = q.length >= 2 ? products : [];

  async function describe() {
    if (!text.trim()) return;
    setStage("reading");
    setError(null);
    try {
      const analysis = await readMealText(text);
      setDraft((d) => fromAnalysis(analysis, d, "describe"));
      setStage("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage("error");
    }
  }

  async function applyFix() {
    if (!fix.trim()) return;
    setFixing(true);
    try {
      const current: FoodAnalysis = { name: draft.name, serving: draft.serving, servings: draft.servings, per: draft.per, healthScore: draft.healthScore ?? 5, confidence: draft.confidence ?? 0.7, needsCheck: draft.needsCheck, ingredients: draft.ingredients, kind: draft.kind, brand: draft.brand, barcode: draft.barcode };
      const revised = await fixMeal(current, fix, draft.photo);
      setDraft((d) => fromAnalysis(revised, d, d.source));
      setFix("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFixing(false);
    }
  }

  async function save() {
    if (!draft.name.trim()) return;
    setBusy(true);
    const per = roundNutrition(draft.per);
    const body = {
      meal: draft.meal,
      name: draft.name.trim(),
      serving: draft.serving.trim() || "1 serving",
      servings: draft.servings,
      per,
      healthScore: draft.healthScore ?? estimateHealthScore(per, draft.name),
      ingredients: draft.ingredients,
      ...(draft.photo ? { photo: draft.photo } : {}),
      ...(draft.confidence !== undefined ? { confidence: draft.confidence } : {}),
      ...(draft.brand ? { brand: draft.brand } : {}),
      ...(draft.barcode ? { barcode: draft.barcode } : {}),
    };
    const ok = editing
      ? await health.updateFood(editing.id, body)
      : await health.addFood({ ...body, day, at: stampFor(day, today), source: draft.source });
    setBusy(false);
    if (ok) onClose();
  }

  async function remove() {
    if (!editing) return;
    setBusy(true);
    const ok = await health.remove("food", editing.id);
    setBusy(false);
    if (ok) onClose();
  }

  const total = eaten(draft);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const setPer = (patch: Partial<Nutrition>) => setDraft((d) => ({ ...d, per: { ...d.per, ...patch } }));
  const image = draft.photo ? photoUrl(draft.photo) : preview;
  const title = editing ? "Edit food" : start.mode === "describe" ? "Describe a meal" : start.mode === "search" ? "Search foods" : start.mode === "manual" ? "Quick add" : "Scan food";

  if (stage === "input" && start.mode === "search") {
    return (
      <Sheet title={title} onClose={onClose}>
        <label className={s.searchBox}>
          <Icon path={ICON.magnifier} size={16} />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Greek yogurt, protein bar…" enterKeyHint="search" aria-label="Search foods" />
          {searching && <Spinner size={14} />}
        </label>
        {yoursShown.length > 0 && (
          <>
            <h3 className={s.listLabel}>Your foods</h3>
            <div className={`${s.card} ${s.rows}`}>
              {yoursShown.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={s.pickRow}
                  onClick={() => {
                    setDraft(fromEntry(f, meal));
                    setStage("result");
                  }}
                >
                  <span>
                    <b>{f.name}</b>
                    <small>
                      {f.servings !== 1 ? `${dec(f.servings)} × ` : ""}
                      {f.serving}
                    </small>
                  </span>
                  <span className={s.pickCal}>{num(eaten(f).calories)}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {found.length > 0 && (
          <>
            <h3 className={s.listLabel}>Packaged foods</h3>
            <div className={`${s.card} ${s.rows}`}>
              {found.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={s.pickRow}
                  onClick={() => {
                    setDraft((d) => fromProduct(p, d));
                    setStage("result");
                  }}
                >
                  <span>
                    <b>{p.name}</b>
                    <small>
                      {p.brand && !p.name.toLowerCase().startsWith(p.brand.toLowerCase()) ? `${p.brand} · ` : ""}
                      {p.serving}
                    </small>
                  </span>
                  <span className={s.pickCal}>{num(p.per.calories)}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {q.length >= 2 && !searching && !found.length && !yoursShown.length && (
          <p className={s.note}>
            Nothing found.{" "}
            <button
              type="button"
              className={s.textBtn}
              onClick={() => {
                set({ name: q });
                setStage("result");
              }}
            >
              Add “{q}” by hand
            </button>
          </p>
        )}
      </Sheet>
    );
  }

  if (stage === "input") {
    return (
      <Sheet
        title={title}
        onClose={onClose}
        footer={
          <button type="button" className={s.primaryBtn} onClick={() => void describe()} disabled={!text.trim()}>
            Read it
          </button>
        }
      >
        <label className={s.field}>
          <span className={s.fieldLabel}>What did you eat?</span>
          <textarea
            className={s.textArea}
            autoFocus
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Chipotle chicken bowl with white rice, black beans, fajita veggies and guac"
          />
        </label>
        <p className={s.note}>Portions help: “two eggs”, “a large latte with oat milk”, “half the burrito”.</p>
      </Sheet>
    );
  }

  if (stage === "reading" || stage === "error") {
    return (
      <Sheet title={title} onClose={onClose} bare={!!image}>
        {image && (
          <div className={s.photoBanner}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image} alt="Your meal" />
            {stage === "reading" && <span className={s.scanSweep} aria-hidden />}
          </div>
        )}
        {stage === "reading" ? (
          <div className={s.reading} role="status">
            <Spinner size={16} />
            <span>{file ? "Reading your plate…" : "Working out the numbers…"}</span>
          </div>
        ) : (
          <div className={s.readError} role="alert">
            <p>{error}</p>
            <div className={s.emptyActions}>
              {file && (
                <button type="button" className={s.primaryBtn} onClick={() => void readPhoto()}>
                  Try again
                </button>
              )}
              <button
                type="button"
                className={s.secondaryBtn}
                onClick={() => {
                  setStage(file ? "result" : "input");
                  setError(null);
                }}
              >
                {file ? "Enter it myself" : "Edit the description"}
              </button>
            </div>
          </div>
        )}
        {stage === "reading" && (
          <div className={s.skeletonLines} aria-hidden>
            <span />
            <span />
            <span />
          </div>
        )}
      </Sheet>
    );
  }

  const canFix = draft.source === "photo" || draft.source === "describe" || draft.source === "barcode";
  return (
    <Sheet
      title={title}
      onClose={onClose}
      bare={!!image}
      footer={
        <>
          {editing && (
            <button type="button" className={s.dangerBtn} onClick={() => void remove()} disabled={busy} aria-label="Delete this food">
              <Icon path={ICON.trash} size={16} />
            </button>
          )}
          <button type="button" className={s.primaryBtn} onClick={() => void save()} disabled={busy || !draft.name.trim()}>
            {editing ? "Save" : `Log ${num(total.calories)} cal`}
          </button>
        </>
      }
    >
      {image && (
        <div className={s.photoBanner}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt="Your meal" />
        </div>
      )}
      {draft.needsCheck && <p className={s.checkNote}>Worth a quick check: the photo wasn’t clear, so the name or numbers may be off.</p>}
      <label className={s.field}>
        <span className={s.fieldLabel}>Food</span>
        <input className={`${s.textInput} ${s.nameInput}`} value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="What was it?" />
      </label>
      {draft.brand && <p className={s.brandLine}>{draft.brand}</p>}
      <div className={s.servingRow}>
        <label className={s.field}>
          <span className={s.fieldLabel}>Serving</span>
          <input className={s.textInput} value={draft.serving} onChange={(e) => set({ serving: e.target.value })} />
        </label>
        <div className={s.field}>
          <span className={s.fieldLabel}>Servings</span>
          <Stepper label="Servings" value={draft.servings} step={0.5} min={0.5} max={20} format={(v) => dec(v)} onChange={(servings) => set({ servings })} />
        </div>
      </div>

      <div className={`${s.card} ${s.nutritionCard}`}>
        <div className={s.totalLine}>
          <span className={s.calRingIcon}>
            <HIcon path={H.flame} size={18} />
          </span>
          <span>
            <b>{num(total.calories)}</b> calories
            {draft.servings !== 1 && <small> · {num(draft.per.calories)} a serving</small>}
          </span>
          {draft.healthScore !== undefined && <span className={s.scorePill}>{draft.healthScore}/10</span>}
        </div>
        <div className={s.fieldGrid}>
          <NumberField label="Calories" unit="cal" value={draft.per.calories} max={10000} onChange={(calories) => setPer({ calories })} />
          <NumberField label="Protein" unit="g" decimals={1} value={draft.per.protein} max={1000} onChange={(protein) => setPer({ protein })} />
          <NumberField label="Carbs" unit="g" decimals={1} value={draft.per.carbs} max={1500} onChange={(carbs) => setPer({ carbs })} />
          <NumberField label="Fat" unit="g" decimals={1} value={draft.per.fat} max={1000} onChange={(fat) => setPer({ fat })} />
        </div>
        <details className={s.more}>
          <summary>Fiber, sugar, sodium</summary>
          <div className={s.fieldGrid}>
            <NumberField label="Fiber" unit="g" decimals={1} value={draft.per.fiber ?? 0} max={300} onChange={(fiber) => setPer({ fiber })} />
            <NumberField label="Sugar" unit="g" decimals={1} value={draft.per.sugar ?? 0} max={1000} onChange={(sugar) => setPer({ sugar })} />
            <NumberField label="Sodium" unit="mg" value={draft.per.sodium ?? 0} max={50000} onChange={(sodium) => setPer({ sodium })} />
          </div>
        </details>
        <p className={s.perNote}>Numbers are for one serving.</p>
      </div>

      {draft.ingredients.length > 0 && (
        <div className={s.chips} aria-label="Ingredients">
          {draft.ingredients.map((i) => (
            <span key={i}>{i}</span>
          ))}
        </div>
      )}

      <div className={s.field}>
        <span className={s.fieldLabel}>Meal</span>
        <Segmented small label="Meal" value={draft.meal} onChange={(m: Meal) => set({ meal: m })} options={MEALS.map((m) => ({ value: m, label: MEAL_LABEL[m].replace("Snacks", "Snack") }))} />
      </div>

      {canFix && (
        <form
          className={s.fixForm}
          onSubmit={(e) => {
            e.preventDefault();
            void applyFix();
          }}
        >
          <label className={s.field}>
            <span className={s.fieldLabel}>Something off? Tell Slates</span>
            <span className={s.fixBox}>
              <input value={fix} onChange={(e) => setFix(e.target.value)} placeholder="It was a double, no cheese" enterKeyHint="send" />
              <button type="submit" disabled={!fix.trim() || fixing} aria-label="Fix it">
                {fixing ? <Spinner size={14} /> : <Icon path={ICON.arrowUp} size={15} />}
              </button>
            </span>
          </label>
          {error && <p className={s.errorText}>{error}</p>}
        </form>
      )}
    </Sheet>
  );
}

/* ── exercise ──────────────────────────────────────────────────────────── */

export type ExerciseStart = { mode: "f45"; day: string } | { mode: "other" } | { mode: "edit"; entry: ExerciseEntry };

const KINDS: ExerciseKind[] = ["run", "lift", "walk", "cycle", "other"];

function attendedClass(f45: F45Day | undefined, day: string, today: string) {
  if (!f45?.classes.length) return null;
  if (day !== today) return f45.classes[0]!;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return [...f45.classes].reverse().find((c) => c.start <= hhmm) ?? f45.classes[0]!;
}

export function ExerciseSheet({ start, day, today, state, schedule, health, onClose }: { start: ExerciseStart; day: string; today: string; state: HealthState; schedule: F45Schedule | null; health: Health; onClose: () => void }) {
  const editing = start.mode === "edit" ? start.entry : null;
  const forDay = start.mode === "f45" ? start.day : (editing?.day ?? day);
  const isF45 = start.mode === "f45" || editing?.kind === "f45";
  const f45 = schedule?.days.find((d) => d.date === forDay);
  const first = attendedClass(f45, forDay, today);
  const [classId, setClassId] = useState<number | null>(editing?.f45?.classId ?? first?.id ?? null);
  const picked = f45?.classes.find((c) => c.id === classId) ?? null;
  const [kind, setKind] = useState<ExerciseKind>(editing?.kind ?? (isF45 ? "f45" : "run"));
  const [workout, setWorkout] = useState(editing?.f45?.workout ?? f45?.workout ?? "");
  const [type, setType] = useState(editing?.f45?.type ?? f45?.type ?? "Hybrid");
  const [name, setName] = useState(editing?.name ?? "");
  const [minutes, setMinutes] = useState(editing?.minutes ?? picked?.minutes ?? (isF45 ? 45 : 30));
  const [effort, setEffort] = useState<Effort>(editing?.effort ?? "steady");
  const [measured, setMeasured] = useState(editing?.measured ?? false);
  const [heartRate, setHeartRate] = useState(editing?.heartRate ?? 0);
  const estimate = burnEstimate({ kind, type, minutes, kg: state.profile.weightKg, effort });
  const [calories, setCalories] = useState(editing?.calories ?? estimate);
  const [typed, setTyped] = useState(!!editing);
  const [busy, setBusy] = useState(false);
  const shownCalories = typed || measured ? calories : estimate;

  async function save() {
    setBusy(true);
    const label = kind === "f45" ? workout.trim() || "F45" : name.trim() || KIND_LABEL[kind];
    const body: Omit<ExerciseEntry, "id"> = {
      day: forDay,
      at: editing?.at ?? stampFor(forDay, today),
      kind,
      name: label,
      minutes,
      calories: Math.round(shownCalories),
      ...(kind !== "f45" || !measured ? { effort } : {}),
      ...(heartRate ? { heartRate } : {}),
      ...(measured ? { measured: true } : {}),
      ...(kind === "f45"
        ? {
            f45: {
              workout: label,
              type,
              studio: state.profile.studio,
              ...(picked ? { classId: picked.id, time: picked.start, ...(picked.coach ? { coach: picked.coach } : {}) } : editing?.f45?.time ? { time: editing.f45.time } : {}),
            },
          }
        : {}),
    };
    const ok = editing ? await health.updateExercise(editing.id, body) : await health.addExercise(body);
    setBusy(false);
    if (ok) onClose();
  }

  async function remove() {
    if (!editing) return;
    setBusy(true);
    const ok = await health.remove("exercise", editing.id);
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Sheet
      title={kind === "f45" ? "F45 class" : editing ? "Edit workout" : "Log a workout"}
      onClose={onClose}
      footer={
        <>
          {editing && (
            <button type="button" className={s.dangerBtn} onClick={() => void remove()} disabled={busy} aria-label="Delete this workout">
              <Icon path={ICON.trash} size={16} />
            </button>
          )}
          <button type="button" className={s.primaryBtn} onClick={() => void save()} disabled={busy || (kind === "f45" && !workout.trim())}>
            {editing ? "Save" : `Log ${num(shownCalories)} cal burned`}
          </button>
        </>
      }
    >
      {kind === "f45" ? (
        <>
          <div className={s.sheetHero}>
            <WorkoutLogo src={f45?.logo ?? null} name={workout || "F45"} size={56} />
            <div>
              <span className={s.eyebrow}>
                {dayLabel(forDay, today)} · {schedule?.studio.name ?? "F45"}
              </span>
              {f45 ? (
                <h3 className={s.heroName}>
                  {workout} <TypeChip type={type} />
                </h3>
              ) : (
                <input className={`${s.textInput} ${s.nameInput}`} value={workout} onChange={(e) => setWorkout(e.target.value)} placeholder="Workout name" aria-label="Workout name" />
              )}
            </div>
          </div>
          {!f45 && (
            <div className={s.field}>
              <span className={s.fieldLabel}>Type</span>
              <Segmented label="Workout type" value={type} onChange={setType} options={["Cardio", "Resistance", "Hybrid"].map((t) => ({ value: t, label: t }))} />
            </div>
          )}
          {f45 && f45.classes.length > 0 && (
            <div className={s.field}>
              <span className={s.fieldLabel}>Which class?</span>
              <div className={s.timeChips} role="radiogroup" aria-label="Class time">
                {f45.classes.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={c.id === classId}
                    onClick={() => {
                      setClassId(c.id);
                      setMinutes(c.minutes);
                    }}
                  >
                    <b>{clock(c.start)}</b>
                    <small>{c.coach?.split(" ")[0] ?? ""}</small>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className={s.field}>
            <span className={s.fieldLabel}>Kind</span>
            <Segmented small label="Kind of workout" value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
          </div>
          <label className={s.field}>
            <span className={s.fieldLabel}>Name</span>
            <input className={s.textInput} value={name} onChange={(e) => setName(e.target.value)} placeholder={KIND_LABEL[kind]} />
          </label>
          <div className={s.field}>
            <span className={s.fieldLabel}>Minutes</span>
            <Stepper label="Minutes" value={minutes} step={5} min={5} max={300} format={(v) => `${v} min`} onChange={setMinutes} />
          </div>
        </>
      )}

      <Toggle
        checked={measured}
        onChange={(on) => {
          setMeasured(on);
          if (on && !typed) setCalories(estimate);
        }}
        label={kind === "f45" ? "I have my LionHeart number" : "I have a number from my watch"}
        detail={measured ? "Type what it showed below." : `Slates estimates ${num(estimate)} cal from your weight and the ${kind === "f45" ? `${type.toLowerCase()} class` : "workout"}.`}
      />

      {!measured && (
        <div className={s.field}>
          <span className={s.fieldLabel}>How hard?</span>
          <Segmented
            label="Effort"
            value={effort}
            onChange={(e: Effort) => {
              setEffort(e);
              setTyped(false);
            }}
            options={[
              { value: "easy", label: "Easy" },
              { value: "steady", label: "Solid" },
              { value: "hard", label: "All out" },
            ]}
          />
        </div>
      )}

      <div className={s.fieldGrid}>
        <NumberField
          big
          label={measured ? "Calories burned" : "Calories (estimate)"}
          unit="cal"
          value={Math.round(shownCalories)}
          max={5000}
          onChange={(v) => {
            setCalories(v);
            setTyped(true);
          }}
        />
        <NumberField label="Avg heart rate" unit="bpm" optional value={heartRate} max={230} onChange={setHeartRate} />
      </div>
    </Sheet>
  );
}

/* ── weight ────────────────────────────────────────────────────────────── */

export function WeightSheet({ state, today, health, onClose }: { state: HealthState; today: string; health: Health; onClose: () => void }) {
  const units = state.profile.units;
  const unit = weightUnit(units);
  const [value, setValue] = useState(weightIn(state.profile.weightKg, units));
  const [day, setDay] = useState(today);
  const [busy, setBusy] = useState(false);
  const recent = [...state.log.weights].sort((a, b) => b.day.localeCompare(a.day) || b.at - a.at).slice(0, 5);

  async function save() {
    setBusy(true);
    const ok = await health.addWeight({ day, at: stampFor(day, today), kg: weightFrom(value, units) });
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Sheet
      title="Log weight"
      onClose={onClose}
      footer={
        <button type="button" className={s.primaryBtn} onClick={() => void save()} disabled={busy || value <= 0}>
          Save {dec(value)} {unit}
        </button>
      }
    >
      <div className={s.weighIn}>
        <Stepper label="Weight" value={value} step={units === "imperial" ? 0.2 : 0.1} min={20} max={900} format={(v) => `${dec(v)} ${unit}`} onChange={(v) => setValue(Math.round(v * 10) / 10)} />
      </div>
      <div className={s.fieldGrid}>
        <NumberField label="Weight" unit={unit} decimals={1} value={value} min={20} max={900} onChange={setValue} />
        <label className={s.field}>
          <span className={s.fieldLabel}>Day</span>
          <input className={s.textInput} type="date" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} />
        </label>
      </div>
      {recent.length > 0 && (
        <>
          <h3 className={s.listLabel}>Recent</h3>
          <div className={`${s.card} ${s.rows}`}>
            {recent.map((w) => (
              <div key={w.id} className={s.pickRow}>
                <span>
                  <b>
                    {dec(weightIn(w.kg, units))} {unit}
                  </b>
                  <small>{dayLabel(w.day, today)}</small>
                </span>
                <button type="button" className={s.iconBtn} onClick={() => void health.remove("weight", w.id)} aria-label={`Delete the ${dayLabel(w.day, today)} weigh-in`}>
                  <Icon path={ICON.trash} size={15} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}
