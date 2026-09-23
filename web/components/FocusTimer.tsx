"use client";

import { useEffect, useRef } from "react";

import { fmtMinutes } from "@/lib/format";
import MathHtml from "./MathHtml";
import MathText from "./MathText";
import { Icon, ICON } from "./ui";

/**
 * The timer, full screen.
 *
 * A stopwatch in the corner of a card is a thing you forget is running. Given
 * the whole window it becomes the thing you are doing, which is the point of
 * starting it — and there is nothing else on screen to drift into.
 *
 * The ring fills toward the estimate Slates already holds for the assignment,
 * so the clock means something: two thirds round is two thirds of the time you
 * expected this to take. Past the estimate it keeps counting and turns red
 * rather than stopping or resetting, because running over is information, not
 * a failure state — and hiding it would make the estimate useless.
 *
 * The seconds are not animated. A digit that eases into place is a digit you
 * cannot read at a glance, and this is a clock.
 */

/** Where the ring turns amber, as a fraction of the estimate. */
const WARN_AT = 0.8;

export interface FocusTimerProps {
  title: string;
  course?: string;
  /** The teacher's write-up as markup, when the scraper kept it. */
  briefHtml?: string | null;
  /** The plain-text write-up, whose line breaks are its only structure. */
  brief?: string | null;
  /** Accumulated milliseconds. */
  elapsed: number;
  /** The estimate in minutes, when the assignment carries one. */
  estimateMinutes?: number | null;
  running: boolean;
  onToggle: () => void;
  onReset: () => void;
  onClose: () => void;
}

/** Hours only when there are hours — a leading 0: reads as broken. */
function clock(ms: number): { main: string; seconds: string } {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return { main: h ? `${h}:${pad(m)}` : String(m), seconds: pad(s) };
}

export default function FocusTimer({
  title,
  course,
  briefHtml,
  brief,
  elapsed,
  estimateMinutes,
  running,
  onToggle,
  onReset,
  onClose,
}: FocusTimerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  /*
   * Space toggles and Escape leaves, because a full-screen clock is a keyboard
   * surface — reaching for the mouse to pause is the one thing you do while
   * your hands are already on the desk. Space is swallowed only when the
   * focus is not on a button, or it would fire twice.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === " " && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        onToggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onToggle, onClose]);

  // Focus lands on Close so Escape is not the only way out for a keyboard.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const estimateMs = estimateMinutes ? estimateMinutes * 60_000 : null;
  const fraction = estimateMs ? elapsed / estimateMs : 0;
  const over = estimateMs != null && elapsed > estimateMs;
  const warn = !over && fraction >= WARN_AT;

  const { main, seconds } = clock(elapsed);

  /*
   * The ring is one stroke-dashoffset on a circle. Past the estimate it stays
   * full rather than wrapping a second time — a ring on its second lap reads
   * as "nearly done" when it means the opposite.
   */
  const RADIUS = 132;
  const circumference = 2 * Math.PI * RADIUS;
  const swept = estimateMs ? Math.min(1, Math.max(0, fraction)) : 0;

  const tone = over ? "over" : warn ? "warn" : "on";

  return (
    <div className={`focus focus--${tone}`} role="dialog" aria-modal="true" aria-label={`Timer for ${title}`}>
      <div className="focus-head">
        <div style={{ minWidth: 0 }}>
          <p className="focus-eyebrow">{running ? "Timing now" : elapsed ? "Paused" : "Ready"}</p>
          {/* Wraps rather than truncating. On a maths assignment the problem
              numbers *are* the instructions — "Pg. 632 # 19, 34, 41…" ending
              in an ellipsis is the one thing you needed on screen. */}
          <h1 className="focus-title">{title}</h1>
          {course && <p className="focus-course">{course}</p>}
        </div>
        <button ref={closeRef} type="button" className="focus-close" onClick={onClose} aria-label="Close timer">
          <Icon path={ICON.close} size={16} />
        </button>
      </div>

      <div className="focus-stage">
        <div className="focus-dial">
          <svg viewBox="0 0 300 300" aria-hidden>
            {/* The track, and the arc over it. Rotated so zero is at the top. */}
            <circle className="focus-track" cx="150" cy="150" r={RADIUS} />
            {/* Hidden at the very start: a round cap on a zero-length arc
                draws a single dot at twelve o'clock that reads as a speck of
                dust on the screen. */}
            {swept > 0.002 && (
              <circle
                className="focus-arc"
                cx="150"
                cy="150"
                r={RADIUS}
                style={{
                  strokeDasharray: circumference,
                  strokeDashoffset: circumference * (1 - swept),
                }}
              />
            )}
          </svg>

          <div className="focus-readout">
            <span className="focus-time tabular" aria-live="off">
              {main}
              <span className="focus-seconds">:{seconds}</span>
            </span>
            <span className="focus-of">
              {estimateMinutes
                ? over
                  ? `over ${fmtMinutes(estimateMinutes)}`
                  : `of ${fmtMinutes(estimateMinutes)}`
                : "no estimate"}
            </span>
          </div>
        </div>
      </div>

      {/* The write-up, under the clock. The point of a full-screen timer is
          that there is nothing else to look at — so what you are meant to be
          doing has to be one of the things on it, or you leave to go and read
          it and the screen has defeated itself. Scrolls on its own when the
          teacher wrote an essay, so it can never push the dial off. */}
      {(briefHtml || brief) && (
        <div className="focus-brief">
          {briefHtml ? (
            <MathHtml className="prose prose--tight" html={briefHtml} />
          ) : (
            <div className="prose prose--plain prose--tight">
              <MathText text={brief ?? ""} />
            </div>
          )}
        </div>
      )}

      <div className="focus-controls">
        <button type="button" className="focus-btn" onClick={onReset} disabled={!elapsed && !running}>
          <Icon path={ICON.retry} size={15} />
          Reset
        </button>

        <button type="button" className="focus-btn focus-btn--primary" onClick={onToggle}>
          <Icon path={running ? ICON.stop : ICON.clockFace} size={15} />
          {running ? "Pause" : elapsed ? "Resume" : "Start"}
        </button>

        <button type="button" className="focus-btn" onClick={onClose}>
          Done
        </button>
      </div>

      <p className="focus-hint">Space to {running ? "pause" : "start"} · Esc to close</p>
    </div>
  );
}
