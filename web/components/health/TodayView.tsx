"use client";

import { useMemo, type ReactNode } from "react";

import { addDays, dailyGoals, dayDate, daysBetween, dayStats, eaten, waterIn, waterUnit } from "@/lib/health/nutrition";
import { MEAL_LABEL, MEALS, type ExerciseEntry, type F45Day, type F45Schedule, type FoodEntry, type HealthState } from "@/lib/health/types";
import { Icon, ICON } from "../ui";
import s from "./health.module.css";
import { clock, dateNumber, dayLabel, dec, H, HIcon, num, Ring, timeOf, TypeChip, weekdayLetter, WorkoutLogo } from "./parts";
import { CAMERA_BLOCKED, cameraSafe, photoUrl, type Health } from "./useHealth";

/**
 * The day: what's left to eat, the macros, today's class at the studio, water,
 * and everything logged. Laid out for a 5.4" phone first: one column, the
 * numbers that matter above the fold, every control a thumb's width.
 */

export const MACRO_COLOR = { protein: "var(--h-protein)", carbs: "var(--h-carbs)", fat: "var(--h-fat)" } as const;

/**
 * A label wrapping a hidden file input: the only way iOS opens the camera from
 * a tap. Where the camera would crash the app (see `cameraSafe`), a plain
 * button that says why.
 */
export function PhotoPicker({
  className,
  onFile,
  onBlocked,
  children,
  camera = true,
  label,
}: {
  className: string;
  onFile: (file: File) => void;
  onBlocked: () => void;
  children: ReactNode;
  camera?: boolean;
  label?: string;
}) {
  if (!cameraSafe()) {
    return (
      <button type="button" className={className} onClick={onBlocked} aria-label={label}>
        {children}
      </button>
    );
  }
  return (
    <label className={className} aria-label={label}>
      <input
        className={s.fileInput}
        type="file"
        accept="image/*"
        {...(camera ? { capture: "environment" as const } : {})}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onFile(file);
        }}
      />
      {children}
    </label>
  );
}

/**
 * Seven days ending today, then the seven before that, and so on: on a Sunday
 * a calendar week would be six empty days to come, and the week just done is
 * the one worth seeing.
 */
function DayStrip({ state, day, today, setDay }: { state: HealthState; day: string; today: string; setDay: (day: string) => void }) {
  const end = addDays(today, -7 * Math.floor(daysBetween(day, today) / 7));
  const days = Array.from({ length: 7 }, (_, i) => addDays(end, i - 6));
  const goal = dailyGoals(state.profile, today).calories;
  const eatenOn = useMemo(() => {
    const by = new Map<string, number>();
    for (const f of state.log.foods) by.set(f.day, (by.get(f.day) ?? 0) + eaten(f).calories);
    return by;
  }, [state.log.foods]);

  return (
    <section className={s.strip} aria-label="Choose a day">
      <div className={s.stripHead}>
        <h2>
          {dayLabel(day, today)}
          <span>{dayDate(day).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</span>
        </h2>
        <div className={s.stripNav}>
          <button type="button" onClick={() => setDay(addDays(day, -7))} aria-label="Previous week">
            <Icon path={ICON.chevronLeft} size={14} />
          </button>
          <button type="button" onClick={() => setDay(addDays(day, 7) > today ? today : addDays(day, 7))} disabled={end === today} aria-label="Next week">
            <HIcon path={H.chevronRight} size={14} />
          </button>
        </div>
      </div>
      <div className={s.stripDays}>
        {days.map((d) => {
          const cal = eatenOn.get(d) ?? 0;
          const fraction = goal ? cal / goal : 0;
          const r = 15;
          const c = 2 * Math.PI * r;
          return (
            <button
              key={d}
              type="button"
              className={s.stripDay}
              disabled={d > today}
              aria-pressed={d === day}
              data-today={d === today || undefined}
              aria-label={`${dayLabel(d, today)}${cal ? `, ${num(cal)} calories` : ", nothing logged"}`}
              onClick={() => setDay(d)}
            >
              <span className={s.stripLetter}>{weekdayLetter(d)}</span>
              <span className={s.stripDot}>
                <svg viewBox="0 0 36 36" aria-hidden>
                  <circle cx="18" cy="18" r={r} className={cal ? s.stripTrack : s.stripDashed} />
                  {cal > 0 && (
                    <circle
                      cx="18"
                      cy="18"
                      r={r}
                      className={fraction > 1.1 ? s.stripArcOver : s.stripArc}
                      strokeDasharray={c}
                      strokeDashoffset={c * (1 - Math.min(1, fraction))}
                      transform="rotate(-90 18 18)"
                    />
                  )}
                </svg>
                <span>{dateNumber(d)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function nextClassLine(f45: F45Day, isToday: boolean): string {
  if (!f45.classes.length) return "No classes on the schedule";
  if (!isToday) return `${f45.classes.length} classes, ${clock(f45.classes[0]!.start)} to ${clock(f45.classes.at(-1)!.start)}`;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const next = f45.classes.find((c) => c.start > hhmm);
  if (!next) return `Last class ${clock(f45.classes.at(-1)!.start)}`;
  const left = next.size - next.booked;
  return `Next ${clock(next.start)} · ${next.status !== "active" ? "booking closed" : left > 0 ? `${left} open` : "full"}`;
}

/** The day at the studio. The card opens the F45 page, which has no tab of its own on a phone. */
function F45Today({ f45, day, today, logged, onLog, onOpen }: { f45: F45Day; day: string; today: string; logged: ExerciseEntry | undefined; onLog: () => void; onOpen: () => void }) {
  return (
    <section className={`${s.card} ${s.f45Card}`}>
      <button type="button" className={s.f45Open} onClick={onOpen}>
        <WorkoutLogo src={f45.logo} name={f45.workout} size={46} />
        <span className={s.f45Text}>
          <span className={s.eyebrow}>
            F45 · {dayLabel(day, today)} <HIcon path={H.chevronRight} size={10} />
          </span>
          <span className={s.f45Name}>
            {f45.workout} <TypeChip type={f45.type} />
          </span>
          <span className={s.f45Sub}>{logged ? `Logged${logged.f45?.time ? ` · ${clock(logged.f45.time)} class` : ""}` : nextClassLine(f45, day === today)}</span>
        </span>
      </button>
      {logged ? (
        <span className={s.doneChip}>
          <Icon path={ICON.check} size={13} />
          {num(logged.calories)}
        </span>
      ) : (
        <button type="button" className={s.pillBtn} onClick={onLog}>
          Log class
        </button>
      )}
    </section>
  );
}

function FoodRow({ entry, onOpen }: { entry: FoodEntry; onOpen: () => void }) {
  const n = eaten(entry);
  return (
    <button type="button" className={s.row} onClick={onOpen}>
      {entry.photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={s.thumb} src={photoUrl(entry.photo)} alt="" loading="lazy" />
      ) : (
        <span className={s.thumbIcon}>
          <HIcon path={entry.source === "barcode" || entry.source === "search" ? H.barcode : H.meal} size={18} />
        </span>
      )}
      <span className={s.rowMain}>
        <span className={s.rowTitle}>{entry.name}</span>
        <span className={s.rowSub}>
          {entry.servings !== 1 ? `${dec(entry.servings)} × ` : ""}
          {entry.serving} · {timeOf(entry.at)}
        </span>
        <span className={s.rowMacros}>
          <i style={{ background: MACRO_COLOR.protein }} />
          {num(n.protein)}g
          <i style={{ background: MACRO_COLOR.carbs }} />
          {num(n.carbs)}g
          <i style={{ background: MACRO_COLOR.fat }} />
          {num(n.fat)}g
        </span>
      </span>
      <span className={s.rowCal}>
        {num(n.calories)}
        <small>cal</small>
      </span>
    </button>
  );
}

export function ExerciseRow({ entry, onOpen, logo, when }: { entry: ExerciseEntry; onOpen: () => void; logo?: string | null; when?: string }) {
  return (
    <button type="button" className={s.row} onClick={onOpen}>
      {entry.kind === "f45" ? (
        <WorkoutLogo src={logo ?? null} name={entry.f45?.workout ?? entry.name} size={48} />
      ) : (
        <span className={s.thumbIcon}>
          <HIcon path={H.dumbbell} size={18} />
        </span>
      )}
      <span className={s.rowMain}>
        <span className={s.rowTitle}>
          {entry.name} {entry.f45?.type && <TypeChip type={entry.f45.type} />}
        </span>
        <span className={s.rowSub}>
          {when ? `${when} · ` : ""}
          {entry.minutes} min{entry.f45?.time ? ` · ${clock(entry.f45.time)}` : ` · ${timeOf(entry.at)}`}
        </span>
      </span>
      <span className={`${s.rowCal} ${s.rowBurn}`}>
        −{num(entry.calories)}
        <small>cal</small>
      </span>
    </button>
  );
}

export default function TodayView({
  health,
  state,
  today,
  day,
  setDay,
  schedule,
  onFood,
  onExercise,
  onLogClass,
  onOpenF45,
  onScan,
  onDescribe,
}: {
  health: Health;
  state: HealthState;
  today: string;
  day: string;
  setDay: (day: string) => void;
  schedule: F45Schedule | null;
  onFood: (entry: FoodEntry) => void;
  onExercise: (entry: ExerciseEntry) => void;
  onLogClass: (day: string) => void;
  onOpenF45: () => void;
  onScan: (file: File) => void;
  onDescribe: () => void;
}) {
  const { profile, log } = state;
  const stats = dayStats(state, day, today);
  const foods = log.foods.filter((f) => f.day === day);
  const exercises = log.exercises.filter((e) => e.day === day);
  const f45 = schedule?.days.find((d) => d.date === day);
  const loggedClass = exercises.find((e) => e.kind === "f45");
  const budget = stats.goal + stats.burnBonus + stats.rollover;
  const over = stats.left < 0;
  const glasses = Math.min(12, Math.max(1, Math.ceil(stats.waterGoalMl / profile.glassMl)));
  const full = Math.floor(stats.waterMl / profile.glassMl);
  const unit = waterUnit(profile.units);
  const logos = useMemo(() => new Map(schedule?.days.map((d) => [d.date, d.logo]) ?? []), [schedule]);

  const macro = (key: "protein" | "carbs" | "fat", label: string, glyph: string) => {
    const amount = stats[key];
    const left = amount.goal - amount.value;
    return (
      <div className={`${s.card} ${s.macro}`}>
        <span className={s.macroValue}>
          {num(Math.abs(left))}
          <small>g</small>
        </span>
        <span className={s.macroLabel}>
          {label} {left >= 0 ? "left" : "over"}
        </span>
        <Ring value={amount.goal ? amount.value / amount.goal : 0} size={56} stroke={6} color={MACRO_COLOR[key]} label={`${num(amount.value)} of ${num(amount.goal)} grams of ${label.toLowerCase()}`}>
          <span style={{ color: MACRO_COLOR[key] }}>
            <HIcon path={glyph} size={15} />
          </span>
        </Ring>
      </div>
    );
  };

  return (
    <div className={s.stack}>
      <DayStrip state={state} day={day} today={today} setDay={setDay} />

      <div className={s.todayGrid}>
        <div className={s.stack}>
          <section className={`${s.card} ${s.calCard}`}>
            <div className={s.calText}>
              <span className={s.calBig}>{num(Math.abs(stats.left))}</span>
              <span className={s.calLabel}>{over ? "Calories over" : "Calories left"}</span>
              <span className={s.calMeta}>
                <span>
                  <b>{num(stats.eaten)}</b> eaten
                </span>
                <span>
                  <b>{num(stats.burned)}</b> burned
                </span>
                {stats.rollover > 0 && (
                  <span>
                    <b>+{num(stats.rollover)}</b> rolled
                  </span>
                )}
              </span>
            </div>
            <Ring value={budget ? stats.eaten / budget : 0} size={112} stroke={10} color={over ? "var(--bad)" : "var(--h-accent)"} label={`${num(stats.eaten)} of ${num(budget)} calories eaten`}>
              <span className={s.calRingIcon}>
                <HIcon path={H.flame} size={24} />
              </span>
            </Ring>
          </section>

          <div className={s.macros}>
            {macro("protein", "Protein", H.protein)}
            {macro("carbs", "Carbs", H.carbs)}
            {macro("fat", "Fat", H.fat)}
          </div>

          {f45 && (
            <F45Today
              f45={f45}
              day={day}
              today={today}
              logged={loggedClass}
              onLog={() => onLogClass(day)}
              onOpen={onOpenF45}
            />
          )}

          <section className={`${s.card} ${s.waterCard}`}>
            <div className={s.waterHead}>
              <span className={s.waterTitle}>
                <span className={s.waterIcon}>
                  <HIcon path={H.drop} size={16} />
                </span>
                Water
              </span>
              <span className={s.waterAmount}>
                <b>{num(waterIn(stats.waterMl, profile.units))}</b> / {num(waterIn(stats.waterGoalMl, profile.units))} {unit}
              </span>
            </div>
            <div className={s.glasses} aria-hidden>
              {Array.from({ length: glasses }, (_, i) => (
                <span key={i} data-full={i < full || undefined} />
              ))}
            </div>
            <div className={s.waterButtons}>
              <button type="button" className={s.roundBtn} onClick={() => void health.setWater(day, Math.max(0, stats.waterMl - profile.glassMl))} disabled={!stats.waterMl} aria-label="Remove a glass">
                <Icon path={ICON.minus} size={16} />
              </button>
              <button type="button" className={s.waterAdd} onClick={() => void health.setWater(day, stats.waterMl + profile.glassMl)}>
                <Icon path={ICON.plus} size={14} /> {num(waterIn(profile.glassMl, profile.units))} {unit}
              </button>
            </div>
          </section>

          <section className={`${s.card} ${s.scoreCard}`}>
            <div className={s.scoreHead}>
              <span className={s.scoreTitle}>
                <HIcon path={H.heart} size={15} /> Health score
              </span>
              <span className={s.scoreValue}>
                {stats.score ?? "–"}
                <small>/10</small>
              </span>
            </div>
            <div className={s.scoreBar}>
              <span style={{ transform: `scaleX(${(stats.score ?? 0) / 10})` }} />
            </div>
            <p className={s.scoreNote}>{stats.scoreNote}</p>
          </section>
        </div>

        <section className={s.logSection} aria-label="Logged">
          <div className={s.sectionHead}>
            <h2>{day === today ? "Today’s log" : `${dayLabel(day, today)}’s log`}</h2>
            {foods.length > 0 && <span>{num(stats.eaten)} cal</span>}
          </div>
          {!foods.length && !exercises.length ? (
            <div className={`${s.card} ${s.empty}`}>
              <p className={s.emptyTitle}>Nothing logged {day === today ? "yet" : "this day"}</p>
              <p className={s.emptyText}>Snap your plate and Slates reads the calories and macros. Or just type what you ate.</p>
              <div className={s.emptyActions}>
                <PhotoPicker className={s.primaryBtn} onFile={onScan} onBlocked={() => health.notify(CAMERA_BLOCKED)}>
                  <HIcon path={H.camera} size={17} /> Scan a meal
                </PhotoPicker>
                <button type="button" className={s.secondaryBtn} onClick={onDescribe}>
                  <Icon path={ICON.pencil} size={15} /> Describe it
                </button>
              </div>
            </div>
          ) : (
            <>
              {MEALS.map((meal) => {
                const items = foods.filter((f) => f.meal === meal);
                if (!items.length) return null;
                const cal = items.reduce((acc, f) => acc + eaten(f).calories, 0);
                return (
                  <div key={meal} className={s.group}>
                    <div className={s.groupHead}>
                      <span>{MEAL_LABEL[meal]}</span>
                      <span>{num(cal)} cal</span>
                    </div>
                    <div className={`${s.card} ${s.rows}`}>
                      {items.map((entry) => (
                        <FoodRow key={entry.id} entry={entry} onOpen={() => onFood(entry)} />
                      ))}
                    </div>
                  </div>
                );
              })}
              {exercises.length > 0 && (
                <div className={s.group}>
                  <div className={s.groupHead}>
                    <span>Exercise</span>
                    <span>{num(stats.burned)} cal</span>
                  </div>
                  <div className={`${s.card} ${s.rows}`}>
                    {exercises.map((entry) => (
                      <ExerciseRow key={entry.id} entry={entry} logo={logos.get(entry.day)} onOpen={() => onExercise(entry)} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
