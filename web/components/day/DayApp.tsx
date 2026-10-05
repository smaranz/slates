"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";

import {
  addDays,
  axisOf,
  brief,
  clock,
  clockAt,
  dayDate,
  hourLabel,
  KIND_LABEL,
  momentAt,
  nightAfter,
  planFor,
  span,
  splitOf,
  type DayPlan,
  type Kind,
  type Moment,
} from "@/lib/day/schedule";
import { fmtMinutes } from "@/lib/format";
import { useMode } from "@/lib/mode";
import { Icon, ICON } from "../ui";
import s from "./day.module.css";

/**
 * Schedule: the student's week as time you can see.
 *
 * Every block is drawn as long as it lasts, on one clock from the first
 * wake-up to bedtime, so a three-hour study session looks like three hours
 * and half an hour of dinner like half an hour, and a line marks now. Beside
 * the timeline: what's on this minute, how long it has left and what follows,
 * tonight's sleep, and where the hours go.
 *
 * A phone gets one day with the now card first. A window wide enough for it
 * gets the whole coming week side by side, a column a day; Day narrows it to
 * one, and a column's heading opens that day.
 */

/* ── icons (24×24, filled, in Slates' own style) ───────────────────────── */

const D = {
  cap: "M12 3 1 8.5 12 14l11-5.5zM5 11.6v4.9c0 1.9 3.1 3.5 7 3.5s7-1.6 7-3.5v-4.9l-7 3.5zm15.4-1.8H22V16h-1.6z",
  code: "M8.6 6.6 3.2 12l5.4 5.4 1.4-1.4L6 12l4-4zm6.8 0-1.4 1.4 4 4-4 4 1.4 1.4 5.4-5.4z",
  camera:
    "M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3zm5 3a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm5.3-3.6a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6z",
  book: "M3 5c2.8-1.3 5.8-1.2 8 .4V20c-2.2-1.4-5.2-1.5-8-.3zm10 .4c2.2-1.6 5.2-1.7 8-.4v14.7c-2.8-1.2-5.8-1.1-8 .3z",
  meal: "M6 2h1.4v6.2c0 .6.4 1 .9 1.2V2h1.4v7.4c.5-.2.9-.6.9-1.2V2H12v6.4a3 3 0 0 1-2 2.8V22H8.3V11.2A3 3 0 0 1 6 8.4zm11.3 0C19 2 20 4.4 20 7.6c0 2.3-.8 3.7-2 4.2V22h-1.8V2z",
  mug: "M4 7h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zm13 1h1.5a3 3 0 0 1 0 6H17v-2h1.5a1 1 0 0 0 0-2H17zM3 20h15v2H3zM8.2 2h1.6v3.2H8.2zm3.4 0h1.6v3.2h-1.6z",
  spark: "M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2zm7-1 .8 2.2L22 5l-2.2.8L19 8l-.8-2.2L16 5l2.2-.8z",
} as const;

const KIND_ICON: Record<Kind, string> = {
  routine: D.mug,
  build: D.code,
  school: D.cap,
  content: D.camera,
  study: D.book,
  meal: D.meal,
  free: D.spark,
  sleep: ICON.tonight,
};

/* ── the clock ─────────────────────────────────────────────────────────── */

const MINUTE = 60_000;
const thisMinute = () => Math.floor(Date.now() / MINUTE) * MINUTE;

/** Calls back as each minute turns, and at once when the window comes back: timers sleep in the background. */
function subscribeClock(onChange: () => void) {
  let timer = 0;
  const wait = () => {
    timer = window.setTimeout(() => {
      onChange();
      wait();
    }, MINUTE - (Date.now() % MINUTE) + 20);
  };
  const onShow = () => {
    if (document.visibilityState === "visible") onChange();
  };
  wait();
  document.addEventListener("visibilitychange", onShow);
  window.addEventListener("focus", onShow);
  return () => {
    window.clearTimeout(timer);
    document.removeEventListener("visibilitychange", onShow);
    window.removeEventListener("focus", onShow);
  };
}

/** The current minute as a timestamp, so everything moves on together when it turns. */
function useMinute(): number {
  return useSyncExternalStore(subscribeClock, thisMinute, thisMinute);
}

/* ── the window ────────────────────────────────────────────────────────── */

/** Wide enough for seven columns that can still hold "Coding + product". */
const WEEK_FITS = "(min-width: 1360px)";

function subscribeWidth(onChange: () => void) {
  const media = window.matchMedia(WEEK_FITS);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function useWeekFits(): boolean {
  return useSyncExternalStore(subscribeWidth, () => window.matchMedia(WEEK_FITS).matches, () => false);
}

type View = "day" | "week";

const VIEW_KEY = "slates.schedule.view";

/** The view last chosen with the Day / Week switch; the week until then, wherever it fits. */
function savedView(): View {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "day" ? "day" : "week";
  } catch {
    return "week";
  }
}

/* ── words ─────────────────────────────────────────────────────────────── */

function dayName(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  return dayDate(day).toLocaleDateString("en-US", { weekday: "long" });
}

/** The date under the name; the weekday only where the name didn't already say it. */
function dateLine(day: string, today: string): string {
  const named = day === today || day === addDays(today, 1);
  return dayDate(day).toLocaleDateString("en-US", named ? { weekday: "long", month: "long", day: "numeric" } : { month: "long", day: "numeric" });
}

const minutesOf = (plan: DayPlan, kind: Kind) => plan.blocks.reduce((sum, b) => sum + (b.kind === kind ? b.end - b.start : 0), 0);

/* ── the room ──────────────────────────────────────────────────────────── */

export default function DayApp() {
  const { clear } = useMode();
  const { day: today, minutes } = clockAt(useMinute());
  const weekFits = useWeekFits();
  const [preferred, setPreferred] = useState<View>(savedView);
  const [picked, setPicked] = useState<string | null>(null);
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  // A picked day holds while it's still in the coming week; after that it's today again.
  const chosen = picked && week.includes(picked) ? picked : null;
  const view: View = weekFits && preferred === "week" && !chosen ? "week" : "day";
  const day = view === "day" && chosen ? chosen : today;
  const isToday = day === today;
  const plan = planFor(day);
  const plans = view === "week" ? week.map(planFor) : [plan];

  const show = (next: View) => {
    setPreferred(next);
    if (next === "week") setPicked(null);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Storage blocked: the choice holds until the room closes.
    }
  };

  // The traffic lights sit over the header's left end in the desktop shell.
  useEffect(() => {
    if (navigator.userAgent.includes("Electron")) document.documentElement.dataset.desktop = "1";
  }, []);

  return (
    <div className={`shell ui-mode ${s.app}`}>
      <div className="main">
        <header className={`ui-top ${s.top}`}>
          <button type="button" className="ui-back" onClick={clear} aria-label="Back to Slates">
            <Icon path={ICON.chevronLeft} size={13} /> Slates
          </button>
          <span className="ui-top-title">Schedule</span>
          {weekFits && (
            <div className={s.views} role="group" aria-label="Show">
              <button type="button" aria-pressed={view === "day"} onClick={() => show("day")}>
                Day
              </button>
              <button type="button" aria-pressed={view === "week"} onClick={() => show("week")}>
                Week
              </button>
            </div>
          )}
          <span className={s.spacer} />
          {/* With the week preferred, the switch is the way back. */}
          {!isToday && !(weekFits && preferred === "week") && (
            <button type="button" className={s.todayBtn} onClick={() => setPicked(null)}>
              Back to today
            </button>
          )}
        </header>

        <div className={s.scroll}>
          <div className={s.page} data-view={view}>
            <div className={s.rail}>
              <DayHead day={day} today={today} plan={plan} />
              {view === "day" && <WeekStrip week={week} day={day} today={today} onPick={setPicked} />}
              {isToday && <NowCard moment={momentAt(today, minutes)} />}
              <Tonight day={day} today={today} />
              <Hours plans={plans} title={view === "week" ? "The next 7 days" : `${dayName(day, today)}'s hours`} />
            </div>
            <div className={s.stage}>
              <TimeGrid key={view === "week" ? "week" : day} plans={plans} today={today} minutes={minutes} view={view} onOpen={setPicked} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DayHead({ day, today, plan }: { day: string; today: string; plan: DayPlan }) {
  const study = minutesOf(plan, "study");
  return (
    <div className={s.head}>
      <h1>{dayName(day, today)}</h1>
      <p>
        <span>{dateLine(day, today)}</span>
        <span className={s.chip} data-kind={plan.school ? "school" : "study"}>
          <Icon path={plan.school ? D.cap : D.book} size={13} />
          {plan.school ? `School ${span(plan.school.leave, plan.school.home)}` : study ? `No school · ${fmtMinutes(study)} of study` : "No school"}
        </span>
      </p>
    </div>
  );
}

function WeekStrip({ week, day, today, onPick }: { week: string[]; day: string; today: string; onPick: (day: string) => void }) {
  return (
    <div className={s.strip} role="group" aria-label="Pick a day">
      {week.map((d) => {
        const plan = planFor(d);
        const date = dayDate(d);
        return (
          <button
            key={d}
            type="button"
            className={s.stripDay}
            aria-pressed={d === day}
            data-today={d === today || undefined}
            aria-label={`${dayName(d, today)}, ${date.toLocaleDateString("en-US", { month: "long", day: "numeric" })}${plan.school ? ", school" : ""}`}
            onClick={() => onPick(d)}
          >
            <span className={s.stripDow}>{date.toLocaleDateString("en-US", { weekday: "short" })}</span>
            <span className={s.stripDate}>{date.getDate()}</span>
            <span className={s.stripShape} aria-hidden>
              {plan.blocks.map((b) => (
                <span key={b.start} data-kind={b.kind} style={{ flexGrow: b.end - b.start }} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** "1h 24m" with the numbers large and the units small. */
function Countdown({ minutes }: { minutes: number }) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return (
    <b aria-hidden>
      {h > 0 && (
        <>
          {h}
          <small>h</small>
        </>
      )}
      {(m > 0 || h === 0) && (
        <>
          {m}
          <small>m</small>
        </>
      )}
    </b>
  );
}

function NowCard({ moment }: { moment: Moment }) {
  const { block, next, progress, left } = moment;
  const asleep = block.kind === "sleep";
  const until = asleep ? `until ${clock(block.end)}` : "left";
  return (
    <section className={s.now} data-kind={block.kind} aria-label="Now">
      <div className={s.nowTop}>
        <span className={s.eyebrow}>
          <span className={s.liveDot} aria-hidden />
          Now
        </span>
        <span className={s.nowSpan}>{span(block.start, block.end)}</span>
      </div>
      <div className={s.nowName}>
        <span className={s.badge} aria-hidden>
          <Icon path={KIND_ICON[block.kind]} size={22} />
        </span>
        <h2>{block.title}</h2>
      </div>
      <p className={s.count}>
        <Countdown minutes={left} />
        <span aria-hidden>{until}</span>
        <span className="sr-only">
          {fmtMinutes(left)} {until}
        </span>
      </p>
      <div>
        <div
          className={s.track}
          role="progressbar"
          aria-label={`How far through ${block.title.toLowerCase()}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <span style={{ transform: `scaleX(${progress})` }} />
        </div>
        <div className={s.trackEnds} aria-hidden>
          <span>{clock(block.start)}</span>
          <span>{clock(block.end)}</span>
        </div>
      </div>
      <div className={s.next} data-kind={next.kind}>
        <span className={s.nextLabel}>Next</span>
        <span className={s.nextIcon} aria-hidden>
          <Icon path={KIND_ICON[next.kind]} size={15} />
        </span>
        <span className={s.nextTitle}>{next.title}</span>
        <span className={s.nextTime}>{clock(next.start)}</span>
      </div>
    </section>
  );
}

/** Where the waking hours go, each kind as its share of them. */
function Hours({ plans, title }: { plans: DayPlan[]; title: string }) {
  const awake = plans.reduce((sum, p) => sum + p.sleep - p.wake, 0);
  return (
    <section className={s.hours} aria-labelledby="day-hours">
      <div className={s.hoursHead}>
        <h2 id="day-hours">{title}</h2>
        <span>{fmtMinutes(awake)} awake</span>
      </div>
      <ul className={s.hoursList}>
        {splitOf(...plans).map(({ kind, minutes }, i) => (
          <li key={kind} data-kind={kind} style={{ "--i": i } as CSSProperties}>
            <span className={s.hoursName}>
              <i aria-hidden />
              {KIND_LABEL[kind]}
            </span>
            <b>{fmtMinutes(minutes)}</b>
            <span className={s.hoursBar} aria-hidden>
              <span style={{ transform: `scaleX(${minutes / awake})` }} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Tonight({ day, today }: { day: string; today: string }) {
  const night = nightAfter(day);
  const next = planFor(addDays(day, 1));
  const name = day === today ? "Tonight" : `${dayName(day, today)} night`;
  return (
    <section className={s.tonight} data-kind="sleep" aria-label={name}>
      <span className={s.tonightIcon} aria-hidden>
        <Icon path={ICON.tonight} size={18} />
      </span>
      <div className={s.tonightText}>
        <h2>{name}</h2>
        <p>
          {clock(night.sleep)} to {clock(night.wake)}
        </p>
      </div>
      <b className={s.tonightLength}>
        {fmtMinutes(night.minutes)}
        <small>of sleep</small>
      </b>
      <p className={s.tonightNext}>
        <span>{dayName(next.day, today)}</span>
        <span>{next.school ? `School ${span(next.school.leave, next.school.home)}` : `No school, up at ${clock(next.wake)}`}</span>
      </p>
    </section>
  );
}

/* ── the timeline ──────────────────────────────────────────────────────── */

/**
 * Days on one clock: the hours down the left, a column a day, each block as
 * tall as it is long. On today the hours already gone step back, the block
 * the clock is in is ringed, and a line marks the minute.
 */
function TimeGrid({ plans, today, minutes, view, onOpen }: { plans: DayPlan[]; today: string; minutes: number; view: View; onOpen: (day: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const axis = axisOf(plans);
  const length = axis.end - axis.start;
  const at = (m: number) => (m - axis.start) / length;
  const hours: number[] = [];
  for (let h = axis.start; h <= axis.end; h += 60) hours.push(h);
  const nowShown = plans.some((p) => p.day === today) && minutes >= axis.start && minutes < axis.end;
  // The minute's tag takes the place of an hour label it would half cover.
  const labelled = hours.filter((h) => !nowShown || Math.abs(h - minutes) >= 24);

  // On a short window the line for now can open below the fold; bring it up once.
  useEffect(() => {
    const line = ref.current?.querySelector<HTMLElement>("[data-now-line]");
    if (!line || !window.matchMedia("(min-width: 900px)").matches) return;
    const { top, bottom } = line.getBoundingClientRect();
    if (top < 0 || bottom > window.innerHeight) line.scrollIntoView({ block: "center" });
  }, []);

  return (
    <div ref={ref} className={s.grid} data-view={view} style={{ "--hours": length / 60, "--cols": plans.length } as CSSProperties}>
      {view === "week" && (
        <div className={s.heads}>
          {plans.map((p) => (
            <ColumnHead key={p.day} plan={p} today={today} onOpen={onOpen} />
          ))}
        </div>
      )}
      <div className={s.body}>
        <div className={s.gutter} aria-hidden>
          {labelled.map((h) => (
            <span key={h} style={{ "--at": at(h) } as CSSProperties}>
              {hourLabel(h)}
            </span>
          ))}
          {nowShown && (
            <span className={s.nowTag} style={{ "--at": at(minutes) } as CSSProperties}>
              {clock(minutes).slice(0, -3)}
            </span>
          )}
        </div>
        <div className={s.cols}>
          <div className={s.rules} aria-hidden>
            {hours.map((h) => (
              <i key={h} style={{ "--at": at(h) } as CSSProperties} />
            ))}
          </div>
          {plans.map((p, c) => (
            <Column key={p.day} plan={p} column={c} axis={axis} now={p.day === today ? minutes : null} view={view} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ColumnHead({ plan, today, onOpen }: { plan: DayPlan; today: string; onOpen: (day: string) => void }) {
  const date = dayDate(plan.day);
  const study = minutesOf(plan, "study");
  return (
    <button
      type="button"
      className={s.colHead}
      data-today={plan.day === today || undefined}
      onClick={() => onOpen(plan.day)}
      aria-label={`Open ${dayName(plan.day, today)}, ${date.toLocaleDateString("en-US", { month: "long", day: "numeric" })}`}
    >
      <span className={s.colDay}>
        <span className={s.colDow}>{date.toLocaleDateString("en-US", { weekday: "short" })}</span>
        <span className={s.colDate}>{date.getDate()}</span>
      </span>
      <span className={s.colNote} data-kind={plan.school ? "school" : "study"}>
        <Icon path={plan.school ? D.cap : D.book} size={12} />
        {plan.school ? (
          <>
            <span className={s.colLong}>{brief(plan.school.leave, plan.school.home)}</span>
            {/* A laptop's narrower columns drop AM and PM: school hours can't be mistaken. */}
            <span className={s.colShort}>{brief(plan.school.leave, plan.school.home).replace(/ [AP]M/g, "")}</span>
          </>
        ) : (
          <span>{study ? `${fmtMinutes(study)} study` : "No school"}</span>
        )}
      </span>
    </button>
  );
}

type BlockState = "past" | "now" | undefined;

function Column({
  plan,
  column,
  axis,
  now,
  view,
}: {
  plan: DayPlan;
  column: number;
  axis: { start: number; end: number };
  /** The minute it is, on today's column only. */
  now: number | null;
  view: View;
}) {
  const length = axis.end - axis.start;
  const at = (m: number) => (m - axis.start) / length;
  const stateOf = (start: number, stop: number): BlockState => (now === null || now < start ? undefined : now >= stop ? "past" : "now");
  // Weekends start later than the clock does; the morning they sleep in is drawn as sleep.
  const sleptIn = at(plan.wake);
  const night = nightAfter(plan.day);
  return (
    <div className={s.col} data-today={(now !== null && view === "week") || undefined}>
      {sleptIn > 0 && (
        <span className={s.asleep} aria-hidden style={{ "--top": 0, "--len": sleptIn } as CSSProperties}>
          Up at {clock(plan.wake)}
        </span>
      )}
      <ol className={s.blocks} aria-label={dayDate(plan.day).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}>
        {plan.blocks.map((b, i) => {
          const state = stateOf(b.start, b.end);
          const minutes = b.end - b.start;
          return (
            <li
              key={b.start}
              className={s.block}
              data-kind={b.kind}
              data-state={state}
              data-size={minutes <= 30 ? "s" : minutes < 60 ? "m" : minutes < 90 ? "l" : "xl"}
              aria-current={state === "now" ? "time" : undefined}
              style={
                {
                  "--top": at(b.start),
                  "--len": minutes / length,
                  "--i": column * 2 + i,
                  "--p": state === "now" ? (now! - b.start) / minutes : 0,
                } as CSSProperties
              }
            >
              {view === "day" && (
                <span className={s.blockIcon} aria-hidden>
                  <Icon path={KIND_ICON[b.kind]} size={15} />
                </span>
              )}
              <span className={s.blockText}>
                <span className={s.blockTitle}>{b.title}</span>
                <span className={s.blockTime}>{view === "week" ? brief(b.start, b.end) : span(b.start, b.end)}</span>
              </span>
              {/* A day on its own has room for the length on the right edge, or what's left of it. */}
              {view === "day" &&
                (state === "now" ? <span className={s.blockLeft}>{fmtMinutes(b.end - now!)} left</span> : <span className={s.blockLength}>{fmtMinutes(minutes)}</span>)}
            </li>
          );
        })}
      </ol>
      <span className={s.asleep} aria-hidden style={{ "--top": at(plan.sleep), "--len": (axis.end - plan.sleep) / length } as CSSProperties}>
        <Icon path={ICON.tonight} size={11} />
        {view === "week" ? "Sleep" : `Sleep at ${clock(night.sleep)}, up at ${clock(night.wake)}`}
      </span>
      {now !== null && now >= axis.start && now < axis.end && (
        <span className={s.nowLine} data-now-line aria-hidden style={{ "--top": at(now) } as CSSProperties} />
      )}
    </div>
  );
}
