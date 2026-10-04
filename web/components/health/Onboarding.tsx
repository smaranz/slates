"use client";

import { useState } from "react";

import { useMode } from "@/lib/mode";
import { recommendedGoals, weightIn, weightUnit } from "@/lib/health/nutrition";
import type { Profile, Units } from "@/lib/health/types";
import { Icon, ICON } from "../ui";
import s from "./health.module.css";
import { ActivityChoice, BodyFields, DietSelect, PlanFields } from "./MeView";
import { dec, H, HIcon, num, NumberField, Segmented } from "./parts";
import { stampFor, type Health } from "./useHealth";

/**
 * First run: five short questions, then the plan they add up to. Defaults are
 * set for who this was built for (pounds and feet, F45 most days) so most
 * screens are a confirmation, not a form.
 */

const STEPS = ["intro", "you", "body", "goal", "training", "plan"] as const;

export default function Onboarding({ health, profile, today }: { health: Health; profile: Profile; today: string }) {
  const { clear } = useMode();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Profile>(profile);
  const [saving, setSaving] = useState(false);
  const change = (patch: Partial<Profile>) => setDraft((d) => ({ ...d, ...patch }));
  const name = STEPS[step]!;
  const goals = recommendedGoals(draft, today);
  const unit = weightUnit(draft.units);

  async function finish() {
    setSaving(true);
    const ok = await health.saveProfile({ ...draft, setUp: true });
    if (ok) await health.addWeight({ day: today, at: stampFor(today, today), kg: draft.weightKg });
    setSaving(false);
  }

  return (
    <div className={`shell ${s.app} ${s.onboarding}`}>
      <header className={s.onboardTop}>
        {step > 0 ? (
          <button type="button" className={s.iconBtn} onClick={() => setStep(step - 1)} aria-label="Back">
            <Icon path={ICON.chevronLeft} size={16} />
          </button>
        ) : (
          <button type="button" className={s.textBtn} onClick={clear}>
            <Icon path={ICON.chevronLeft} size={13} /> Slates
          </button>
        )}
        {step > 0 && (
          <div className={s.progressDots} aria-label={`Step ${step} of ${STEPS.length - 1}`}>
            {STEPS.slice(1).map((n, i) => (
              <span key={n} data-on={i < step || undefined} />
            ))}
          </div>
        )}
      </header>

      <main className={s.onboardBody} key={name}>
        {name === "intro" && (
          <div className={s.intro}>
            <span className={s.introMark} aria-hidden>
              <HIcon path={H.ring} size={34} />
            </span>
            <h1>Health</h1>
            <p>Photograph a meal and Slates reads its calories and macros. Your F45 studio’s workouts are built in, so each class you take counts toward the day.</p>
            <ul className={s.introList}>
              <li>
                <HIcon path={H.camera} size={16} /> Scan a plate, a label or a barcode
              </li>
              <li>
                <HIcon path={H.dumbbell} size={16} /> Today’s F45 workout, classes and spots
              </li>
              <li>
                <HIcon path={H.scale} size={16} /> Weight, streaks and progress on every device
              </li>
            </ul>
          </div>
        )}

        {name === "you" && (
          <>
            <h1 className={s.stepTitle}>A little about you</h1>
            <p className={s.stepText}>Your calorie needs start from these.</p>
            <div className={s.field}>
              <span className={s.fieldLabel}>Units</span>
              <Segmented
                label="Units"
                value={draft.units}
                onChange={(units: Units) => change({ units, glassMl: units === "imperial" ? 237 : 250 })}
                options={[
                  { value: "imperial", label: "lb, ft" },
                  { value: "metric", label: "kg, cm" },
                ]}
              />
            </div>
            <BodyFields profile={draft} onChange={change} />
          </>
        )}

        {name === "body" && (
          <>
            <h1 className={s.stepTitle}>Your weight today</h1>
            <p className={s.stepText}>It’s your starting point. Weigh in again whenever you like.</p>
            <NumberField
              big
              label="Weight"
              unit={unit}
              decimals={1}
              value={weightIn(draft.weightKg, draft.units)}
              min={draft.units === "imperial" ? 60 : 25}
              max={draft.units === "imperial" ? 880 : 400}
              onChange={(v) => {
                const kg = draft.units === "imperial" ? v / 2.2046226218 : v;
                change({ weightKg: kg, startWeightKg: kg, ...(draft.goal === "maintain" ? { targetWeightKg: kg } : {}) });
              }}
            />
          </>
        )}

        {name === "goal" && (
          <>
            <h1 className={s.stepTitle}>What are you working toward?</h1>
            <p className={s.stepText}>Two pounds a week is the most Slates will plan for.</p>
            <PlanFields profile={draft} onChange={change} />
          </>
        )}

        {name === "training" && (
          <>
            <h1 className={s.stepTitle}>How often do you train?</h1>
            <p className={s.stepText}>Count every F45 class and any other workouts.</p>
            <ActivityChoice value={draft.activity} onChange={(activity) => change({ activity })} />
            <DietSelect value={draft.diet} onChange={(diet) => change({ diet })} />
          </>
        )}

        {name === "plan" && (
          <>
            <h1 className={s.stepTitle}>Your daily plan</h1>
            <p className={s.stepText}>
              {draft.goal === "maintain"
                ? `Enough to hold ${dec(weightIn(draft.weightKg, draft.units))} ${unit} on the days you train.`
                : `${draft.goal === "lose" ? "Down" : "Up"} to ${dec(weightIn(draft.targetWeightKg, draft.units))} ${unit}, steadily. You can change any of it in Me.`}
            </p>
            <div className={`${s.card} ${s.planCard}`}>
              <span className={s.planCalories}>
                <b>{num(goals.calories)}</b> calories a day
              </span>
              <div className={s.goalNumbers}>
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
            </div>
            <p className={s.note}>From the Mifflin–St Jeor equation and your training level. Protein is set to at least {draft.activity === "active" || draft.activity === "veryActive" ? "1.6" : "1.4"} g per kilogram, for the strength days.</p>
          </>
        )}
      </main>

      <footer className={s.onboardFoot}>
        {name === "plan" ? (
          <button type="button" className={s.primaryBtn} onClick={() => void finish()} disabled={saving}>
            {saving ? "Saving…" : "Start tracking"}
          </button>
        ) : (
          <button type="button" className={s.primaryBtn} onClick={() => setStep(step + 1)}>
            {step === 0 ? "Set up" : "Continue"}
          </button>
        )}
      </footer>
    </div>
  );
}
