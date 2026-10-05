"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";

import {
  addDays,
  clock,
  clockAt,
  dayDate,
  DAY_MINUTES,
  KIND_LABEL,
  momentAt,
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
 * Schedule: the student's day, hour by hour, and where the clock is in it.
 *
 * It opens on today: what's on now, how long it has left and what comes
 * next, above the whole day as a timeline that fills in as the hours pass.
 * The next six days are a tap away. One column on a phone; on a wider window
 * now and the day's split sit beside the timeline.
 */

/* ── icons (24×24, filled, in Slates' own style) ───────────────────────── */

const D = {
  sun: "M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zM11 1h2v3h-2zm0 19h2v3h-2zM1 11h3v2H1zm19 0h3v2h-3zM4.2 5.6l1.4-1.4 2.1 2.1-1.4 1.4zm12.1 12.1 1.4-1.4 2.1 2.1-1.4 1.4zM4.2 18.4l2.1-2.1 1.4 1.4-2.1 2.1zM16.3 6.3l2.1-2.1 1.4 1.4-2.1 2.1z",
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

/** Tall enough to read at 30 minutes, longer for longer blocks, capped so school doesn't swallow the page. */
const pillHeight = (minutes: number) => Math.round(Math.min(132, Math.max(44, minutes * 0.6)));

/* ── the room ──────────────────────────────────────────────────────────── */

export default function DayApp() {
  const { clear } = useMode();
  const { day: today, minutes } = clockAt(useMinute());
  const [picked, setPicked] = useState<string | null>(null);
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  // A picked day holds while it's still in the coming week; after that it's today again.
  const day = picked && week.includes(picked) ? picked : today;
  const isToday = day === today;
  const plan = planFor(day);

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
          <span className={s.spacer} />
          {!isToday && (
            <button type="button" className={s.todayBtn} onClick={() => setPicked(null)}>
              Back to today
            </button>
          )}
        </header>

        <div className={s.scroll}>
          <div className={s.page}>
            <div className={s.layout}>
              <div className={s.side}>
                <div className={s.head}>
                  <h1>{dayName(day, today)}</h1>
                  <p>
                    <span>{dateLine(day, today)}</span>
                    <span className={s.dayChip} data-kind={plan.school ? "school" : "free"}>
                      <Icon path={plan.school ? D.cap : D.spark} size={13} />
                      {plan.school ? `School ${span(plan.school.leave, plan.school.home)}` : "No school"}
                    </span>
                  </p>
                </div>
                <WeekStrip week={week} day={day} today={today} onPick={(d) => setPicked(d === today ? null : d)} />
                {isToday && <NowCard moment={momentAt(today, minutes)} />}
                <Split plan={plan} />
              </div>
              <Timeline key={day} plan={plan} minutes={isToday ? minutes : null} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WeekStrip({ week, day, today, onPick }: { week: string[]; day: string; today: string; onPick: (day: string) => void }) {
  return (
    <div className={s.week} role="group" aria-label="Pick a day">
      {week.map((d) => {
        const plan = planFor(d);
        const date = dayDate(d);
        return (
          <button
            key={d}
            type="button"
            className={s.weekDay}
            aria-pressed={d === day}
            data-today={d === today || undefined}
            aria-label={`${dayName(d, today)}, ${date.toLocaleDateString("en-US", { month: "long", day: "numeric" })}${plan.school ? ", school" : ""}`}
            onClick={() => onPick(d)}
          >
            <span className={s.weekName}>{date.toLocaleDateString("en-US", { weekday: "short" })}</span>
            <span className={s.weekDate}>{date.getDate()}</span>
            <span className={s.weekBar} aria-hidden>
              {plan.blocks.map((b, i) => (
                <span key={i} data-kind={b.kind} style={{ flexGrow: b.end - b.start }} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function NowCard({ moment }: { moment: Moment }) {
  const { block, next, progress, left } = moment;
  return (
    <section className={s.now} data-kind={block.kind} aria-label="Now">
      <div className={s.nowTop}>
        <div className={s.nowText}>
          <span className={s.eyebrow}>
            <span className={s.liveDot} aria-hidden />
            Now · {span(block.start, block.end)}
          </span>
          <h2 className={s.nowTitle}>{block.title}</h2>
        </div>
        <span className={s.badge} aria-hidden>
          <Icon path={KIND_ICON[block.kind]} size={24} />
        </span>
      </div>
      <div
        className={s.bar}
        role="progressbar"
        aria-label={`How far through ${block.title.toLowerCase()}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>
      <div className={s.barLegend}>
        <span>
          <b>{fmtMinutes(left)}</b> left
        </span>
        <span>{block.kind === "sleep" ? `Up at ${clock(block.end)}` : `Ends ${clock(block.end)}`}</span>
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

function Split({ plan }: { plan: DayPlan }) {
  return (
    <section className={s.split} aria-labelledby="day-split">
      <h2 id="day-split">How the day is split</h2>
      <div className={s.splitBar} aria-hidden>
        {plan.blocks.map((b, i) => (
          <span key={i} data-kind={b.kind} style={{ flexGrow: b.end - b.start }} />
        ))}
      </div>
      <ul className={s.splitList}>
        {splitOf(plan).map(({ kind, minutes }) => (
          <li key={kind} data-kind={kind}>
            <i aria-hidden />
            <span>{KIND_LABEL[kind]}</span>
            <b>{fmtMinutes(minutes)}</b>
          </li>
        ))}
      </ul>
    </section>
  );
}

type RowState = "past" | "now" | undefined;

/** The day top to bottom. On today, what's done steps back and the block the clock is in fills as it goes. */
function Timeline({ plan, minutes }: { plan: DayPlan; minutes: number | null }) {
  const list = useRef<HTMLOListElement>(null);
  const stateOf = (start: number, end: number): RowState => (minutes === null || minutes < start ? undefined : minutes >= end ? "past" : "now");
  const upNext = planFor(addDays(plan.day, 1)).wake;

  // On a wide window the timeline sits beside the now card, so the current block is brought into view when
  // it opens below the fold. A phone shows the now card first and stays at the top.
  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>('[aria-current="time"]');
    if (!row || !window.matchMedia("(min-width: 900px)").matches) return;
    const { top, bottom } = row.getBoundingClientRect();
    if (top < 0 || bottom > window.innerHeight) row.scrollIntoView({ block: "center" });
  }, []);

  const marker = (i: number, kind: string, time: number, icon: string, title: string, state: RowState, meta?: string) => (
    <li
      className={`${s.row} ${s.marker}`}
      data-kind={kind}
      data-state={state}
      aria-current={state === "now" ? "time" : undefined}
      style={{ "--i": i } as CSSProperties}
    >
      <span className={s.time}>{clock(time)}</span>
      <span className={s.pill} aria-hidden>
        <Icon path={icon} size={18} />
      </span>
      <span className={s.body}>
        <span className={s.title}>
          {title}
          {state === "now" && <span className={s.nowChip}>Now</span>}
        </span>
        {meta && <span className={s.meta}>{meta}</span>}
      </span>
    </li>
  );

  return (
    <ol ref={list} className={s.timeline} aria-label={`${dayDate(plan.day).toLocaleDateString("en-US", { weekday: "long" })}, hour by hour`}>
      {marker(0, "wake", plan.wake, D.sun, "Wake up", minutes !== null && minutes >= plan.wake ? "past" : undefined)}
      {plan.blocks.map((b, i) => {
        const state = stateOf(b.start, b.end);
        const length = b.end - b.start;
        const progress = state === "now" ? (minutes! - b.start) / length : 0;
        return (
          <li
            key={b.start}
            className={s.row}
            data-kind={b.kind}
            data-state={state}
            aria-current={state === "now" ? "time" : undefined}
            style={{ "--i": i + 1, "--h": `${pillHeight(length)}px`, "--p": progress } as CSSProperties}
          >
            <span className={s.time}>{clock(b.start)}</span>
            <span className={s.pill} aria-hidden>
              <span className={s.fill} />
              <Icon path={KIND_ICON[b.kind]} size={18} />
            </span>
            <span className={s.body}>
              <span className={s.title}>
                {b.title}
                {state === "now" && <span className={s.nowChip}>Now</span>}
              </span>
              <span className={s.meta}>
                {state === "now" ? `${fmtMinutes(b.end - minutes!)} left` : fmtMinutes(length)}
                {b.kind === "school" && ` · home by ${clock(b.end)}`}
              </span>
            </span>
          </li>
        );
      })}
      {marker(plan.blocks.length + 1, "sleep", plan.sleep, ICON.tonight, "Sleep", stateOf(plan.sleep, DAY_MINUTES), `Up at ${clock(upNext)}`)}
    </ol>
  );
}
