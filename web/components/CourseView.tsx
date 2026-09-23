"use client";

import { useState } from "react";

import { useStore } from "@/lib/store";
import { countsTowardGrade, gradeFor, letterFor, scoreColor } from "@/lib/grades";
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
  /** Saved what-ifs that stand in for a real row, by that row's id. */
  const whatIfByItem = new Map(mine.filter((c) => c.itemId).map((c) => [c.itemId!, c]));
  /** What each marked row currently contributes, so a what-if can cancel it. */
  const realById = new Map(
    cats.flatMap((c) =>
      c.items
        .filter((it) => it.id && typeof it.earned === "number" && typeof it.possible === "number")
        .map((it) => [it.id!, { earned: it.earned!, possible: it.possible! }] as const)
    )
  );

  /*
   * What-ifs as `gradeFor` needs them.
   *
   * A score typed onto an *unmarked* assignment is simply added — the category
   * average doesn't include it yet. One typed onto a *marked* assignment has
   * to cancel the real score first, or the row is counted twice and a
   * replacement reads as an extra assignment.
   */
  const extras = mine.map((c) => {
    const real = c.itemId ? realById.get(c.itemId) : undefined;
    return {
      cat: c.cat,
      weight: c.weight,
      earned: c.earned - (real?.earned ?? 0),
      possible: c.possible - (real?.possible ?? 0),
    };
  });

  /*
   * Rows switched off, expressed as extras that subtract what they contribute.
   *
   * Turning a row off is the same arithmetic as replacing it with nothing, so
   * it rides the machinery a what-if already uses rather than needing its own
   * path through the calculation. A row that also carries a what-if is skipped
   * here — that what-if has already cancelled the real score.
   */
  const switchedOff = cats.flatMap((c) =>
    c.items
      .filter((it) => it.id && s.excluded[it.id] && !whatIfByItem.has(it.id))
      .flatMap((it) => {
        const real = realById.get(it.id!);
        return real ? [{ cat: c.cat, weight: c.weight, earned: -real.earned, possible: -real.possible }] : [];
      })
  );

  const allExtras = [...extras, ...switchedOff];

  /**
   * What one row is worth to the course grade right now.
   *
   * The difference between the grade as it stands and the grade without that
   * row — so a zero on a big test reads as the double-digit hole it actually
   * is, and a perfect score on a five-point warm-up reads as the rounding it
   * actually is. This is the number that answers "which assignment is holding
   * me back", which no amount of staring at a list of percentages does.
   */
  const impactOf = (itemId: string | undefined, catName: string, weight: number): number | null => {
    if (!itemId || s.excluded[itemId]) return null;
    const real = realById.get(itemId);
    const saved = whatIfByItem.get(itemId);
    const earned = saved ? saved.earned : real?.earned;
    const possible = saved ? saved.possible : real?.possible;
    if (earned == null || possible == null || possible <= 0) return null;

    const withIt = gradeFor(cats, allExtras).pct;
    const without = gradeFor(cats, [
      ...allExtras,
      { cat: catName, weight, earned: -earned, possible: -possible },
    ]).pct;
    return withIt === null || without === null ? null : withIt - without;
  };

  const base = gradeFor(cats);
  const proj = gradeFor(cats, allExtras);
  // A course with nothing scored has no percentage, so there is nothing to
  // project against either — and no delta to draw.
  const projecting = (mine.length > 0 || switchedOff.length > 0) && proj.pct !== null && base.pct !== null;
  const delta = projecting ? proj.pct! - base.pct! : 0;
  const up = delta > 0.05;
  const down = delta < -0.05;
  /*
   * Without what-ifs this is the course's actual standing — Schoology's own
   * percentage when it publishes one, so the number here matches the one on the
   * Grades screen instead of quietly recomputing a different answer. What-ifs
   * switch it to the projection, which has to be recomputed to mean anything.
   */
  /*
   * Schoology's reported percentage, moved by whatever the what-ifs actually
   * change — not the recomputed one.
   *
   * Recomputing from points disagrees with Schoology whenever the gradebook
   * has ungraded categories or weights that don't sum to 100: this course
   * reports 96.9% and recomputes to 78.7%. Showing the recomputed figure made
   * a what-if read "78.7% → 78.5%" to a student whose grade is 96.9%, which
   * answers a question nobody asked. The *difference* between two recomputed
   * numbers is sound, so that difference is applied to the real grade.
   */
  const anchor = course.gradeSource === "none" ? null : course.pct;
  /*
   * The anchor is only usable while the recomputation agrees with it.
   *
   * Adding a delta measured on one scale to a number on another is unsound,
   * and it produced real nonsense: a course reported at 93.3% that recomputed
   * to 78.9% turned a 7/7 into "114%", because a +20.8 improvement in the
   * recomputed world was pasted onto the reported one. The two now agree for
   * every gradebook tested, so this guard should never fire — but if a
   * gradebook ever disagrees again, showing the recomputed pair is at least
   * internally consistent, and a number nobody can reach is not.
   */
  const anchorable =
    anchor !== null && base.pct !== null && Math.abs(anchor - base.pct) <= 0.5;
  const anchored = (p: number | null): number | null =>
    !anchorable || base.pct === null || p === null ? p : anchor! + (p - base.pct);

  const headline = projecting ? anchored(proj.pct) : anchorable ? anchor : base.pct ?? anchor;

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
        ...extras,
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
  /*
   * What each outstanding item is out of.
   *
   * The grades report gives no total for work that hasn't been marked — an
   * ungraded row is a bare "—" — so the only place a total can come from is
   * the assignment's own page, which the scraper reads separately. Without
   * this a what-if on unmarked work would make you type the total as well as
   * the score.
   */
  const pointsById = new Map(
    s.snapshot.assignments
      .filter((a) => typeof a.points === "number" && a.points! > 0)
      .map((a) => [a.id, a.points!])
  );

  const countsFor = countsTowardGrade(cats);
  const groups = cats.map((c) => ({
    name: c.cat,
    weight: c.weight,
    standing: categoryPct(c).pct,
    counted: countsFor(c),
    rows: c.items.map((it) => {
      const scored = typeof it.earned === "number" && typeof it.possible === "number" && it.possible > 0;
      const pct = scored ? Math.round((it.earned! / it.possible!) * 100) : null;
      // Published total if there is one, else whatever the assignment knows.
      const outOf = scored ? it.possible! : (it.id ? pointsById.get(it.id) ?? null : null);
      const impact = it.id ? impactById.get(it.id) : undefined;
      /*
       * A score you typed and kept for this row shows *instead of* the
       * gradebook's, so the list reads as the grade you're imagining rather
       * than the real one with a duplicate stapled underneath.
       */
      const saved = it.id ? whatIfByItem.get(it.id) : undefined;
      const savedPct = saved ? Math.round((saved.earned / saved.possible) * 100) : null;
      return {
        key: it.id || it.name,
        name: it.name,
        date: it.date,
        score: saved
          ? `${saved.earned}/${saved.possible} · ${savedPct}%`
          : scored
            ? `${it.earned}/${it.possible} · ${pct}%`
            : it.letter || "Not scored yet",
        pct: saved ? savedPct : pct,
        // The item that first put a percentage on the board has nothing to be
        // measured against, so it gets no delta rather than a made-up one.
        // A what-if isn't in that history at all.
        delta: saved ? null : impact && !impact.first ? impact.delta : null,
        // What you got wrong lives on the assignment itself, not here — a
        // scored row with a real assignment behind it just opens that.
        assignmentId: it.id ?? null,
        /*
         * What the editor starts from: your kept score if there is one, else
         * the real one. `earned` stays null on unmarked work with no what-if —
         * that is the difference between "no score" and "scored zero", and the
         * projection depends on it.
         */
        earned: saved ? saved.earned : scored ? it.earned! : null,
        possible: saved ? saved.possible : outOf,
        scored,
        /** What the gradebook itself holds, which a what-if has to cancel. */
        realEarned: scored ? it.earned! : null,
        realPossible: scored ? it.possible! : null,
        itemId: it.id ?? undefined,
        cat: c.cat,
        weight: c.weight,
        /** What this row is worth to the course grade, or null when it isn't scored. */
        impact: impactOf(it.id ?? undefined, c.cat, c.weight),
        excluded: Boolean(it.id && s.excluded[it.id]),
        // A kept what-if is removable — that's how you take it back off.
        removable: !!saved,
        id: saved?.id ?? "",
        whatIf: !!saved,
      };
    }),
  }));

  for (const c of mine.filter((x) => !x.itemId)) {
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
      earned: c.earned as number | null,
      possible: c.possible as number | null,
      scored: false,
      realEarned: null as number | null,
      realPossible: null as number | null,
      itemId: undefined as string | undefined,
      weight: c.weight,
      impact: null as number | null,
      excluded: false,
      cat: c.cat,
      removable: true,
      id: c.id,
      whatIf: true,
    };
    let g = groups.find((x) => x.name === c.cat);
    if (!g) {
      // A category you invented: it has no Schoology standing of its own, and
      // its weight is whatever you said it was.
      g = { name: c.cat, weight: c.weight, standing: null, counted: true, rows: [] };
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
              /*
               * Points as Schoology keeps them. The projection re-scales a
               * category's earned points to match the percentage Schoology
               * publishes, which is right for the arithmetic and wrong to
               * print — the student's gradebook says 267.2/270, so that is
               * what this row says until a what-if actually changes it.
               */
              const shown =
                cat.touched || cat.custom
                  ? cat.possible > 0
                    ? { earned: cat.earned, possible: cat.possible }
                    : null
                  : source && source.possible > 0
                    ? { earned: source.earned, possible: source.possible }
                    : null;
              /*
               * Schoology holds points in this category but isn't counting
               * them toward the course grade yet. Saying so is better than a
               * row that looks graded but moves nothing.
               */
              const heldBack = !cat.touched && !cat.custom && cat.possible === 0 && Boolean(cat.held);
              // Nothing scored in a category yet: no bar, no points, no 0%.
              const graded = standing !== null;
              const pct = standing ?? 0;
              return (
                <div
                  key={cat.name}
                  className="cat-row"
                  title={
                    heldBack
                      ? `Schoology isn't counting ${cat.name} toward your grade yet, so these points don't move it.`
                      : undefined
                  }
                  style={{ display: "flex", alignItems: "center", gap: 14, padding: "7px 0", opacity: heldBack ? 0.55 : 1 }}
                >
                  <span className="truncate cat-name" style={{ flex: "0 0 150px", fontSize: 13, color: "var(--text-2)" }}>
                    {cat.custom ? `${cat.name} (custom)` : cat.name}
                  </span>
                  <span className="tabular cat-weight" style={{ flex: "0 0 54px", fontSize: 12, color: "var(--muted)" }}>
                    {cat.weight}%
                  </span>
                  <Meter pct={heldBack ? 0 : pct} color={course.dot} flex="1 1 100px" />
                  <span
                    className="tabular cat-points"
                    style={{ flex: "0 0 92px", textAlign: "right", fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}
                  >
                    {shown ? `${round(shown.earned)}/${round(shown.possible)}` : source?.letter || "—"}
                  </span>
                  <span
                    className="tabular cat-pct"
                    style={{
                      flex: "0 0 92px",
                      textAlign: "right",
                      fontSize: heldBack ? 11 : 13,
                      fontWeight: heldBack ? 400 : 600,
                      color: heldBack ? "var(--dim)" : "var(--text)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {heldBack ? "not counted" : graded ? `${Math.round(pct)}%` : "—"}
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
                  {/* The weight and the category's own standing, where you're
                      already looking — a 40% category at 71% explains far more
                      about a course grade than either number does alone. */}
                  <div className="score-group">
                    <span className="score-group-name truncate">{g.name}</span>
                    <span className="score-group-weight">{g.weight}% of the grade</span>
                    <span
                      className="tabular score-group-pct"
                      style={{ color: g.standing === null ? "var(--dim)" : scoreColor(g.standing) }}
                    >
                      {g.counted ? (g.standing === null ? "—" : `${Math.round(g.standing)}%`) : "not counted"}
                    </span>
                  </div>
                  {g.rows.map((it) => (
                    <ScoreRow
                      key={it.key}
                      row={it}
                      excluded={it.excluded}
                      onToggle={() => it.itemId && s.toggleExcluded(it.itemId)}
                      onScore={(earned, possible) => {
                        // Typing over a row replaces whatever what-if it had,
                        // so a second edit doesn't stack on the first.
                        if (it.id) s.removeScore(it.id);
                        s.addScore({
                          courseId: id,
                          cat: it.cat,
                          weight: it.weight,
                          name: it.name,
                          earned,
                          possible,
                          itemId: it.itemId,
                        });
                      }}
                      onClear={() => it.id && s.removeScore(it.id)}
                      onOpen={() => it.assignmentId && s.openAssignment(it.assignmentId)}
                    />
                  ))}
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One gradebook row, editable in place.
 *
 * Three things live here that a list of percentages can't tell you, and they
 * are the reason this screen exists:
 *
 *   - What the row is *worth*. "83%" says nothing about whether that score is
 *     holding the grade down; "−4.2%" says exactly how much. A zero on a big
 *     test and a zero on a five-point warm-up look identical until you show
 *     the contribution.
 *   - What a different score would do. The points are two number fields, so
 *     the answer arrives as you type rather than after opening a dialog,
 *     committing, and looking somewhere else.
 *   - What the grade would be without it. The tick switches a row off, which
 *     is the other half of the same question and often the more useful one.
 *
 * Typing writes a what-if that persists, so a course can be left mid-thought
 * and picked back up. Clearing a field puts the real score back.
 */
function ScoreRow({
  row,
  excluded,
  onToggle,
  onScore,
  onClear,
  onOpen,
}: {
  row: {
    key: string;
    name: string;
    date: string;
    pct: number | null;
    earned: number | null;
    possible: number | null;
    impact: number | null;
    itemId?: string;
    assignmentId: string | null;
    whatIf: boolean;
    removable: boolean;
  };
  excluded: boolean;
  onToggle: () => void;
  onScore: (earned: number, possible: number) => void;
  onClear: () => void;
  onOpen: () => void;
}) {
  /*
   * Drafts are local so a half-typed "1" in a field that will read "15" never
   * reaches the projection. They commit on blur and on Enter.
   */
  const [earned, setEarned] = useState<string | null>(null);
  const [possible, setPossible] = useState<string | null>(null);

  const shownEarned = earned ?? (row.earned == null ? "" : String(round(row.earned)));
  const shownPossible = possible ?? (row.possible == null ? "" : String(round(row.possible)));

  function commit() {
    const rawEarned = shownEarned.trim();
    const rawPossible = shownPossible.trim();

    // An emptied score means "put the real one back", not "I scored zero".
    if (rawEarned === "") {
      setEarned(null);
      setPossible(null);
      if (row.whatIf) onClear();
      return;
    }

    const e = Number(rawEarned);
    const p = Number(rawPossible);

    /*
     * Half a score is not a score yet, and the draft has to survive.
     *
     * An ungraded assignment starts with both fields empty, so the first one
     * you fill can't be applied on its own — and clearing the drafts at that
     * point threw away what you had just typed, which is why typing into an
     * unscored row appeared to do nothing at all. Keep it until there is a
     * pair worth saving.
     */
    if (!Number.isFinite(e) || !Number.isFinite(p) || p <= 0) return;

    setEarned(null);
    setPossible(null);
    if (e === row.earned && p === row.possible) return;
    onScore(e, p);
  }

  const impact = row.impact;
  /*
   * Every row stays editable, including one you've already typed into.
   *
   * This used to read `!row.removable`, and `removable` becomes true the
   * moment a what-if is saved — so the first edit locked the field and the
   * second was impossible. Refining a number is the normal way to use this:
   * you try 6, look at the grade, then try 8. `removable` only decides whether
   * there's an × to put the real score back.
   */
  const editable = !excluded;

  return (
    <div
      className="score-row"
      style={{ opacity: excluded ? 0.45 : 1, borderTop: "1px solid var(--line)" }}
    >
      <button
        type="button"
        className={`score-tick${excluded ? "" : " is-on"}`}
        onClick={onToggle}
        disabled={!row.itemId}
        aria-pressed={!excluded}
        aria-label={excluded ? `Count ${row.name} again` : `Leave ${row.name} out of the grade`}
        title={excluded ? "Not counted — click to put it back" : "Counted — click to see the grade without it"}
      >
        {excluded ? <Icon path={ICON.close} size={10} /> : <Icon path={ICON.check} size={10} />}
      </button>

      <button
        type="button"
        className="score-name truncate"
        onClick={onOpen}
        disabled={!row.assignmentId}
        title={row.assignmentId ? "Open this assignment" : undefined}
      >
        {row.name}
        {row.whatIf && <span className="score-flag">yours</span>}
      </button>

      <span
        className="tabular score-impact"
        style={{
          color:
            excluded || impact === null
              ? "var(--dim)"
              : impact >= 0
                ? "var(--good)"
                : "var(--bad)",
        }}
        title={
          impact === null
            ? undefined
            : `Your grade would be ${Math.abs(impact).toFixed(2)}% ${impact >= 0 ? "lower" : "higher"} without this`
        }
      >
        {excluded ? "off" : impact === null ? "" : `${impact >= 0 ? "+" : ""}${impact.toFixed(2)}%`}
      </span>

      <span className="score-fields">
        <input
          className="score-field"
          value={shownEarned}
          onChange={(e) => setEarned(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          disabled={!editable || excluded}
          inputMode="decimal"
          aria-label={`Score for ${row.name}`}
          placeholder="—"
        />
        <span className="score-slash">/</span>
        <input
          className="score-field"
          value={shownPossible}
          onChange={(e) => setPossible(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          disabled={!editable || excluded}
          inputMode="decimal"
          aria-label={`Out of, for ${row.name}`}
          placeholder="—"
        />
      </span>

      {row.removable ? (
        <button type="button" className="score-x" onClick={onClear} aria-label={`Remove ${row.name}`}>
          <Icon path={ICON.close} size={11} />
        </button>
      ) : (
        <span style={{ width: 20, flexShrink: 0 }} />
      )}
    </div>
  );
}

/** Points as a gradebook prints them: 267.2, not 267.20000000000002. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}
