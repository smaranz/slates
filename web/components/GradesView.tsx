"use client";

import { useStore } from "@/lib/store";
import { fmtMinutes } from "@/lib/format";
import { categoryPct } from "@/lib/normalize";
import { countsTowardGrade } from "@/lib/grades";
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
                className="grade-course-button"
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
                  className="grade-course-info"
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
                    className="grade-course-name"
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
                  <span className="grade-course-meta" style={{ fontSize: 12, color: "var(--muted)" }}>
                    {c.period} ·{" "}
                    {open.length ? `${open.length} open · ${fmtMinutes(mins)} left` : "nothing open"}
                    {/* Say plainly whose arithmetic the headline number is. */}
                    {c.gradeSource === "points" && " · added up from points"}
                    {c.gradeSource === "none" && c.letter && " · graded in letters"}
                  </span>
                </span>

                {hasTrend && (
                  <span
                    className="grade-course-trend"
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

                <span className="grade-course-score" style={{ display: "flex", alignItems: "baseline", gap: 10, flexShrink: 0 }}>
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
                {(() => {
                  const counted = countsTowardGrade(cats);
                  return cats.map((cat) => {
                  const { pct: raw } = categoryPct(cat);
                  const pct = raw === null ? 0 : Math.round(raw);
                  /*
                   * Schoology holds points here but isn't counting them toward
                   * the course grade. Saying so is what keeps this list adding
                   * up to the headline above it — a row showing "5/7 · 71%"
                   * beside a grade that ignores it is just confusing.
                   */
                  const heldBack = !counted(cat) && cat.possible > 0;
                  // Nothing scored yet is not the same as scoring zero, and a
                  // category can be graded without exposing points.
                  const points =
                    cat.possible > 0 ? `${cat.earned}/${cat.possible}` : cat.letter || "—";
                  return (
                    <div
                      className="grade-category-row"
                      key={cat.cat}
                      title={
                        heldBack
                          ? `Schoology isn't counting ${cat.cat} toward your grade yet, so these points don't move it.`
                          : undefined
                      }
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 14,
                        padding: "7px 0",
                        opacity: heldBack ? 0.55 : 1,
                      }}
                    >
                      <span
                        className="truncate grade-category-name"
                        style={{ flex: "0 0 150px", textAlign: "center", fontSize: 13, color: "var(--text-2)" }}
                      >
                        {cat.cat}
                      </span>
                      <span
                        className="tabular grade-category-weight"
                        style={{ flex: "0 0 54px", textAlign: "center", fontSize: 12, color: "var(--muted)" }}
                      >
                        {cat.weight}%
                      </span>
                      <Meter pct={heldBack ? 0 : pct} color={c.dot} />
                      <span
                        className="tabular grade-category-points"
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
                        className="tabular grade-category-pct"
                        style={{
                          flex: "0 0 92px",
                          textAlign: "center",
                          fontSize: heldBack ? 11 : 13,
                          fontWeight: heldBack ? 400 : 600,
                          color: heldBack ? "var(--dim)" : "var(--text)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {heldBack ? "not counted" : raw === null ? "—" : `${pct}%`}
                      </span>
                    </div>
                  );
                  });
                })()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
