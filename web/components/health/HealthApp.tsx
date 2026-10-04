"use client";

import { useEffect, useRef, useState } from "react";

import { useMode } from "@/lib/mode";
import { streak } from "@/lib/health/nutrition";
import { Icon, ICON } from "../ui";
import F45View from "./F45View";
import s from "./health.module.css";
import MeView from "./MeView";
import Onboarding from "./Onboarding";
import { dayLabel, H, HIcon } from "./parts";
import ProgressView from "./ProgressView";
import { AddMenu, ExerciseSheet, FoodSheet, WeightSheet, type ExerciseStart, type FoodStart } from "./Sheets";
import TodayView from "./TodayView";
import { CAMERA_BLOCKED, useF45, useHealth, useToday } from "./useHealth";

/**
 * Health: calories and macros, workouts, weight, and the student's F45 studio.
 *
 * CalAi's calorie tracker, rebuilt as a Slates room so it lives on the host
 * and opens the same on the iPhone app and the Mac. A phone gets a tab bar
 * and a + within thumb reach; a wider window gets the same views side by side.
 */

type Tab = "today" | "f45" | "progress" | "me";

type Open = { kind: "add" } | { kind: "food"; start: FoodStart } | { kind: "exercise"; start: ExerciseStart } | { kind: "weight" } | null;

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "today", label: "Today", icon: H.ring },
  { id: "f45", label: "F45", icon: H.dumbbell },
  { id: "progress", label: "Progress", icon: ICON.grades },
  { id: "me", label: "Me", icon: H.person },
];

const TAB_KEY = "slates.health.tab.v1";

function savedTab(): Tab {
  try {
    const saved = window.sessionStorage.getItem(TAB_KEY);
    return TABS.some((t) => t.id === saved) ? (saved as Tab) : "today";
  } catch {
    return "today";
  }
}

export default function HealthApp() {
  const { clear, openSettings } = useMode();
  const health = useHealth();
  const today = useToday();
  const [tab, setTabState] = useState<Tab>(savedTab);
  const [picked, setPicked] = useState<string | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const state = health.state;
  const f45 = useF45(state?.profile.setUp ? state.profile.studio : null);
  // A day picked in the past holds; "today" follows the clock past midnight.
  const day = picked && picked < today ? picked : today;
  const close = () => setOpen(null);

  const setTab = (next: Tab) => {
    // Each tab opens at its top, not wherever the last one was scrolled to.
    scroller.current?.scrollTo({ top: 0 });
    setTabState(next);
    try {
      window.sessionStorage.setItem(TAB_KEY, next);
    } catch {
      /* the tab just won't be remembered */
    }
  };

  // The traffic lights sit over the header's left end in the desktop shell.
  useEffect(() => {
    if (navigator.userAgent.includes("Electron")) document.documentElement.dataset.desktop = "1";
  }, []);

  const { notice, clearNotice } = health;
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(clearNotice, 6000);
    return () => window.clearTimeout(timer);
  }, [notice, clearNotice]);

  if (!state) {
    return (
      <div className={`shell ui-mode ${s.app}`}>
        <div className="main">
          <header className={`ui-top ${s.top}`}>
            <button type="button" className="ui-back" onClick={clear} aria-label="Back to Slates">
              <Icon path={ICON.chevronLeft} size={13} /> Slates
            </button>
            <span className="ui-top-title">Health</span>
          </header>
          <div className={s.scroll}>
            <div className={s.page}>
              {health.loadError ? (
                <section className={`${s.card} ${s.empty}`} role="alert">
                  <p className={s.emptyTitle}>Health didn’t load</p>
                  <p className={s.emptyText}>{health.loadError}</p>
                  <div className={s.emptyActions}>
                    <button type="button" className={s.secondaryBtn} onClick={() => void health.refresh()}>
                      Try again
                    </button>
                  </div>
                </section>
              ) : (
                <div className={s.stack} aria-busy="true">
                  <div className={`${s.card} ${s.skeleton}`} style={{ height: 80 }} />
                  <div className={`${s.card} ${s.skeleton}`} style={{ height: 150 }} />
                  <div className={`${s.card} ${s.skeleton}`} style={{ height: 150 }} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!state.profile.setUp) return <Onboarding health={health} profile={state.profile} today={today} />;

  const schedule = f45.schedule;
  const f45Day = schedule?.days.find((d) => d.date === day);
  const runs = streak(state, today);
  const photo = (file: File) => setOpen({ kind: "food", start: { mode: "photo", file } });

  let view: React.ReactNode;
  if (tab === "f45") {
    view = (
      <F45View
        schedule={schedule}
        error={f45.error}
        state={state}
        today={today}
        onRefresh={() => void f45.refresh()}
        onLog={(d) => setOpen({ kind: "exercise", start: { mode: "f45", day: d } })}
        onExercise={(entry) => setOpen({ kind: "exercise", start: { mode: "edit", entry } })}
      />
    );
  } else if (tab === "progress") {
    view = <ProgressView state={state} today={today} onWeigh={() => setOpen({ kind: "weight" })} />;
  } else if (tab === "me") {
    view = <MeView health={health} profile={state.profile} today={today} studio={schedule?.studio ?? null} onWeigh={() => setOpen({ kind: "weight" })} />;
  } else {
    view = (
      <TodayView
        health={health}
        state={state}
        today={today}
        day={day}
        setDay={(d) => setPicked(d === today ? null : d)}
        schedule={schedule}
        onFood={(entry) => setOpen({ kind: "food", start: { mode: "edit", entry } })}
        onExercise={(entry) => setOpen({ kind: "exercise", start: { mode: "edit", entry } })}
        onLogClass={(d) => setOpen({ kind: "exercise", start: { mode: "f45", day: d } })}
        onScan={photo}
        onDescribe={() => setOpen({ kind: "food", start: { mode: "describe" } })}
      />
    );
  }

  return (
    <div className={`shell ui-mode ${s.app}`}>
      <div className="main">
        <header className={`ui-top ${s.top}`}>
          <button type="button" className="ui-back" onClick={clear} aria-label="Back to Slates">
            <Icon path={ICON.chevronLeft} size={13} /> Slates
          </button>
          <span className="ui-top-title">Health</span>
          <nav className={s.topTabs} aria-label="Health">
            {TABS.map((t) => (
              <button key={t.id} type="button" aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
          <span className={s.topSpacer} />
          <span className={s.streakPill} title={`${runs}-day logging streak`} aria-label={`${runs}-day logging streak`}>
            <HIcon path={H.flame} size={14} />
            {runs}
          </span>
          <button type="button" className={s.topAdd} onClick={() => setOpen({ kind: "add" })}>
            <Icon path={ICON.plus} size={14} /> Log
          </button>
          <button type="button" className={`ui-back ${s.topSettings}`} onClick={openSettings} aria-label="Settings">
            <Icon path={ICON.settings} size={13} /> Settings
          </button>
        </header>

        <div className={s.scroll} ref={scroller}>
          <div className={s.page} key={tab}>
            {view}
          </div>
        </div>
      </div>

      <nav className={s.tabbar} aria-label="Health">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={s.tabItem} aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
            <span className={s.tabIcon}>
              <HIcon path={t.icon} size={19} />
            </span>
            <span>{t.label}</span>
          </button>
        ))}
        <button type="button" className={s.fab} onClick={() => setOpen({ kind: "add" })} aria-label="Log food, a workout or weight">
          <Icon path={ICON.plus} size={26} />
        </button>
      </nav>

      {open?.kind === "add" && (
        <AddMenu
          onClose={close}
          onPhoto={photo}
          onDescribe={() => setOpen({ kind: "food", start: { mode: "describe" } })}
          onSearch={() => setOpen({ kind: "food", start: { mode: "search" } })}
          onManual={() => setOpen({ kind: "food", start: { mode: "manual" } })}
          onF45={() => setOpen({ kind: "exercise", start: { mode: "f45", day } })}
          onExercise={() => setOpen({ kind: "exercise", start: { mode: "other" } })}
          onWeigh={() => setOpen({ kind: "weight" })}
          f45={f45Day}
          when={day === today ? null : dayLabel(day, today)}
          onBlocked={() => {
            setOpen(null);
            health.notify(CAMERA_BLOCKED);
          }}
        />
      )}
      {open?.kind === "food" && <FoodSheet start={open.start} day={day} today={today} state={state} health={health} onClose={close} />}
      {open?.kind === "exercise" && <ExerciseSheet start={open.start} day={day} today={today} state={state} schedule={schedule} health={health} onClose={close} />}
      {open?.kind === "weight" && <WeightSheet state={state} today={today} health={health} onClose={close} />}

      {notice && (
        <div className={s.toast} role="status">
          <span>{notice}</span>
          <button type="button" onClick={clearNotice}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
