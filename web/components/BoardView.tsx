"use client";

import { useMemo } from "react";

import { IMPACT_LABEL, useStore } from "@/lib/store";
import { fmtMinutes } from "@/lib/format";
import type { Assignment, Bucket } from "@/lib/types";
import { Badge, ClockIcon, Dot } from "./ui";

const COLUMNS: Array<{
  key: Bucket;
  name: string;
  tone: string;
  empty: string;
  ordered?: boolean;
  actions?: boolean;
}> = [
  { key: "tonight", name: "Tonight", tone: "oklch(0.82 0.14 250)", empty: "Nothing left tonight.", ordered: true, actions: true },
  { key: "soon", name: "Next up", tone: "oklch(0.76 0.13 75)", empty: "Clear through Wednesday." },
  { key: "week", name: "This week", tone: "oklch(0.72 0 0)", empty: "Nothing further out." },
  { key: "done", name: "Turned in", tone: "oklch(0.72 0.13 145)", empty: "Nothing turned in yet." },
];

export function AssignmentCard({
  a,
  index,
  ordered,
  showActions,
}: {
  a: Assignment;
  index: number;
  ordered?: boolean;
  showActions?: boolean;
}) {
  const s = useStore();
  const course = s.courseById(a.courseId);
  const status = s.statusOf(a);
  const done = status === "done";
  const active = status === "active";
  const impact = IMPACT_LABEL[a.impact];
  const overlay = a.submit === "overlay";
  // Nothing to hand in: "Start" then "Mark done" is two clicks for a checkbox.
  const nothingToSubmit = a.submit === "none";

  return (
    <div
      style={{
        borderRadius: 20,
        border: `1px solid ${active ? "oklch(0.907 0 0 / 0.15)" : "var(--line)"}`,
        background: "var(--surface)",
        boxShadow: "var(--shadow-card)",
        opacity: done ? 0.6 : 1,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          {ordered && (
            <span
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 20,
                height: 20,
                flexShrink: 0,
                marginTop: 1,
                borderRadius: 9999,
                background: "var(--sunken)",
                color: "var(--text-2)",
                fontSize: 11,
                fontWeight: 600,
                boxShadow: "var(--shadow-sunken)",
              }}
            >
              {index + 1}
            </span>
          )}
          <button
            type="button"
            onClick={() => s.openAssignment(a.id)}
            style={{
              display: "block",
              width: "100%",
              border: 0,
              background: "transparent",
              padding: 0,
              margin: 0,
              textAlign: "left",
              cursor: "pointer",
              font: "inherit",
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 500,
                lineHeight: 1.375,
                letterSpacing: "-0.01em",
                color: done ? "var(--muted)" : "var(--text)",
                textDecoration: done ? "line-through" : undefined,
              }}
            >
              {a.title}
            </p>
          </button>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          {course && <Badge tone={course.tone}>{course.short}</Badge>}
          <Badge tone={done ? "success" : impact.tone}>{done ? "Turned in" : impact.label}</Badge>
          {overlay && !done && <Badge tone="speed">Opens in Schoology</Badge>}
          {!done && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--muted)" }}>
              <ClockIcon />
              {fmtMinutes(a.minutes)}
            </span>
          )}
        </div>

        {ordered && !done && a.impactNote && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", lineHeight: 1.4 }}>{a.impactNote}</p>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          borderTop: "1px solid var(--line)",
          padding: "8px 14px",
        }}
      >
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {done ? a.due : active ? `Started · ${a.start ?? "now"}` : a.due}
        </span>
        <span className="tabular" style={{ fontSize: 12, color: "var(--muted)", letterSpacing: "0.02em" }}>
          {a.code}
        </span>
      </div>

      {/*
        Cards normally show actions only when focused, to keep the board quiet.
        But work with nothing to hand in has exactly one useful interaction —
        ticking it off — and burying that behind Details made it unreachable for
        every card except the focused one.
      */}
      {(showActions || nothingToSubmit) && !done && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderTop: "1px solid var(--line)" }}>
          <button
            type="button"
            className="strip"
            onClick={() =>
              overlay
                ? s.openOverlay(a.id)
                : s.setStatus(a.id, nothingToSubmit || active ? "done" : "active")
            }
            style={{
              color: active ? "var(--good)" : "var(--text)",
              borderRight: "1px solid var(--line)",
            }}
          >
            {overlay ? "Open in Schoology" : nothingToSubmit || active ? "Mark done" : "Start"}
          </button>
          <button type="button" className="strip" onClick={() => s.openAssignment(a.id)}>
            Details
          </button>
        </div>
      )}
    </div>
  );
}

export default function BoardView() {
  const s = useStore();

  const filtered = useMemo(() => {
    const q = s.query.trim().toLowerCase();
    if (!q) return s.snapshot.assignments;
    return s.snapshot.assignments.filter((a) => {
      const c = s.courseById(a.courseId);
      return (
        a.title.toLowerCase().includes(q) ||
        (c?.short.toLowerCase().includes(q) ?? false)
      );
    });
  }, [s]);

  const activeId = filtered.find(
    (a) => a.bucket === "tonight" && s.statusOf(a) === "active"
  )?.id;

  return (
    <div className="scroll">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 16,
          alignItems: "start",
        }}
      >
        {COLUMNS.map((col) => {
          const items =
            col.key === "done"
              ? filtered.filter((a) => s.statusOf(a) === "done")
              : filtered.filter((a) => a.bucket === col.key && s.statusOf(a) !== "done");
          const minutes = items.reduce((acc, a) => acc + a.minutes, 0);

          return (
            <div
              key={col.key}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                minWidth: 0,
                borderRadius: "var(--radius-xl)",
                border: "1px solid var(--line)",
                background: "var(--surface-soft)",
                padding: 14,
                boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.05)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 4px" }}>
                <Dot color={col.tone} size={10} radius={3} />
                <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>{col.name}</span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    borderRadius: 9999,
                    padding: "1px 8px",
                    fontSize: 11,
                    fontWeight: 500,
                    background: "var(--sunken)",
                    color: "var(--text-2)",
                    border: "1px solid var(--line)",
                  }}
                >
                  {items.length}
                </span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  {col.key === "done" ? "" : fmtMinutes(minutes)}
                </span>
              </div>

              {items.map((a, i) => (
                <AssignmentCard
                  key={a.id}
                  a={a}
                  index={i}
                  ordered={col.ordered}
                  showActions={col.actions && (a.id === activeId || (!activeId && i === 0))}
                />
              ))}

              {items.length === 0 && (
                <div
                  style={{
                    borderRadius: 20,
                    border: "1px dashed var(--line-strong)",
                    padding: "18px 14px",
                    textAlign: "center",
                    fontSize: 12,
                    color: "var(--muted)",
                  }}
                >
                  {col.empty}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
