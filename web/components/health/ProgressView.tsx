"use client";

import { useMemo, useState } from "react";

import {
  addDays,
  bmi,
  bmiBand,
  dailyGoals,
  daysBetween,
  eaten,
  goalDay,
  streak,
  weekStart,
  weightIn,
  weightUnit,
} from "@/lib/health/nutrition";
import type { HealthState } from "@/lib/health/types";
import s from "./health.module.css";
import { dec, monthDay, num, Segmented, weekdayLetter } from "./parts";

/** Where it's all going: weight against the goal, the last week's eating, the streak, F45 week by week. */

type Range = "30" | "90" | "365" | "all";

function WeightChart({ points, goal, unit }: { points: { day: string; value: number }[]; goal: number; unit: string }) {
  const W = 340;
  const H = 168;
  const pad = { l: 36, r: 12, t: 14, b: 24 };
  const values = [...points.map((p) => p.value), goal];
  const lo = Math.floor(Math.min(...values) - 1);
  const hi = Math.ceil(Math.max(...values) + 1);
  const span = hi - lo || 1;
  const first = points[0]!.day;
  const days = Math.max(1, daysBetween(first, points.at(-1)!.day));
  const x = (day: string) => pad.l + (daysBetween(first, day) / days) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / span) * (H - pad.t - pad.b);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.day).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.at(-1)!.day).toFixed(1)},${H - pad.b} L${x(first).toFixed(1)},${H - pad.b} Z`;
  const ticks = [hi, (hi + lo) / 2, lo];
  const last = points.at(-1)!;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={s.chart} role="img" aria-label={`Weight from ${dec(points[0]!.value)} to ${dec(last.value)} ${unit}`}>
      <defs>
        <linearGradient id="health-weight-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--h-accent)" stopOpacity="0.28" />
          <stop offset="1" stopColor="var(--h-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className={s.chartGrid} />
          <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className={s.chartLabel}>
            {dec(t)}
          </text>
        </g>
      ))}
      <line x1={pad.l} x2={W - pad.r} y1={y(goal)} y2={y(goal)} className={s.chartGoal} />
      <text x={W - pad.r} y={y(goal) - 5} textAnchor="end" className={s.chartGoalLabel}>
        Goal {dec(goal)}
      </text>
      {points.length > 1 && <path d={area} fill="url(#health-weight-fill)" />}
      {points.length > 1 && <path d={line} className={s.chartLine} />}
      <circle cx={x(last.day)} cy={y(last.value)} r={4.5} className={s.chartDot} />
      <text x={pad.l} y={H - 6} className={s.chartLabel}>
        {monthDay(first)}
      </text>
      {points.length > 1 && (
        <text x={W - pad.r} y={H - 6} textAnchor="end" className={s.chartLabel}>
          {monthDay(last.day)}
        </text>
      )}
    </svg>
  );
}

function Bars({ bars, goal, format, label, current }: { bars: { key: string; label: string; value: number }[]; goal?: number; format: (v: number) => string; label: string; current?: string }) {
  const W = 340;
  const H = 150;
  const pad = { l: 8, r: 8, t: 18, b: 22 };
  const top = Math.max(goal ?? 0, ...bars.map((b) => b.value), 1) * 1.08;
  const slot = (W - pad.l - pad.r) / bars.length;
  const bw = Math.min(26, slot * 0.56);
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={s.chart} role="img" aria-label={label}>
      {goal !== undefined && (
        <>
          <line x1={pad.l} x2={W - pad.r} y1={y(goal)} y2={y(goal)} className={s.chartGoal} />
          <text x={W - pad.r} y={y(goal) - 5} textAnchor="end" className={s.chartGoalLabel}>
            Goal {format(goal)}
          </text>
        </>
      )}
      {bars.map((b, i) => {
        const cx = pad.l + slot * i + slot / 2;
        const h = Math.max(b.value ? 3 : 0, H - pad.b - y(b.value));
        const over = goal !== undefined && b.value > goal * 1.1;
        return (
          <g key={b.key}>
            <rect x={cx - bw / 2} y={H - pad.b - h} width={bw} height={h} rx={Math.min(6, bw / 2)} className={over ? s.barOver : b.value ? s.bar : s.barEmpty} />
            {!b.value && <rect x={cx - bw / 2} y={H - pad.b - 3} width={bw} height={3} rx={1.5} className={s.barEmpty} />}
            <text x={cx} y={H - 6} textAnchor="middle" className={b.key === current ? s.chartLabelOn : s.chartLabel}>
              {b.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function ProgressView({ state, today, onWeigh }: { state: HealthState; today: string; onWeigh: () => void }) {
  const { profile, log } = state;
  const [range, setRange] = useState<Range>("90");
  const unit = weightUnit(profile.units);
  const current = weightIn(profile.weightKg, profile.units);
  const target = weightIn(profile.targetWeightKg, profile.units);
  const start = weightIn(profile.startWeightKg, profile.units);

  /** One point a day: the last weigh-in that day. */
  const daily = useMemo(() => {
    const by = new Map<string, number>();
    for (const w of log.weights) by.set(w.day, w.kg);
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, kg]) => ({ day, value: weightIn(kg, profile.units) }));
  }, [log.weights, profile.units]);
  const shown = range === "all" ? daily : daily.filter((p) => p.day >= addDays(today, -Number(range)));

  const weekAgo = [...daily].reverse().find((p) => p.day <= addDays(today, -7));
  const change = weekAgo ? current - weekAgo.value : null;
  const span = start - target;
  const progress = Math.abs(span) < 0.05 ? 1 : Math.max(0, Math.min(1, (start - current) / span));
  const eta = goalDay(profile, today);

  const goal = dailyGoals(profile, today).calories;
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const eatenOn = (day: string) => log.foods.filter((f) => f.day === day).reduce((acc, f) => acc + eaten(f).calories, 0);
  const calorieBars = week.map((day) => ({ key: day, label: weekdayLetter(day), value: Math.round(eatenOn(day)) }));
  const loggedDays = calorieBars.filter((b) => b.value > 0);
  const average = loggedDays.length ? loggedDays.reduce((acc, b) => acc + b.value, 0) / loggedDays.length : 0;

  const runs = streak(state, today);
  const loggedSet = new Set(log.foods.map((f) => f.day));

  const weeks = Array.from({ length: 8 }, (_, i) => addDays(weekStart(today), (i - 7) * 7));
  const f45Bars = weeks.map((from, i) => ({
    key: from,
    // The month once, then just the day: "Aug 16, 23, 30, Sep 6".
    label: i === 0 || from.slice(5, 7) !== weeks[i - 1]!.slice(5, 7) ? monthDay(from) : String(Number(from.slice(8))),
    value: log.exercises.filter((e) => e.kind === "f45" && e.day >= from && e.day < addDays(from, 7)).length,
  }));

  const bodyMass = bmi(profile.weightKg, profile.heightCm);
  const band = bmiBand(bodyMass);
  const marker = Math.max(0, Math.min(1, (bodyMass - 15) / 20));

  return (
    <div className={s.stack}>
      <div className={s.progressGrid}>
        <section className={`${s.card} ${s.weightCard}`}>
          <div className={s.weightTop}>
            <div>
              <span className={s.eyebrow}>Weight</span>
              <span className={s.weightBig}>
                {dec(current)}
                <small>{unit}</small>
              </span>
              <span className={s.weightSub}>
                {change === null ? `Goal ${dec(target)} ${unit}` : `${change > 0 ? "+" : change < 0 ? "−" : "±"}${dec(Math.abs(change))} ${unit} in a week`}
              </span>
            </div>
            <button type="button" className={s.pillBtn} onClick={onWeigh}>
              Log weight
            </button>
          </div>
          <div className={s.goalTrack} aria-hidden>
            <span style={{ transform: `scaleX(${progress})` }} />
          </div>
          <div className={s.goalLegend}>
            <span>Start {dec(start)}</span>
            <span>{Math.round(progress * 100)}% there</span>
            <span>Goal {dec(target)}</span>
          </div>
          {eta && <p className={s.note}>At your pace you reach {dec(target)} {unit} around {monthDay(eta)}.</p>}
        </section>

        <section className={`${s.card} ${s.chartCard}`}>
          <div className={s.chartHead}>
            <h2>Trend</h2>
            <Segmented
              small
              label="Range"
              value={range}
              onChange={setRange}
              options={[
                { value: "30", label: "1M" },
                { value: "90", label: "3M" },
                { value: "365", label: "1Y" },
                { value: "all", label: "All" },
              ]}
            />
          </div>
          {shown.length ? <WeightChart points={shown} goal={target} unit={unit} /> : <p className={s.chartEmpty}>Log your weight a few times and the trend shows here.</p>}
        </section>

        <section className={`${s.card} ${s.chartCard}`}>
          <div className={s.chartHead}>
            <h2>Calories, last 7 days</h2>
            <span className={s.chartAside}>{average ? `${num(average)} avg` : ""}</span>
          </div>
          <Bars bars={calorieBars} goal={goal} format={num} current={today} label={`Calories eaten over the last week against a goal of ${num(goal)}`} />
        </section>

        <div className={s.pair}>
          <section className={`${s.card} ${s.miniCard}`}>
            <span className={s.eyebrow}>Streak</span>
            <span className={s.miniBig}>
              {runs}
              <small>{runs === 1 ? "day" : "days"}</small>
            </span>
            <span className={s.weekDots}>
              {week.map((day) => (
                <i key={day} data-on={loggedSet.has(day) || undefined} data-today={day === today || undefined} title={day}>
                  {weekdayLetter(day)}
                </i>
              ))}
            </span>
          </section>
          <section className={`${s.card} ${s.miniCard}`}>
            <span className={s.eyebrow}>BMI</span>
            <span className={s.miniBig}>
              {dec(bodyMass)}
              <small className={s[`tone_${band.tone}`]}>{band.label}</small>
            </span>
            <span className={s.bmiScale} aria-hidden>
              <i style={{ left: `${marker * 100}%` }} />
            </span>
          </section>
        </div>

        <section className={`${s.card} ${s.chartCard}`}>
          <div className={s.chartHead}>
            <h2>F45 classes a week</h2>
            <span className={s.chartAside}>{f45Bars.at(-1)!.value} this week</span>
          </div>
          <Bars bars={f45Bars} format={(v) => String(v)} current={weeks.at(-1)} label="F45 classes logged in each of the last eight weeks" />
        </section>
      </div>
    </div>
  );
}
