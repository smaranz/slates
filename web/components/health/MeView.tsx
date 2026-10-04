"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useMode } from "@/lib/mode";
import {
  ACTIVITIES,
  ACTIVITY,
  cmToFeetInches,
  dailyGoals,
  DIET_LABEL,
  feetInchesToCm,
  GOAL_LABEL,
  PACES_KG,
  recommendedGoals,
  waterIn,
  waterUnit,
  weightFrom,
  weightIn,
  weightUnit,
} from "@/lib/health/nutrition";
import type { Activity, Diet, F45Studio, Goal, Profile, Units } from "@/lib/health/types";
import { Icon, ICON } from "../ui";
import s from "./health.module.css";
import { dec, H, HIcon, num, NumberField, Segmented, Toggle } from "./parts";
import type { Health } from "./useHealth";

/** The profile behind the numbers, the goals themselves, and the room's options. */

type Patch = Partial<Profile>;

export function BodyFields({ profile, onChange, withWeight }: { profile: Profile; onChange: (patch: Patch) => void; withWeight?: boolean }) {
  const units = profile.units;
  const { feet, inches } = cmToFeetInches(profile.heightCm);
  return (
    <div className={s.fields}>
      <div className={s.field}>
        <span className={s.fieldLabel}>Sex</span>
        <Segmented label="Sex" value={profile.sex} onChange={(sex) => onChange({ sex })} options={[{ value: "male", label: "Male" }, { value: "female", label: "Female" }]} />
      </div>
      <label className={s.field}>
        <span className={s.fieldLabel}>Birthday</span>
        <input className={s.textInput} type="date" value={profile.birthDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => e.target.value && onChange({ birthDate: e.target.value })} />
      </label>
      {units === "imperial" ? (
        <div className={s.fieldRow}>
          <NumberField label="Height" unit="ft" value={feet} min={3} max={8} onChange={(ft) => onChange({ heightCm: feetInchesToCm(ft, inches) })} />
          <NumberField label="Height, inches" hideLabel unit="in" value={inches} min={0} max={11} onChange={(inch) => onChange({ heightCm: feetInchesToCm(feet, inch) })} />
        </div>
      ) : (
        <NumberField label="Height" unit="cm" value={Math.round(profile.heightCm)} min={100} max={250} onChange={(heightCm) => onChange({ heightCm })} />
      )}
      {withWeight && (
        <NumberField
          label="Weight"
          unit={weightUnit(units)}
          decimals={1}
          value={weightIn(profile.weightKg, units)}
          min={units === "imperial" ? 60 : 25}
          max={units === "imperial" ? 880 : 400}
          onChange={(v) => onChange({ weightKg: weightFrom(v, units), startWeightKg: weightFrom(v, units) })}
        />
      )}
    </div>
  );
}

export function PlanFields({ profile, onChange }: { profile: Profile; onChange: (patch: Patch) => void }) {
  const units = profile.units;
  const paceLabel = (kg: number) => (units === "imperial" ? `${{ 0.25: "½", 0.5: "1", 0.9: "2" }[kg] ?? dec(kg * 2.2)} lb` : `${kg} kg`);
  return (
    <div className={s.fields}>
      <div className={s.field}>
        <span className={s.fieldLabel}>Goal</span>
        <Segmented
          label="Goal"
          value={profile.goal}
          onChange={(goal: Goal) => onChange({ goal })}
          options={(["lose", "maintain", "gain"] as Goal[]).map((g) => ({ value: g, label: GOAL_LABEL[g].replace(" weight", "") }))}
        />
      </div>
      <NumberField
        label="Goal weight"
        unit={weightUnit(units)}
        decimals={1}
        value={weightIn(profile.targetWeightKg, units)}
        min={units === "imperial" ? 60 : 25}
        max={units === "imperial" ? 880 : 400}
        onChange={(v) => onChange({ targetWeightKg: weightFrom(v, units) })}
      />
      {profile.goal !== "maintain" && (
        <div className={s.field}>
          <span className={s.fieldLabel}>Pace, per week</span>
          <Segmented
            label="Pace"
            value={String(PACES_KG.reduce((best, kg) => (Math.abs(kg - profile.paceKg) < Math.abs(best - profile.paceKg) ? kg : best), 0.5))}
            onChange={(v) => onChange({ paceKg: Number(v) })}
            options={PACES_KG.map((kg) => ({ value: String(kg), label: paceLabel(kg) }))}
          />
        </div>
      )}
    </div>
  );
}

export function ActivityChoice({ value, onChange }: { value: Activity; onChange: (activity: Activity) => void }) {
  return (
    <div className={s.choices} role="radiogroup" aria-label="How often you train">
      {ACTIVITIES.map((a) => (
        <button key={a} type="button" role="radio" aria-checked={a === value} className={s.choice} onClick={() => onChange(a)}>
          <span>
            <b>{ACTIVITY[a].label}</b>
            <small>{ACTIVITY[a].detail}</small>
          </span>
          <i aria-hidden />
        </button>
      ))}
    </div>
  );
}

export function DietSelect({ value, onChange }: { value: Diet; onChange: (diet: Diet) => void }) {
  return (
    <label className={s.field}>
      <span className={s.fieldLabel}>Diet</span>
      <select className={s.textInput} value={value} onChange={(e) => onChange(e.target.value as Diet)}>
        {(Object.keys(DIET_LABEL) as Diet[]).map((d) => (
          <option key={d} value={d}>
            {DIET_LABEL[d]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Saves a few hundred milliseconds after the last keystroke, showing the change at once. */
function useDraft(profile: Profile, save: (patch: Patch) => Promise<boolean>) {
  const [pending, setPending] = useState<Patch>({});
  const latest = useRef<Patch>({});
  const timer = useRef<number | null>(null);
  const flush = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    const patch = latest.current;
    latest.current = {};
    if (Object.keys(patch).length) void save(patch).then(() => setPending((p) => (Object.keys(latest.current).length ? p : {})));
  }, [save]);
  useEffect(() => () => flush(), [flush]);
  const change = useCallback(
    (patch: Patch) => {
      latest.current = { ...latest.current, ...patch };
      setPending((p) => ({ ...p, ...patch }));
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 600);
    },
    [flush],
  );
  return [{ ...profile, ...pending } as Profile, change] as const;
}

export default function MeView({ health, profile, today, studio, onWeigh }: { health: Health; profile: Profile; today: string; studio: F45Studio | null; onWeigh: () => void }) {
  const { openSettings, clear } = useMode();
  const [p, change] = useDraft(profile, health.saveProfile);
  const goals = dailyGoals(p, today);
  const recommended = recommendedGoals(p, today);
  const [editing, setEditing] = useState(false);
  const [slug, setSlug] = useState(profile.studio);
  const units = p.units;
  const macroCalories = goals.protein * 4 + goals.carbs * 4 + goals.fat * 9;
  const glassOptions = units === "imperial" ? [237, 355, 473] : [250, 350, 500];

  return (
    <div className={s.stack}>
      <div className={s.meGrid}>
        <section className={`${s.card} ${s.goalsCard}`}>
          <div className={s.cardHead}>
            <h2>Daily goals</h2>
            <span className={s.badge}>{p.custom ? "Custom" : "Recommended"}</span>
          </div>
          {editing ? (
            <>
              <div className={s.fieldGrid}>
                <NumberField label="Calories" unit="cal" value={goals.calories} min={800} max={8000} onChange={(calories) => change({ custom: { ...goals, calories } })} />
                <NumberField label="Protein" unit="g" value={goals.protein} max={500} onChange={(protein) => change({ custom: { ...goals, protein } })} />
                <NumberField label="Carbs" unit="g" value={goals.carbs} max={1200} onChange={(carbs) => change({ custom: { ...goals, carbs } })} />
                <NumberField label="Fat" unit="g" value={goals.fat} max={400} onChange={(fat) => change({ custom: { ...goals, fat } })} />
              </div>
              <p className={s.note}>
                Your macros add up to {num(macroCalories)} cal{Math.abs(macroCalories - goals.calories) > 60 ? `, ${num(Math.abs(macroCalories - goals.calories))} ${macroCalories > goals.calories ? "over" : "under"} the goal` : ""}.
              </p>
            </>
          ) : (
            <div className={s.goalNumbers}>
              <span>
                <b>{num(goals.calories)}</b>
                <small>calories</small>
              </span>
              <span>
                <b style={{ color: "var(--h-protein)" }}>{num(goals.protein)}g</b>
                <small>protein</small>
              </span>
              <span>
                <b style={{ color: "var(--h-carbs)" }}>{num(goals.carbs)}g</b>
                <small>carbs</small>
              </span>
              <span>
                <b style={{ color: "var(--h-fat)" }}>{num(goals.fat)}g</b>
                <small>fat</small>
              </span>
            </div>
          )}
          <div className={s.cardActions}>
            <button type="button" className={s.secondaryBtn} onClick={() => setEditing((e) => !e)}>
              {editing ? "Done" : "Edit goals"}
            </button>
            {p.custom && (
              <button type="button" className={s.textBtn} onClick={() => change({ custom: null })}>
                Use recommended ({num(recommended.calories)})
              </button>
            )}
          </div>
        </section>

        <section className={`${s.card} ${s.formCard}`}>
          <div className={s.cardHead}>
            <h2>You</h2>
          </div>
          <div className={s.weightRow}>
            <span>
              <span className={s.fieldLabel}>Current weight</span>
              <b>
                {dec(weightIn(p.weightKg, units))} {weightUnit(units)}
              </b>
            </span>
            <button type="button" className={s.pillBtn} onClick={onWeigh}>
              <HIcon path={H.scale} size={14} /> Log weight
            </button>
          </div>
          <BodyFields profile={p} onChange={change} />
        </section>

        <section className={`${s.card} ${s.formCard}`}>
          <div className={s.cardHead}>
            <h2>Plan</h2>
          </div>
          <PlanFields profile={p} onChange={change} />
          <div className={s.field}>
            <span className={s.fieldLabel}>Training</span>
            <ActivityChoice value={p.activity} onChange={(activity) => change({ activity })} />
          </div>
          <DietSelect value={p.diet} onChange={(diet) => change({ diet })} />
        </section>

        <section className={`${s.card} ${s.formCard}`}>
          <div className={s.cardHead}>
            <h2>Water and options</h2>
          </div>
          <NumberField
            label="Water goal"
            unit={waterUnit(units)}
            value={waterIn(p.waterMl, units)}
            min={units === "imperial" ? 10 : 250}
            max={units === "imperial" ? 270 : 8000}
            onChange={(v) => change({ waterMl: units === "imperial" ? Math.round(v * 29.5735) : v })}
          />
          <div className={s.field}>
            <span className={s.fieldLabel}>A glass is</span>
            <Segmented
              label="Glass size"
              value={String(glassOptions.reduce((best, ml) => (Math.abs(ml - p.glassMl) < Math.abs(best - p.glassMl) ? ml : best), glassOptions[0]!))}
              onChange={(v) => change({ glassMl: Number(v) })}
              options={glassOptions.map((ml) => ({ value: String(ml), label: `${waterIn(ml, units)} ${waterUnit(units)}` }))}
            />
          </div>
          <div className={s.field}>
            <span className={s.fieldLabel}>Units</span>
            <Segmented
              label="Units"
              value={units}
              onChange={(next: Units) => change({ units: next, glassMl: next === "imperial" ? 237 : 250 })}
              options={[
                { value: "imperial", label: "lb, ft, oz" },
                { value: "metric", label: "kg, cm, ml" },
              ]}
            />
          </div>
          <Toggle checked={p.addBurned} onChange={(addBurned) => change({ addBurned })} label="Eat back exercise calories" detail="Off by default: your training level already counts your classes." />
          <Toggle checked={p.rollover} onChange={(rollover) => change({ rollover })} label="Roll over unused calories" detail="Up to 200 from yesterday." />
        </section>

        <section className={`${s.card} ${s.formCard}`}>
          <div className={s.cardHead}>
            <h2>F45 studio</h2>
          </div>
          <p className={s.studioLine}>
            <b>{studio?.name ?? `f45training.com/studio/${p.studio}`}</b>
            {studio?.address && <span>{studio.address}</span>}
          </p>
          <form
            className={s.inlineForm}
            onSubmit={(e) => {
              e.preventDefault();
              const next = slug.trim().toLowerCase();
              if (/^[a-z0-9][a-z0-9-]{1,60}$/.test(next) && next !== p.studio) change({ studio: next });
            }}
          >
            <label className={s.field}>
              <span className={s.fieldLabel}>Its page on f45training.com</span>
              <span className={s.prefixInput}>
                <span>studio/</span>
                <input value={slug} onChange={(e) => setSlug(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-label="Studio page name" />
              </span>
            </label>
            <button type="submit" className={s.secondaryBtn} disabled={slug.trim().toLowerCase() === p.studio}>
              Switch
            </button>
          </form>
        </section>

        <section className={`${s.card} ${s.rows} ${s.slatesRows}`}>
          <button type="button" className={s.linkRow} onClick={openSettings}>
            <Icon path={ICON.settings} size={17} /> Slates settings <HIcon path={H.chevronRight} size={14} />
          </button>
          <button type="button" className={s.linkRow} onClick={clear}>
            <Icon path={ICON.swap} size={17} /> Switch app <HIcon path={H.chevronRight} size={14} />
          </button>
        </section>
      </div>
    </div>
  );
}
