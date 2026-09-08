"use client";

import { useState } from "react";

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
  /** Derived from the due date, so cards leave it but never arrive by hand. */
  derived?: boolean;
  /** Hidden entirely when empty, rather than showing an empty-state card. */
  hideWhenEmpty?: boolean;
}> = [
  // Past due, and first because that's the order you should read the board in.
  // Not a drop target: "overdue" is a fact about the date, and letting a card
  // be dragged in would let the board claim something is late when it isn't.
  {
    key: "overdue",
    name: "Overdue",
    tone: "oklch(0.72 0.16 25)",
    empty: "Nothing overdue.",
    actions: true,
    derived: true,
    /*
     * The other columns are the shape of the plan and stay put even when
     * empty — "Nothing left today" is worth reading. Overdue is an exception
     * state, and a permanent empty one both takes a fifth of the board and
     * makes "nothing is late" look like a thing to keep checking.
     */
    hideWhenEmpty: true,
  },
  // The bucket key stays `tonight` — it's the internal name the estimator and
  // the stored placements both use, and renaming it would strip every card a
  // student has already dragged into this column.
  { key: "tonight", name: "Today", tone: "oklch(0.82 0.14 250)", empty: "Nothing left today.", ordered: true, actions: true },
  { key: "soon", name: "Tomorrow", tone: "oklch(0.76 0.13 75)", empty: "Nothing waiting for tomorrow." },
  { key: "week", name: "Later", tone: "oklch(0.72 0 0)", empty: "Nothing further out." },
  { key: "done", name: "Turned in", tone: "oklch(0.72 0.13 145)", empty: "Nothing turned in yet." },
];

export function AssignmentCard({
  a,
  index,
  ordered,
  showActions,
  onDragStart,
  onDragEnd,
  dragging,
}: {
  a: Assignment;
  index: number;
  ordered?: boolean;
  showActions?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  dragging?: boolean;
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
  /*
   * Work Schoology already has can't be replanned, so it doesn't offer a grab
   * handle it would only refuse to honour. Everything else — including work you
   * ticked off here — can be dragged back into the plan.
   */
  const movable = a.bucket !== "done";

  return (
    <div
      draggable={movable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", a.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart?.();
      }}
      onDragEnd={() => onDragEnd?.()}
      style={{
        borderRadius: 20,
        border: `1px solid ${active ? "oklch(0.907 0 0 / 0.15)" : "var(--line)"}`,
        background: "var(--surface)",
        boxShadow: "var(--shadow-card)",
        opacity: dragging ? 0.4 : done ? 0.6 : 1,
        cursor: movable ? "grab" : "default",
        transition: "opacity 120ms ease",
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
          {done
            ? nothingToSubmit
              ? "Marked done"
              : "Turned in"
            : active
              ? `Started · ${a.start ?? "now"}`
              : a.due}
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
  /* The card in hand, and the column currently under it. */
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Bucket | null>(null);

  const activeId = s.snapshot.assignments.find(
    (a) => s.bucketOf(a) === "tonight" && s.statusOf(a) === "active"
  )?.id;

  const drop = (to: Bucket) => (e: React.DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || dragging;
    if (id) s.moveTo(id, to);
    setDragging(null);
    setOver(null);
  };

  /*
   * `onBoard` drops what the Sunday sweep retired — finished and past-due work
   * from previous weeks, still findable everywhere else. Hoisted out of the
   * column loop because the column count depends on it now.
   */
  const live = s.snapshot.assignments.filter((a) => s.onBoard(a));
  const columns = COLUMNS.map((col) => ({
    col,
    items:
      col.key === "done"
        ? live.filter((a) => s.statusOf(a) === "done")
        : live.filter((a) => s.bucketOf(a) === col.key && s.statusOf(a) !== "done"),
  })).filter(({ col, items }) => items.length || !col.hideWhenEmpty);

  return (
    <div className="scroll">
      <div
        className="board-grid"
        style={{
          display: "grid",
          /*
           * Always one row. `auto-fit` with a 260px minimum wrapped the fifth
           * column onto its own line the moment Overdue was added — on a 14"
           * screen "Turned in" dropped below the fold and the board stopped
           * reading left-to-right as a timeline. Columns share the width
           * instead, and `minmax(0, …)` is what actually lets them shrink:
           * grid items default to min-content, which would refuse to.
           */
          gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`,
          gap: 12,
          alignItems: "start",
        }}
      >
        {columns.map(({ col, items }) => {
          const minutes = items.reduce((acc, a) => acc + a.minutes, 0);
          const target = over === col.key;

          return (
            <div
              className="board-column"
              key={col.key}
              onDragOver={(e) => {
                if (!dragging || col.derived) return;
                // Without this the browser refuses the drop outright.
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (over !== col.key) setOver(col.key);
              }}
              onDragLeave={(e) => {
                // Moving between a column's own children fires dragleave too;
                // only clear when the pointer has actually left the column.
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                setOver((prev) => (prev === col.key ? null : prev));
              }}
              onDrop={col.derived ? undefined : drop(col.key)}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                minWidth: 0,
                borderRadius: "var(--radius-xl)",
                border: `1px solid ${target ? col.tone : "var(--line)"}`,
                background: target ? "var(--surface)" : "var(--surface-soft)",
                padding: 14,
                boxShadow: target
                  ? `inset 0 0 0 1px ${col.tone}, var(--shadow-card)`
                  : "inset 0 1px 0 oklch(1 0 0 / 0.05)",
                transition: "background 120ms ease, border-color 120ms ease",
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
                  dragging={dragging === a.id}
                  onDragStart={() => setDragging(a.id)}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                />
              ))}

              {items.length === 0 && (
                <div
                  style={{
                    borderRadius: 20,
                    border: `1px dashed ${target ? col.tone : "var(--line-strong)"}`,
                    padding: "18px 14px",
                    textAlign: "center",
                    fontSize: 12,
                    color: "var(--muted)",
                  }}
                >
                  {target ? "Drop to move it here." : col.empty}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
