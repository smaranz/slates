"use client";

import { useMemo, useState } from "react";

import { addDays, burnEstimate } from "@/lib/health/nutrition";
import type { ExerciseEntry, F45Class, F45Schedule, HealthState } from "@/lib/health/types";
import { Icon, ICON } from "../ui";
import s from "./health.module.css";
import { clock, dateNumber, dayLabel, num, TypeChip, weekdayShort, WorkoutLogo } from "./parts";
import { ExerciseRow } from "./TodayView";

/**
 * The studio, matched to what it's doing: today's workout and its type, every
 * class with its coach and how full it is, the days ahead so a week can be
 * planned around cardio and strength, and the classes already done.
 */

const TYPE_VAR: Record<string, string> = {
  Cardio: "var(--h-cardio)",
  Resistance: "var(--h-resistance)",
  Hybrid: "var(--h-hybrid)",
  Recovery: "var(--h-recovery)",
};

function nowHHMM(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function spotsText(c: F45Class, past: boolean): string {
  if (past) return "Done";
  if (c.status !== "active") return "Booking closed";
  const open = c.size - c.booked;
  return open > 0 ? `${open} of ${c.size} open` : "Full";
}

export default function F45View({
  schedule,
  error,
  state,
  today,
  onLog,
  onExercise,
  onRefresh,
}: {
  schedule: F45Schedule | null;
  error: string | null;
  state: HealthState;
  today: string;
  onLog: (day: string) => void;
  onExercise: (entry: ExerciseEntry) => void;
  onRefresh: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const classes = useMemo(() => state.log.exercises.filter((e) => e.kind === "f45").sort((a, b) => b.day.localeCompare(a.day) || b.at - a.at), [state.log.exercises]);
  const logos = useMemo(() => new Map(schedule?.days.map((d) => [d.date, d.logo]) ?? []), [schedule]);

  if (!schedule) {
    return (
      <div className={s.stack}>
        {error ? (
          <section className={`${s.card} ${s.empty}`}>
            <p className={s.emptyTitle}>The F45 schedule didn’t load</p>
            <p className={s.emptyText}>{error}</p>
            <div className={s.emptyActions}>
              <button type="button" className={s.secondaryBtn} onClick={onRefresh}>
                Try again
              </button>
            </div>
          </section>
        ) : (
          <>
            <div className={`${s.card} ${s.skeleton}`} style={{ height: 92 }} />
            <div className={`${s.card} ${s.skeleton}`} style={{ height: 260 }} />
            <div className={`${s.card} ${s.skeleton}`} style={{ height: 220 }} />
          </>
        )}
      </div>
    );
  }

  const { studio } = schedule;
  const ahead = schedule.days.filter((d) => d.date >= today).slice(0, 8);
  const selected = picked ?? (ahead.find((d) => d.date === today) ?? ahead[0])?.date ?? today;
  const day = schedule.days.find((d) => d.date === selected);
  const minutes = day?.classes[0]?.minutes ?? 45;
  const estimate = day ? burnEstimate({ kind: "f45", type: day.type, minutes, kg: state.profile.weightKg }) : 0;
  const logged = state.log.exercises.find((e) => e.kind === "f45" && e.day === selected);
  const now = nowHHMM();

  const lastWeek = classes.filter((e) => e.day > addDays(today, -7) && e.day <= today);
  const month = classes.filter((e) => e.day > addDays(today, -30));
  const mix = ["Cardio", "Resistance", "Hybrid"].map((type) => ({ type, count: month.filter((e) => e.f45?.type === type).length }));
  const mixTotal = mix.reduce((acc, m) => acc + m.count, 0);

  return (
    <div className={s.stack}>
      <section className={s.studio}>
        <div>
          <span className={s.eyebrow}>Your studio</span>
          <h2>{studio.name}</h2>
          <p>{studio.address}</p>
        </div>
        <a className={s.pillBtn} href={`${studio.url}#schedule`} target="_blank" rel="noreferrer">
          Book <Icon path={ICON.external} size={12} />
        </a>
      </section>
      {schedule.stale && <p className={s.note}>F45 isn’t answering, so this is the last schedule Slates saw.</p>}

      <div className={s.dayChips} role="tablist" aria-label="Day">
        {ahead.map((d) => (
          <button
            key={d.date}
            type="button"
            role="tab"
            aria-selected={d.date === selected}
            className={s.dayChip}
            onClick={() => {
              setPicked(d.date);
              setExpanded(false);
            }}
          >
            <span>{d.date === today ? "Today" : weekdayShort(d.date)}</span>
            <b>{dateNumber(d.date)}</b>
            <i style={{ background: TYPE_VAR[d.type] ?? "var(--muted)" }} aria-hidden />
            <em>{d.workout}</em>
          </button>
        ))}
      </div>

      <div className={s.f45Grid}>
        {day ? (
          <section className={`${s.card} ${s.hero}`} style={{ ["--type" as string]: TYPE_VAR[day.type] ?? "var(--h-accent)" }}>
            <div className={s.heroTop}>
              <WorkoutLogo src={day.logo} name={day.workout} size={64} />
              <div className={s.heroHeading}>
                <span className={s.eyebrow}>
                  {dayLabel(day.date, today)} <TypeChip type={day.type} />
                </span>
                <h3 className={s.heroName}>{day.workout}</h3>
                <span className={s.heroMeta}>
                  {minutes} min · about {num(estimate)} cal for you
                </span>
              </div>
            </div>
            {day.description && (
              <p className={`${s.heroText} ${expanded ? s.heroTextOpen : ""}`} onClick={() => setExpanded((open) => !open)}>
                {day.description}
              </p>
            )}
            {selected <= today &&
              (logged ? (
                <button type="button" className={s.loggedLine} onClick={() => onExercise(logged)}>
                  <Icon path={ICON.check} size={14} /> Logged{logged.f45?.time ? ` the ${clock(logged.f45.time)} class` : ""} · {num(logged.calories)} cal
                </button>
              ) : (
                <button type="button" className={s.primaryBtn} onClick={() => onLog(selected)}>
                  Log this class
                </button>
              ))}
          </section>
        ) : (
          <section className={`${s.card} ${s.empty}`}>
            <p className={s.emptyTitle}>No schedule for this day yet</p>
            <p className={s.emptyText}>F45 posts classes about two weeks ahead.</p>
          </section>
        )}

        {day && (
          <section aria-label="Classes">
            <div className={s.sectionHead}>
              <h2>Classes</h2>
              <span>
                {day.classes.length} on {day.date === today ? "today" : weekdayShort(day.date)}
              </span>
            </div>
            <div className={`${s.card} ${s.rows}`}>
              {day.classes.length ? (
                day.classes.map((c) => {
                  const past = day.date < today || (day.date === today && c.start < now);
                  return (
                    <div key={c.id} className={s.classRow} data-past={past || undefined}>
                      <span className={s.classTime}>{clock(c.start)}</span>
                      <span className={s.classMain}>
                        <span>{c.coach ?? "Coach to be announced"}</span>
                        <small>
                          {c.name && c.name !== day.workout ? `${c.name} · ` : ""}
                          {c.minutes} min
                        </small>
                      </span>
                      <span className={s.classSpots}>
                        <span className={s.spotsBar} aria-hidden>
                          <span style={{ transform: `scaleX(${c.size ? Math.min(1, c.booked / c.size) : 0})` }} />
                        </span>
                        <small>{spotsText(c, past)}</small>
                      </span>
                    </div>
                  );
                })
              ) : (
                <p className={s.rowsEmpty}>No classes this day.</p>
              )}
            </div>
          </section>
        )}
      </div>

      <section aria-label="Your F45">
        <div className={s.sectionHead}>
          <h2>Your F45</h2>
          <span>{classes.length ? `${classes.length} logged` : ""}</span>
        </div>
        <div className={s.statGrid}>
          <div className={`${s.card} ${s.stat}`}>
            <b>{lastWeek.length}</b>
            <span>last 7 days</span>
          </div>
          <div className={`${s.card} ${s.stat}`}>
            <b>{month.length}</b>
            <span>last 30 days</span>
          </div>
          <div className={`${s.card} ${s.stat}`}>
            <b>{num(month.reduce((acc, e) => acc + e.calories, 0))}</b>
            <span>cal in 30 days</span>
          </div>
        </div>
        {mixTotal > 0 && (
          <div className={`${s.card} ${s.mix}`}>
            <div className={s.mixBar} aria-hidden>
              {mix.map((m) => (m.count ? <span key={m.type} style={{ flex: m.count, background: TYPE_VAR[m.type] }} /> : null))}
            </div>
            <div className={s.mixLegend}>
              {mix.map((m) => (
                <span key={m.type}>
                  <i style={{ background: TYPE_VAR[m.type] }} />
                  {m.type} <b>{m.count}</b>
                </span>
              ))}
            </div>
          </div>
        )}
        {classes.length > 0 ? (
          <div className={`${s.card} ${s.rows}`} style={{ marginTop: 10 }}>
            {classes.slice(0, 6).map((entry) => (
              <ExerciseRow key={entry.id} entry={entry} when={dayLabel(entry.day, today)} logo={logos.get(entry.day)} onOpen={() => onExercise(entry)} />
            ))}
          </div>
        ) : (
          <p className={s.note}>Log a class after you go and it shows up here, with what it burned.</p>
        )}
      </section>
    </div>
  );
}
