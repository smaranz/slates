"use client";

import { useState } from "react";

import { useStore } from "@/lib/store";
import { gradeFor, letterFor, scoreColor } from "@/lib/grades";
import { categoryPct } from "@/lib/normalize";
import { LineChart, Meter } from "./ui";

const CUSTOM = "__custom";

export default function CourseView() {
  const s = useStore();
  const id = s.courseId!;
  const course = s.courseById(id);

  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [name, setName] = useState("");
  const [cat, setCat] = useState("");
  const [customCat, setCustomCat] = useState("");
  const [weight, setWeight] = useState("10");
  const [earned, setEarned] = useState("");
  const [possible, setPossible] = useState("");

  if (!course) return null;

  const cats = s.snapshot.gradebook[id] ?? [];
  const mine = s.customScores.filter((c) => c.courseId === id);
  const base = gradeFor(cats);
  const proj = gradeFor(cats, mine);
  // A course with nothing scored has no percentage, so there is nothing to
  // project against either — and no delta to draw.
  const projecting = mine.length > 0 && proj.pct !== null && base.pct !== null;
  const delta = projecting ? proj.pct! - base.pct! : 0;
  const up = delta > 0.05;
  const down = delta < -0.05;
  /*
   * Without what-ifs this is the course's actual standing — Schoology's own
   * percentage when it publishes one, so the number here matches the one on the
   * Grades screen instead of quietly recomputing a different answer. What-ifs
   * switch it to the projection, which has to be recomputed to mean anything.
   */
  const headline = projecting
    ? proj.pct
    : course.gradeSource === "none"
      ? null
      : course.pct;

  const options = [...cats.map((c) => ({ value: c.cat, label: c.cat })), { value: CUSTOM, label: "Custom category" }];
  const catLabel = options.find((o) => o.value === cat)?.label ?? "Choose category";

  function submit() {
    const e = parseFloat(earned);
    const p = parseFloat(possible);
    if (!p || Number.isNaN(e)) return;
    const isCustom = cat === CUSTOM;
    s.addScore({
      courseId: id,
      cat: isCustom ? customCat.trim() || "Custom" : cat || cats[0]?.cat || "General",
      weight: isCustom ? parseFloat(weight) || 10 : 0,
      name: name.trim() || "Assignment",
      earned: e,
      possible: p,
    });
    setOpen(false);
    setName("");
    setCat("");
    setCustomCat("");
    setWeight("10");
    setEarned("");
    setPossible("");
  }

  /*
   * Real gradebook rows grouped by category, with manual entries folded in.
   *
   * Only a row with both numbers gets a percentage. Splitting the score text on
   * "/" used to run on everything, so an unscored row ("—") and a letter row
   * ("A+") both rendered as "NaN%" — a made-up number where the honest answer
   * is that there isn't one yet.
   */
  const groups = cats.map((c) => ({
    name: c.cat,
    rows: c.items.map((it) => {
      const scored = typeof it.earned === "number" && typeof it.possible === "number" && it.possible > 0;
      const pct = scored ? Math.round((it.earned! / it.possible!) * 100) : null;
      return {
        key: it.id || it.name,
        name: it.name,
        date: it.date,
        score: scored ? `${it.earned}/${it.possible} · ${pct}%` : it.letter || "Not scored yet",
        pct,
        removable: false,
        id: "",
      };
    }),
  }));

  for (const c of mine) {
    const pct = Math.round((c.earned / c.possible) * 100);
    const row = {
      key: c.id,
      name: c.name,
      date: c.date,
      score: `${c.earned}/${c.possible} · ${pct}%`,
      pct,
      removable: true,
      id: c.id,
    };
    let g = groups.find((g) => g.name === c.cat);
    if (!g) {
      g = { name: c.cat, rows: [] };
      groups.push(g);
    }
    g.rows.push(row);
  }

  return (
    <div className="scroll centered" style={{ paddingBottom: 32 }}>
      <div className="col" style={{ maxWidth: 1100, gap: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--text)" }}>
              {course.name}
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 3 }}>
              {course.period} · current {course.grade}
              {mine.length ? ` · ${mine.length} what-if added` : ""}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                whiteSpace: "nowrap",
                color: up ? "var(--good)" : down ? "var(--bad)" : "var(--muted)",
              }}
            >
              {projecting
                ? `${up ? "▲" : down ? "▼" : "·"} ${Math.abs(delta).toFixed(1)} pts projected`
                : headline === null
                  ? course.letter
                    ? "graded in letters"
                    : "nothing graded yet"
                  : course.gradeSource === "points"
                    ? "added up from points"
                    : "current grade"}
            </span>
            <span
              className="tabular"
              style={{ fontSize: 38, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--text)", lineHeight: 1 }}
            >
              {/* No points in the gradebook means no percentage to show — the
                  letter Schoology gave, or nothing at all. */}
              {headline === null ? course.letter || "—" : `${headline.toFixed(1)}%`}
            </span>
            <span style={{ fontSize: 38, fontWeight: 600, color: "var(--text-2)", lineHeight: 1 }}>
              {headline === null ? "" : projecting ? letterFor(headline) : course.letter}
            </span>
          </div>
        </div>

        <div className="card card--pad">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <span className="card-title">Grade over time</span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {(s.snapshot.history[id] ?? [])[0]?.d ?? ""} — today
            </span>
          </div>
          <div style={{ marginTop: 14 }}>
            <LineChart points={s.snapshot.history[id] ?? []} color={course.dot} />
          </div>
        </div>

        <div className="card card--pad">
          <span className="card-title">Categories</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 10 }}>
            {proj.cats.map((cat) => {
              /*
               * Untouched categories show Schoology's own standing, so this
               * screen and the Grades list can't print two different numbers
               * for the same row — Schoology's category percentage and its
               * points sometimes disagree, and Schoology's is the real one.
               * Fold in a what-if and the arithmetic takes over, because that
               * is the only way a hypothetical can move anything.
               */
              const source = cats.find((c) => c.cat === cat.name);
              const reported = !cat.custom && !cat.touched && source ? categoryPct(source).pct : null;
              const points = cat.possible > 0 ? (cat.earned / cat.possible) * 100 : null;
              const standing = reported ?? points;
              // Nothing scored in a category yet: no bar, no points, no 0%.
              const graded = standing !== null;
              const pct = standing ?? 0;
              return (
                <div key={cat.name} style={{ display: "flex", alignItems: "center", gap: 14, padding: "7px 0" }}>
                  <span className="truncate" style={{ flex: "0 0 150px", fontSize: 13, color: "var(--text-2)" }}>
                    {cat.custom ? `${cat.name} (custom)` : cat.name}
                  </span>
                  <span className="tabular" style={{ flex: "0 0 54px", fontSize: 12, color: "var(--muted)" }}>
                    {cat.weight}%
                  </span>
                  <Meter pct={pct} color={course.dot} flex="1 1 100px" />
                  <span
                    className="tabular"
                    style={{ flex: "0 0 92px", textAlign: "right", fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}
                  >
                    {cat.possible > 0 ? `${cat.earned}/${cat.possible}` : source?.letter || "—"}
                  </span>
                  <span
                    className="tabular"
                    style={{ flex: "0 0 54px", textAlign: "right", fontSize: 13, fontWeight: 600, color: "var(--text)" }}
                  >
                    {graded ? `${Math.round(pct)}%` : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card card--pad">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span className="card-title">Recent scores</span>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setOpen((v) => !v)}
              aria-label="Add assignment"
              style={{ width: 22, height: 22, fontSize: 14 }}
            >
              +
            </button>
          </div>

          {open && (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 10, marginTop: 12 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 5, flex: "1 1 160px", minWidth: 140 }}>
                <span className="field-label">Assignment</span>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Unit 6 quiz" />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: 5, flex: "0 0 150px", position: "relative" }}>
                <span className="field-label">Category</span>
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  className="input"
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, cursor: "pointer" }}
                >
                  <span className="truncate" style={{ flex: 1, textAlign: "left" }}>{catLabel}</span>
                  <span style={{ flexShrink: 0, fontSize: 10, color: "var(--muted)" }}>▾</span>
                </button>
                {menuOpen && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      left: 0,
                      right: 0,
                      zIndex: 30,
                      borderRadius: 12,
                      border: "1px solid var(--line)",
                      background: "var(--surface)",
                      boxShadow: "var(--shadow-menu)",
                      padding: 4,
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                      maxHeight: 220,
                      overflowY: "auto",
                    }}
                  >
                    {options.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => {
                          setCat(o.value);
                          setMenuOpen(false);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          width: "100%",
                          border: 0,
                          padding: "8px 10px",
                          borderRadius: 8,
                          font: "inherit",
                          fontSize: 13,
                          textAlign: "left",
                          cursor: "pointer",
                          background: o.value === cat ? "var(--raised)" : "transparent",
                          color: o.value === cat ? "var(--text)" : "var(--text-2)",
                        }}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                )}
              </label>

              {cat === CUSTOM && (
                <>
                  <label style={{ display: "flex", flexDirection: "column", gap: 5, flex: "0 0 130px" }}>
                    <span className="field-label">New category</span>
                    <input className="input" value={customCat} onChange={(e) => setCustomCat(e.target.value)} placeholder="Quizzes" />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 5, flex: "0 0 90px" }}>
                    <span className="field-label">Weight %</span>
                    <input className="input" value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="numeric" placeholder="10" />
                  </label>
                </>
              )}

              <label style={{ display: "flex", flexDirection: "column", gap: 5, flex: "0 0 84px" }}>
                <span className="field-label">Earned</span>
                <input className="input" value={earned} onChange={(e) => setEarned(e.target.value)} inputMode="numeric" placeholder="45" />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 5, flex: "0 0 84px" }}>
                <span className="field-label">Out of</span>
                <input className="input" value={possible} onChange={(e) => setPossible(e.target.value)} inputMode="numeric" placeholder="50" />
              </label>

              <button type="button" className="btn btn--primary" style={{ height: 34 }} onClick={submit}>
                Add assignment
              </button>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 12 }}>
            {groups
              .filter((g) => g.rows.length > 0)
              .map((g) => (
                <div key={g.name}>
                  <div className="section-label" style={{ fontSize: 11, marginBottom: 4 }}>
                    {g.name}
                  </div>
                  {g.rows.map((it) => (
                    <div
                      key={it.key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 14,
                        padding: "8px 0",
                        borderTop: "1px solid var(--line)",
                      }}
                    >
                      <span className="truncate" style={{ flex: 1, fontSize: 13, color: "var(--text)" }}>
                        {it.name}
                      </span>
                      <span style={{ flex: "0 0 70px", fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
                        {it.date}
                      </span>
                      <span
                        className="tabular"
                        style={{
                          flex: "0 0 96px",
                          textAlign: "right",
                          fontSize: 13,
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                          color: it.pct === null ? "var(--muted)" : scoreColor(it.pct),
                        }}
                      >
                        {it.score}
                      </span>
                      {it.removable && (
                        <button
                          type="button"
                          aria-label="Remove"
                          onClick={() => s.removeScore(it.id)}
                          style={{
                            flex: "0 0 20px",
                            height: 20,
                            border: 0,
                            borderRadius: 9999,
                            background: "transparent",
                            color: "var(--muted)",
                            fontSize: 15,
                            lineHeight: 1,
                            cursor: "pointer",
                          }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
