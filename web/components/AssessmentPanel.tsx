"use client";

import { useEffect, useState } from "react";

import { useStore } from "@/lib/store";
import { fmtClock } from "@/lib/format";
import { Badge, Icon, ICON } from "./ui";
import SchoologyFrame from "./SchoologyFrame";
import type { Assignment } from "@/lib/types";

/**
 * Schoology's assessment player, surfaced honestly.
 *
 * Slates cannot host the attempt: Schoology runs the questions, the clock, and
 * the grading server-side. What it can do is show the configuration up front —
 * time limit, attempts, window, LockDown requirement — none of which Schoology
 * displays until you have already committed to starting, and then hand over
 * while mirroring the clock.
 */
export default function AssessmentPanel({ a }: { a: Assignment }) {
  const s = useStore();
  const q = a.assessment;

  const startedAt = s.attempts[a.id];
  const limitMs = (q?.timeLimitMin ?? 0) * 60_000;
  const running = Boolean(startedAt && limitMs);

  const [embedded, setEmbedded] = useState(false);

  // Only tick while a countdown is actually on screen.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [running]);

  if (!q) return null;

  const remaining = running ? Math.max(0, startedAt + limitMs - now) : 0;
  const expired = running && remaining === 0;

  // Reasons Slates should not pretend an attempt can start.
  const blocker = q.lockdown
    ? {
        title: "Needs LockDown Browser",
        body: "Your teacher requires Respondus LockDown Browser for this one. It can't run in Slates or in a normal browser tab — open it from LockDown Browser instead.",
      }
    : !q.open
      ? {
          title: "Not accepting attempts",
          body: "Schoology has this closed right now. It'll open when your teacher makes it available.",
        }
      : q.attemptsLeft === 0
        ? { title: "No attempts left", body: "You've used every attempt Schoology allows here." }
        : null;

  const facts: Array<[string, string]> = [
    ["Time limit", q.timeLimitMin ? `${q.timeLimitMin} min` : "Untimed"],
    [
      "Attempts",
      q.attemptsLeft === null
        ? "Unlimited"
        : `${q.attemptsLeft} left of ${a.attemptsAllowed ?? q.attemptsLeft}`,
    ],
    ["Points", q.questionPoints != null ? `${q.questionPoints}` : "—"],
    ["Closes", q.closesAt ? new Date(q.closesAt).toLocaleString([], {
      weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    }) : "No close date"],
  ];

  return (
    <div
      style={{
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--line)",
        background: "var(--sunken)",
        padding: "18px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="section-label">
          {q.timeLimitMin ? "Timed assessment" : "Assessment"}
        </span>
        {q.lockdown && <Badge tone="danger">LockDown Browser</Badge>}
        {q.passwordRequired && <Badge tone="warning">Password</Badge>}
        {q.overdue && <Badge tone="warning">Overdue</Badge>}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(112px, 1fr))",
          gap: 12,
        }}
      >
        {facts.map(([label, value]) => (
          <div key={label} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.02em" }}>
              {label}
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{value}</span>
          </div>
        ))}
      </div>

      {running && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 14px",
            borderRadius: "var(--radius-sm)",
            border: `1px solid ${expired ? "var(--bad)" : "var(--line)"}`,
            background: "var(--raised)",
          }}
        >
          <span
            className="tabular"
            style={{
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: expired ? "var(--bad)" : "var(--text)",
              lineHeight: 1,
            }}
          >
            {fmtClock(remaining)}
          </span>
          <span style={{ flex: 1, fontSize: 12, color: "var(--muted)", lineHeight: 1.45 }}>
            {expired
              ? "Your time limit is up by Slates' count. Schoology's own clock is the one that decides."
              : "Counting down from when you opened it here. Schoology runs the real clock — treat this as a nudge, not the authority."}
          </span>
          <button
            type="button"
            className="btn"
            style={{ height: 30, flexShrink: 0 }}
            onClick={() => s.clearAttempt(a.id)}
          >
            Done
          </button>
        </div>
      )}

      {blocker ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
            {blocker.title}
          </span>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--text-2)" }}>
            {blocker.body}
          </p>
        </div>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--text-2)" }}>
            {q.timeLimitMin
              ? `Schoology runs this attempt and its ${q.timeLimitMin}-minute timer. Slates opens the player and counts down alongside it.`
              : "Schoology runs this attempt. Slates opens the player for you."}
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn--primary"
              style={{ height: 36 }}
              onClick={() => {
                if (q.timeLimitMin) s.startClock(a.id);
                setEmbedded(true);
              }}
            >
              {q.resumable ? "Resume here" : running ? "Reopen here" : "Take it here"}
            </button>
            <button
              type="button"
              className="btn"
              style={{ height: 36 }}
              onClick={() => void s.openOverlay(a.id)}
            >
              <Icon path={ICON.external} size={14} />
              Open in Schoology
            </button>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", lineHeight: 1.45 }}>
            Taking it here streams the real Schoology page from the browser Slates
            already has signed in. If anything looks wrong mid-attempt, open it in a
            tab — the attempt is the same one either way.
          </p>
        </>
      )}

      {embedded && (
        <SchoologyFrame
          url={a.url}
          onClose={() => setEmbedded(false)}
          onFinished={() => {
            // Schoology took the attempt — stop the companion clock and tick it
            // off without waiting for the next background crawl.
            s.setStatus(a.id, "done");
            s.clearAttempt(a.id);
            void s.resync();
          }}
        />
      )}
    </div>
  );
}
