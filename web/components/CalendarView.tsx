"use client";

import { useMemo, useState } from "react";

import { IMPACT_LABEL, useStore } from "@/lib/store";
import { dateFromOffset, fmtMinutes } from "@/lib/format";
import { Badge, Dot } from "./ui";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

export default function CalendarView() {
  const s = useStore();
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  const { weeks, monthCount, monthLabel, yearLabel, dated } = useMemo(() => {
    const now = new Date();
    const base = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const y = base.getFullYear();
    const m = base.getMonth();
    const firstDow = new Date(y, m, 1).getDay();
    const start = new Date(y, m, 1 - firstDow);
    const todayStr = now.toDateString();

    const dated = s.snapshot.assignments.flatMap((a) =>
      a.dateOffset === null ? [] : [{ a, date: dateFromOffset(a.dateOffset) }]
    );

    let count = 0;
    const weeks: Array<
      Array<{
        key: string;
        dayNum: string;
        inMonth: boolean;
        isToday: boolean;
        items: typeof dated;
      }>
    > = [];

    for (let w = 0; w < 6; w++) {
      const days = [];
      for (let i = 0; i < 7; i++) {
        const cell = new Date(start);
        cell.setDate(start.getDate() + w * 7 + i);
        const key = cell.toDateString();
        const inMonth = cell.getMonth() === m;
        const items = dated.filter((d) => d.date.toDateString() === key);
        if (inMonth) count += items.length;
        days.push({
          key,
          dayNum: String(cell.getDate()),
          inMonth,
          isToday: key === todayStr,
          items,
        });
      }
      weeks.push(days);
    }

    return {
      weeks,
      monthCount: count,
      monthLabel: base.toLocaleDateString("en-US", { month: "long" }),
      yearLabel: String(y),
      dated,
    };
  }, [offset, s.snapshot.assignments]);

  const selTasks = selected ? dated.filter((d) => d.date.toDateString() === selected) : [];

  return (
    <div className="calendar-view" style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: "0 24px 24px", display: "flex", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 1100, height: "100%", minHeight: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="calendar-heading" style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--text)" }}>{monthLabel}</span>
            <span style={{ fontSize: 22, fontWeight: 400, letterSpacing: "-0.02em", color: "var(--faint)" }}>{yearLabel}</span>
            <span className="calendar-count" style={{ fontSize: 12, color: "var(--muted)", marginLeft: 8 }}>
              {monthCount === 1 ? "1 assignment this month" : `${monthCount} assignments this month`}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              className="btn btn--quiet"
              style={{ height: 30 }}
              onClick={() => {
                setOffset(0);
                setSelected(new Date().toDateString());
              }}
            >
              Today
            </button>
            <button type="button" className="icon-btn" style={{ width: 30, height: 30, fontSize: 14 }} aria-label="Previous month" onClick={() => setOffset((o) => o - 1)}>
              ‹
            </button>
            <button type="button" className="icon-btn" style={{ width: 30, height: 30, fontSize: 14 }} aria-label="Next month" onClick={() => setOffset((o) => o + 1)}>
              ›
            </button>
          </div>
        </div>

        <div
          className="calendar-slate"
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            borderRadius: "var(--radius-xl)",
            border: "1px solid var(--line)",
            background: "var(--surface-faint)",
            boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.05)",
            padding: 14,
          }}
        >
          <div className="calendar-weekdays" style={{ flexShrink: 0, display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6, padding: "0 0 10px" }}>
            {WEEKDAYS.map((d, i) => (
              <div key={i} style={{ textAlign: "center", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "var(--faint)" }}>
                {d}
              </div>
            ))}
          </div>

          <div className="calendar-weeks" style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateRows: "repeat(6, minmax(0, 1fr))", gap: 6 }}>
            {weeks.map((days, wi) => (
              <div className="calendar-week" key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6, minHeight: 0 }}>
                {days.map((cell) => {
                  const isSel = cell.key === selected;
                  return (
                    <button
                      className="calendar-cell"
                      key={cell.key}
                      type="button"
                      onClick={() => setSelected(cell.key)}
                      style={{
                        position: "relative",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 4,
                        height: "100%",
                        minHeight: 0,
                        minWidth: 0,
                        overflow: "hidden",
                        border: 0,
                        borderRadius: 16,
                        padding: 8,
                        font: "inherit",
                        cursor: "pointer",
                        textAlign: "center",
                        transition: "background .15s",
                        background: isSel
                          ? "var(--raised)"
                          : cell.inMonth
                            ? "oklch(0.301 0 0 / 0.5)"
                            : "transparent",
                        boxShadow: isSel ? "inset 0 1px 0 oklch(1 0 0 / 0.08)" : undefined,
                      }}
                    >
                      <span
                        className="tabular"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 24,
                          height: 24,
                          borderRadius: 9999,
                          fontSize: 12,
                          fontWeight: 600,
                          flexShrink: 0,
                          background: cell.isToday ? "var(--text)" : undefined,
                          color: cell.isToday ? "var(--bg)" : cell.inMonth ? "var(--text-2)" : "var(--dim)",
                        }}
                      >
                        {cell.dayNum}
                      </span>

                      {cell.items.length > 0 && (
                        <span className="calendar-events" style={{ display: "flex", flexDirection: "column", gap: 3, width: "100%", minWidth: 0 }}>
                          {cell.items.slice(0, 2).map(({ a }) => {
                            const c = s.courseById(a.courseId);
                            return (
                              <span
                                key={a.id}
                                style={{
                                  display: "flex",
                                  alignItems: "flex-start",
                                  gap: 5,
                                  width: "100%",
                                  minWidth: 0,
                                  fontSize: 10.5,
                                  lineHeight: 1.3,
                                  color: cell.inMonth ? "var(--text-2)" : "oklch(0.55 0 0)",
                                }}
                              >
                                <span style={{ marginTop: 4 }}>
                                  <Dot color={c?.dot ?? "var(--muted)"} size={5} radius={9999} />
                                </span>
                                <span
                                  style={{
                                    flex: 1,
                                    minWidth: 0,
                                    textAlign: "left",
                                    overflow: "hidden",
                                    display: "-webkit-box",
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: "vertical",
                                  }}
                                >
                                  {a.title}
                                </span>
                              </span>
                            );
                          })}
                          {cell.items.length > 2 && (
                            <span style={{ fontSize: 10, color: "var(--faint)", textAlign: "left", paddingLeft: 10 }}>
                              +{cell.items.length - 2}
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {selected && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setSelected(null)}
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 40,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "oklch(0 0 0 / 0.5)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(520px, 90vw)",
              maxHeight: "80vh",
              overflowY: "auto",
              borderRadius: "var(--radius-lg)",
              border: "1px solid oklch(1 0 0 / 0.09)",
              background: "var(--surface)",
              boxShadow: "var(--shadow-pop)",
              padding: "20px 22px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
                {new Date(selected).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              </span>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setSelected(null)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 26,
                  height: 26,
                  flexShrink: 0,
                  border: 0,
                  borderRadius: 9999,
                  background: "var(--sunken)",
                  color: "var(--text-2)",
                  fontSize: 16,
                  lineHeight: 1,
                  cursor: "pointer",
                }}
              >
                ×
              </button>
            </div>

            {selTasks.length === 0 && (
              <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--muted)" }}>Nothing due this day.</p>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 10 }}>
              {selTasks.map(({ a }) => {
                const c = s.courseById(a.courseId);
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      setSelected(null);
                      s.openAssignment(a.id);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 0",
                      borderTop: "1px solid var(--line)",
                      border: 0,
                      borderTopWidth: 1,
                      borderTopStyle: "solid",
                      background: "transparent",
                      font: "inherit",
                      textAlign: "left",
                      cursor: "pointer",
                      width: "100%",
                    }}
                  >
                    <Dot color={c?.dot ?? "var(--muted)"} />
                    <span className="truncate" style={{ flex: 1, fontSize: 13, color: "var(--text)" }}>
                      {a.title}
                    </span>
                    {c && <Badge tone={c.tone}>{c.short}</Badge>}
                    <Badge tone={IMPACT_LABEL[a.impact].tone}>{IMPACT_LABEL[a.impact].label}</Badge>
                    <span className="tabular" style={{ flex: "0 0 54px", textAlign: "right", fontSize: 12, color: "var(--muted)" }}>
                      {fmtMinutes(a.minutes)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
