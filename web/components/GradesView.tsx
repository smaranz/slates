"use client";

import { useStore } from "@/lib/store";
import { fmtMinutes } from "@/lib/format";
import { categoryPct } from "@/lib/normalize";
import { Dot, Meter } from "./ui";

export default function GradesView() {
  const s = useStore();

  return (
    <div className="scroll centered">
      <div className="col" style={{ maxWidth: 1100, gap: 12 }}>
        {s.snapshot.courses.map((c) => {
          const open = s.snapshot.assignments.filter(
            (a) => a.courseId === c.id && s.statusOf(a) !== "done"
          );
          const mins = open.reduce((acc, a) => acc + a.minutes, 0);
          // Schoology exposes no grade history, so there is nothing to trend
          // against on a first sync. Showing "0.0 pts" implied a measurement
          // that was never taken.
          const trendNum = parseFloat(c.trend);
          const hasTrend = Number.isFinite(trendNum) && trendNum !== 0;
          const up = trendNum > 0;
          const down = trendNum < 0;
          const cats = s.snapshot.gradebook[c.id] ?? [];

          return (
            <div key={c.id} className="card" style={{ overflow: "hidden" }}>
              <button
                type="button"
                onClick={() => s.openCourse(c.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  width: "100%",
                  border: 0,
                  background: "transparent",
                  padding: "18px 20px 12px",
                  font: "inherit",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <Dot color={c.dot} size={10} radius={3} />
                <span
                  style={{
                    minWidth: 0,
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 3,
                  }}
                >
                  <span
                    style={{
                      fontSize: 15,
                      fontWeight: 600,
                      letterSpacing: "-0.01em",
                      color: "var(--text)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {c.name}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
                    {c.period} ·{" "}
                    {open.length ? `${open.length} open · ${fmtMinutes(mins)} left` : "nothing open"}
                    {/* Say plainly whose arithmetic the headline number is. */}
                    {c.gradeSource === "points" && " · added up from points"}
                    {c.gradeSource === "none" && c.letter && " · graded in letters"}
                  </span>
                </span>

                {hasTrend && (
                  <span
                    style={{
                      flexShrink: 0,
                      whiteSpace: "nowrap",
                      fontSize: 12,
                      fontWeight: 600,
                      letterSpacing: "0.01em",
                      color: up ? "var(--good)" : down ? "var(--bad)" : "var(--muted)",
                    }}
                  >
                    {(up ? "▲ " : "▼ ") + c.trend.replace("-", "")} pts
                  </span>
                )}

                <span style={{ display: "flex", alignItems: "baseline", gap: 10, flexShrink: 0 }}>
                  <span
                    className="tabular"
                    style={{
                      fontSize: 26,
                      fontWeight: 600,
                      letterSpacing: "-0.02em",
                      color: "var(--text)",
                      lineHeight: 1,
                    }}
                  >
                    {c.grade}
                  </span>
                  <span
                    style={{
                      fontSize: 26,
                      fontWeight: 600,
                      color: "var(--text-2)",
                      width: 40,
                      textAlign: "left",
                      lineHeight: 1,
                    }}
                  >
                    {/* A letter-graded class already shows its letter as the grade. */}
                    {c.grade === c.letter ? "" : c.letter}
                  </span>
                </span>
              </button>

              <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 20px 16px" }}>
                {cats.map((cat) => {
                  const { pct: raw } = categoryPct(cat);
                  const pct = raw === null ? 0 : Math.round(raw);
                  // Nothing scored yet is not the same as scoring zero, and a
                  // category can be graded without exposing points.
                  const points =
                    cat.possible > 0 ? `${cat.earned}/${cat.possible}` : cat.letter || "—";
                  return (
                    <div
                      key={cat.cat}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 14,
                        padding: "7px 0",
                      }}
                    >
                      <span
                        className="truncate"
                        style={{ flex: "0 0 150px", textAlign: "center", fontSize: 13, color: "var(--text-2)" }}
                      >
                        {cat.cat}
                      </span>
                      <span
                        className="tabular"
                        style={{ flex: "0 0 54px", textAlign: "center", fontSize: 12, color: "var(--muted)" }}
                      >
                        {cat.weight}%
                      </span>
                      <Meter pct={pct} color={c.dot} />
                      <span
                        className="tabular"
                        style={{
                          flex: "0 0 86px",
                          textAlign: "center",
                          fontSize: 12,
                          color: "var(--muted)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {points}
                      </span>
                      <span
                        className="tabular"
                        style={{
                          flex: "0 0 54px",
                          textAlign: "center",
                          fontSize: 13,
                          fontWeight: 600,
                          color: "var(--text)",
                        }}
                      >
                        {raw === null ? "—" : `${pct}%`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
