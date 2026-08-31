"use client";

import { useEffect, useRef, useState } from "react";

import { useStore } from "@/lib/store";
import { gradeFor, letterFor, scoreColor } from "@/lib/grades";
import { categoryPct, gradeTimeline } from "@/lib/normalize";
import { Icon, ICON, LineChart, Meter } from "./ui";

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
  /*
   * One row open at a time. Prefilled from the item's real score, so typing
   * starts from what actually happened rather than a blank field.
   */
  const [editing, setEditing] = useState<{ key: string; earned: string; possible: string } | null>(null);

  if (!course) return null;

  const cats = s.snapshot.gradebook[id] ?? [];
  // Only pass Schoology's own number through when it's actually Schoology's —
  // a "points"-sourced course.pct was computed by the same weighted fallback
  // the timeline itself falls back to, so it can't be used to pick between models.
  const reportedPct = course.gradeSource === "reported" ? course.pct : null;
  const timeline = gradeTimeline(cats, reportedPct);
  // Same replay `LineChart` draws, keyed by item id so a row can show exactly
  // what that one assignment did to the course grade.
  const impactById = new Map(timeline.filter((t) => t.id).map((t) => [t.id!, t]));

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

  /*
   * The whole point of typing a hypothetical score is finding out what it
   * does to the grade — waiting until after "Add assignment" to find out
   * means undoing it if the answer wasn't what was hoped. Recomputed against
   * whatever's already applied (`mine`), so adding a second what-if shows
   * that one's own effect, not the combined total again.
   */
  const draftEarned = parseFloat(earned);
  const draftPossible = parseFloat(possible);
  const draftValid = possible.trim() !== "" && earned.trim() !== "" && !Number.isNaN(draftEarned) && draftPossible > 0;
  const draftWithScore = draftValid
    ? gradeFor(cats, [
        ...mine,
        {
          cat: cat === CUSTOM ? customCat.trim() || "Custom" : cat || cats[0]?.cat || "General",
          weight: cat === CUSTOM ? parseFloat(weight) || 10 : 0,
          earned: draftEarned,
          possible: draftPossible,
        },
      ])
    : null;
  const draftDelta =
    draftWithScore?.pct != null && proj.pct != null ? draftWithScore.pct - proj.pct : null;

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
      const impact = it.id ? impactById.get(it.id) : undefined;
      return {
        key: it.id || it.name,
        name: it.name,
        date: it.date,
        score: scored ? `${it.earned}/${it.possible} · ${pct}%` : it.letter || "Not scored yet",
        pct,
        // The item that first put a percentage on the board has nothing to be
        // measured against, so it gets no delta rather than a made-up one.
        delta: impact && !impact.first ? impact.delta : null,
        // What you got wrong lives on the assignment itself, not here — a
        // scored row with a real assignment behind it just opens that.
        assignmentId: it.id ?? null,
        // Raw numbers behind `score`, so a what-if edit has something to start from.
        earned: scored ? it.earned! : null,
        possible: scored ? it.possible! : null,
        cat: c.cat,
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
      // What-ifs aren't in the gradebook's own history, so there's no
      // chronological delta to show for them.
      delta: null as number | null,
      // A score you typed in yourself has no real assignment behind it, and
      // no what-if editor either — remove and re-add it to change it.
      assignmentId: null as string | null,
      earned: null as number | null,
      possible: null as number | null,
      cat: c.cat,
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

  /*
   * "If I'd gotten X instead" for whichever row is open. Folded in as a delta
   * against the item's real score rather than replacing it outright, so it
   * composes with any what-ifs already applied through `mine` instead of
   * double-counting or undoing them.
   */
  const editingRow = editing ? groups.flatMap((g) => g.rows).find((r) => r.key === editing.key) ?? null : null;
  const editEarned = editing ? parseFloat(editing.earned) : NaN;
  const editPossible = editing ? parseFloat(editing.possible) : NaN;
  const editValid =
    editing &&
    editingRow?.earned != null &&
    editingRow.possible != null &&
    editing.earned.trim() !== "" &&
    editing.possible.trim() !== "" &&
    !Number.isNaN(editEarned) &&
    editPossible > 0;
  const editProjection =
    editValid && editingRow
      ? gradeFor(cats, [
          ...mine,
          {
            cat: editingRow.cat,
            weight: 0,
            earned: editEarned - editingRow.earned!,
            possible: editPossible - editingRow.possible!,
          },
        ])
      : null;
  const editDelta =
    editProjection?.pct != null && proj.pct != null ? editProjection.pct - proj.pct : null;

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
              {timeline.length ? `${timeline[0].d} — ${timeline[timeline.length - 1].d}` : ""}
            </span>
          </div>
          <div style={{ marginTop: 14 }}>
            {timeline.length ? (
              <LineChart points={timeline} color={course.dot} />
            ) : (
              <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>
                Nothing graded yet
              </div>
            )}
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
              style={{ width: 22, height: 22 }}
            >
              <Icon path={ICON.plus} size={12} />
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

              {draftDelta !== null && draftWithScore?.pct != null && (
                <span className="tabular" style={{ flex: "1 1 100%", fontSize: 12, color: "var(--text-2)" }}>
                  Grade: {proj.pct!.toFixed(1)}% → {draftWithScore.pct.toFixed(1)}%{" "}
                  <span
                    style={{
                      fontWeight: 600,
                      color: draftDelta > 0.05 ? "var(--good)" : draftDelta < -0.05 ? "var(--bad)" : "var(--muted)",
                    }}
                  >
                    ({draftDelta > 0 ? "+" : ""}
                    {draftDelta.toFixed(1)}%)
                  </span>
                </span>
              )}
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
                  {g.rows.map((it) => {
                    const editable = it.possible !== null && it.possible > 0;
                    const toggle = () =>
                      setEditing({ key: it.key, earned: String(it.earned), possible: String(it.possible) });
                    return (
                    <div key={it.key} style={{ borderTop: "1px solid var(--line)" }}>
                    <div
                      onClick={editable ? toggle : undefined}
                      role={editable ? "button" : undefined}
                      tabIndex={editable ? 0 : undefined}
                      onKeyDown={
                        editable
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                toggle();
                              }
                            }
                          : undefined
                      }
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 14,
                        padding: "8px 0",
                        cursor: editable ? "pointer" : "default",
                      }}
                    >
                      <span
                        aria-hidden
                        style={{
                          flex: "0 0 10px",
                          fontSize: 9,
                          color: "var(--muted)",
                          // Static: the editor is a dialog now, so a disclosure
                          // triangle that rotates would promise an expansion
                          // that never happens.
                          visibility: editable ? "visible" : "hidden",
                        }}
                      >
                        ▶
                      </span>
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
                      <span
                        className="tabular"
                        style={{
                          flex: "0 0 60px",
                          textAlign: "right",
                          fontSize: 12,
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                          color: it.delta === null || it.delta === 0 ? "var(--muted)" : it.delta > 0 ? "var(--good)" : "var(--bad)",
                        }}
                      >
                        {it.delta === null ? "" : `${it.delta > 0 ? "+" : ""}${it.delta}%`}
                      </span>
                      {it.removable && (
                        <button
                          type="button"
                          aria-label="Remove"
                          onClick={(e) => {
                            e.stopPropagation();
                            s.removeScore(it.id);
                          }}
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
                    </div>
                    );
                  })}
                </div>
              ))}
          </div>
        </div>
      </div>

      {editing && editingRow && (
        <ScoreDialog
          name={editingRow.name}
          cat={editingRow.cat}
          earned={editing.earned}
          possible={editing.possible}
          onEarned={(v) => setEditing((cur) => cur && { ...cur, earned: v })}
          onPossible={(v) => setEditing((cur) => cur && { ...cur, possible: v })}
          from={proj.pct}
          to={editProjection?.pct ?? null}
          delta={editDelta}
          onOpenAssignment={
            editingRow.assignmentId ? () => s.openAssignment(editingRow.assignmentId!) : undefined
          }
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/**
 * "What if I'd scored X instead?"
 *
 * A dialog rather than a row that unfolds: the answer is a single number
 * somewhere else on the page, and an expanding row pushed the very grade you
 * were watching further down the screen as you typed. Nothing here is saved —
 * it's a preview against the real gradebook, gone when the dialog closes.
 */
function ScoreDialog({
  name,
  cat,
  earned,
  possible,
  onEarned,
  onPossible,
  from,
  to,
  delta,
  onOpenAssignment,
  onClose,
}: {
  name: string;
  cat: string;
  earned: string;
  possible: string;
  onEarned: (v: string) => void;
  onPossible: (v: string) => void;
  from: number | null;
  to: number | null;
  delta: number | null;
  onOpenAssignment?: () => void;
  onClose: () => void;
}) {
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.select();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tone = delta == null ? "var(--muted)" : delta > 0.05 ? "var(--good)" : delta < -0.05 ? "var(--bad)" : "var(--muted)";

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`What if: ${name}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--text)", lineHeight: 1.35 }}>{name}</div>
            <div style={{ marginTop: 3, fontSize: 12, color: "var(--muted)" }}>{cat}</div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
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

        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, marginTop: 16 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1 }}>
            <span className="field-label">Earned</span>
            <input
              ref={first}
              className="input"
              value={earned}
              onChange={(e) => onEarned(e.target.value)}
              inputMode="decimal"
            />
          </label>
          <span style={{ paddingBottom: 9, fontSize: 13, color: "var(--muted)" }}>/</span>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1 }}>
            <span className="field-label">Out of</span>
            <input
              className="input"
              value={possible}
              onChange={(e) => onPossible(e.target.value)}
              inputMode="decimal"
            />
          </label>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            marginTop: 16,
            padding: "12px 14px",
            borderRadius: "var(--radius-xs)",
            background: "var(--sunken)",
            boxShadow: "var(--shadow-sunken)",
          }}
        >
          {to != null && from != null ? (
            <>
              <span className="tabular" style={{ fontSize: 13, color: "var(--text-2)" }}>
                {from.toFixed(1)}% → {to.toFixed(1)}%
              </span>
              <span className="tabular" style={{ fontSize: 13, fontWeight: 600, color: tone }}>
                ({delta != null && delta > 0 ? "+" : ""}
                {delta?.toFixed(1)}%)
              </span>
            </>
          ) : (
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
              Type a score to see what it would do to this class.
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
          {onOpenAssignment && (
            <button type="button" className="btn btn--quiet" style={{ height: 30 }} onClick={onOpenAssignment}>
              View assignment
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn--primary" style={{ height: 30 }} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
