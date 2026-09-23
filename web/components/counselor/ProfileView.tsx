"use client";

import { useEffect, useState } from "react";


import { useCounselor } from "@/lib/counselor/store";
import { GRADE_LABEL } from "@/lib/counselor/state";
import type { Activity, CounselorProfile, GradeLevel, Rigor } from "@/lib/counselor/types";
import { Icon, ICON } from "../ui";

/**
 * What the counselor knows before you've said anything.
 *
 * Every field here is load-bearing: the chance engine reads the GPA, the
 * scores, the rigor and the activity tiers directly, and the system prompt
 * quotes the rest back at itself. A blank profile makes the counselor
 * confidently generic, which is the exact failure it exists to avoid — so this
 * is what an empty record opens on.
 *
 * The counselor writes here too, through update_profile_fact, whenever you
 * mention a new score in conversation.
 */

const RIGOR: { value: Rigor; label: string }[] = [
  { value: "low", label: "Standard" },
  { value: "medium", label: "Some honors" },
  { value: "high", label: "Mostly honors / AP" },
  { value: "very-high", label: "Hardest available" },
];

const TIERS: { value: Activity["tier"]; label: string; hint: string }[] = [
  { value: 1, label: "Tier 1", hint: "National or exceptional" },
  { value: 2, label: "Tier 2", hint: "State level, or major school leadership" },
  { value: 3, label: "Tier 3", hint: "Sustained involvement, some leadership" },
  { value: 4, label: "Tier 4", hint: "Participation" },
];

export default function ProfileView() {
  const c = useCounselor();
  const p = c.profile;

  const set = <K extends keyof CounselorProfile>(key: K, value: CounselorProfile[K]) =>
    c.setProfile({ ...p, [key]: value });

  const num = (raw: string): number | null => {
    const v = Number(raw);
    return raw.trim() === "" || Number.isNaN(v) ? null : v;
  };

  return (
    <div className="counselor-page">
      <div className="counselor-page-inner counselor-form">
        <div className="counselor-form-intro">
          <h2>Your college record</h2>
          <p>
            The counselor reads this before every answer, and your admit odds are computed straight
            off it. Your name and photo live under Slates; everything here is what a counselor
            would ask for. It stays on this machine — there is no account to put it in.
          </p>
        </div>

        <LibraryCard />
        <ImportCard />

        <Group title="You">
          <Row label="Grade">
            <select
              className="counselor-input"
              value={p.gradeLevel}
              onChange={(e) => set("gradeLevel", Number(e.target.value) as GradeLevel)}
            >
              {[9, 10, 11, 12, 13].map((g) => (
                <option key={g} value={g}>
                  {GRADE_LABEL[g]}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Applying for">
            <input
              className="counselor-input"
              type="number"
              value={p.applyYear}
              onChange={(e) => set("applyYear", Number(e.target.value) || p.applyYear)}
            />
          </Row>
          <Row label="High school">
            <input
              className="counselor-input"
              value={p.highSchool ?? ""}
              onChange={(e) => set("highSchool", e.target.value)}
              placeholder="Optional"
            />
          </Row>
          <Row label="State">
            <input
              className="counselor-input"
              value={p.state}
              onChange={(e) => set("state", e.target.value.toUpperCase().slice(0, 2))}
              placeholder="CA"
              style={{ maxWidth: 80 }}
            />
          </Row>
          <Row label="First-generation" hint="Neither parent finished a four-year degree">
            <button
              type="button"
              className={`counselor-toggle${p.firstGen ? " is-on" : ""}`}
              onClick={() => set("firstGen", !p.firstGen)}
              role="switch"
              aria-checked={p.firstGen}
            >
              <span />
            </button>
          </Row>
        </Group>

        <Group title="Academics">
          <Row label="GPA (unweighted)" hint="On a 4.0 scale. The single biggest input to your odds.">
            <input
              className="counselor-input"
              type="number"
              step="0.01"
              min="0"
              max="4"
              value={p.gpaUnweighted ?? ""}
              onChange={(e) => set("gpaUnweighted", num(e.target.value))}
              placeholder="3.85"
              style={{ maxWidth: 110 }}
            />
          </Row>
          <Row label="Course rigor">
            <div className="counselor-segmented">
              {RIGOR.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  className={p.rigor === r.value ? "is-on" : ""}
                  onClick={() => set("rigor", r.value)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </Row>
          <Row label="SAT" hint="Leave blank if you're going test-optional.">
            <input
              className="counselor-input"
              type="number"
              min="400"
              max="1600"
              value={p.sat ?? ""}
              onChange={(e) => set("sat", num(e.target.value))}
              placeholder="1480"
              style={{ maxWidth: 110 }}
            />
          </Row>
          <Row label="ACT" hint="Used only when there's no SAT, converted across.">
            <input
              className="counselor-input"
              type="number"
              min="1"
              max="36"
              value={p.act ?? ""}
              onChange={(e) => set("act", num(e.target.value))}
              placeholder="33"
              style={{ maxWidth: 110 }}
            />
          </Row>
        </Group>

        <Group title="Plans">
          <Row label="Intended major">
            <input
              className="counselor-input"
              value={p.intendedMajor}
              onChange={(e) => set("intendedMajor", e.target.value)}
              placeholder="Undecided is a real answer"
            />
          </Row>
          <Row label="Dream school">
            <input
              className="counselor-input"
              value={p.dreamSchool ?? ""}
              onChange={(e) => set("dreamSchool", e.target.value)}
              placeholder="Optional"
            />
          </Row>
          <Row label="Budget" hint="Per year, all in. Shapes which schools get recommended.">
            <input
              className="counselor-input"
              type="number"
              value={p.budgetMax ?? ""}
              onChange={(e) => set("budgetMax", num(e.target.value))}
              placeholder="45000"
              style={{ maxWidth: 130 }}
            />
          </Row>
          <Row label="Anything else" hint="Read verbatim by the counselor. Context, worries, constraints.">
            <textarea
              className="counselor-input counselor-textarea"
              value={p.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
              rows={3}
              placeholder="I work 15 hours a week, I need to stay within driving distance of home…"
            />
          </Row>
        </Group>

        <Group title="Activities" hint="Tier honestly. An inflated tier makes every number after it wrong.">
          {p.activities.map((a, i) => (
            <div key={a.id} className="counselor-activity-row">
              <input
                className="counselor-input"
                value={a.name}
                onChange={(e) => {
                  const next = [...p.activities];
                  next[i] = { ...a, name: e.target.value };
                  set("activities", next);
                }}
                placeholder="What it is"
              />
              <input
                className="counselor-input"
                value={a.role ?? ""}
                onChange={(e) => {
                  const next = [...p.activities];
                  next[i] = { ...a, role: e.target.value };
                  set("activities", next);
                }}
                placeholder="Your role"
                style={{ maxWidth: 160 }}
              />
              <select
                className="counselor-input"
                value={a.tier}
                onChange={(e) => {
                  const next = [...p.activities];
                  next[i] = { ...a, tier: Number(e.target.value) as Activity["tier"] };
                  set("activities", next);
                }}
                style={{ maxWidth: 90 }}
              >
                {TIERS.map((t) => (
                  <option key={t.value} value={t.value} title={t.hint}>
                    {t.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="counselor-thread-del"
                onClick={() => set("activities", p.activities.filter((x) => x.id !== a.id))}
                aria-label="Remove activity"
              >
                <Icon path={ICON.close} size={12} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() =>
              set("activities", [
                ...p.activities,
                { id: Math.random().toString(36).slice(2, 9), name: "", tier: 3 },
              ])
            }
          >
            <Icon path={ICON.plus} size={13} />
            Add activity
          </button>
          <p className="counselor-tier-key">
            {TIERS.map((t) => (
              <span key={t.value}>
                <strong>{t.label}</strong> {t.hint}
              </span>
            ))}
          </p>
        </Group>

        <RecordGroups />
      </div>
    </div>
  );
}

/**
 * The transcript, scores, and awards.
 *
 * Read-only here on purpose. Typing four years of coursework into a form is
 * the reason nobody fills these in — it arrives through the intake record
 * above, or the counselor writes a row when you mention one in conversation.
 * This is where you check it got it right.
 */
function RecordGroups() {
  const c = useCounselor();
  const years = ([9, 10, 11, 12] as const).filter((y) => c.coursework.some((row) => row.year === y));

  if (!c.coursework.length && !c.testing.length && !c.awards.length) {
    return (
      <Group title="Transcript" hint="Arrives from an intake record, or as the counselor learns it.">
        <p className="counselor-empty-note">
          Nothing recorded. The counselor can only judge your rigor and trajectory from four years
          of courses — paste an intake record above, or just tell it what you took.
        </p>
      </Group>
    );
  }

  return (
    <>
      {years.length > 0 && (
        <Group title="Transcript" hint={`${c.coursework.length} rows`}>
          {years.map((year) => (
            <div key={year} className="counselor-year">
              <span className="counselor-year-label">Grade {year}</span>
              <div className="counselor-year-rows">
                {c.coursework
                  .filter((row) => row.year === year)
                  .map((row) => (
                    <span key={row.id} className="counselor-course">
                      <span className="truncate">{row.course}</span>
                      {row.level !== "regular" && <span className="counselor-tag is-strong">{row.level}</span>}
                      {row.term && <span className="counselor-course-term">{row.term}</span>}
                      {row.grade && <span className="counselor-course-grade">{row.grade}</span>}
                    </span>
                  ))}
              </div>
            </div>
          ))}
        </Group>
      )}

      {c.testing.length > 0 && (
        <Group title="Scores" hint="Every attempt — superscoring needs the history.">
          {c.testing.map((score) => (
            <div key={score.id} className="counselor-score-row">
              <span style={{ flex: 1, minWidth: 0 }} className="truncate">
                {score.test}
              </span>
              {score.date && <span className="counselor-tag">{score.date}</span>}
              <span className="counselor-course-grade">{score.score}</span>
            </div>
          ))}
        </Group>
      )}

      {c.awards.length > 0 && (
        <Group title="Awards">
          {c.awards.map((award) => (
            <div key={award.id} className="counselor-score-row">
              <span style={{ flex: 1, minWidth: 0 }} className="truncate">
                {award.name}
              </span>
              {award.year && <span className="counselor-tag">{award.year}</span>}
              <span className="counselor-tag is-strong">{award.level}</span>
            </div>
          ))}
        </Group>
      )}
    </>
  );
}

/**
 * The door the intake interview comes through.
 *
 * A form can't ask a good follow-up question, and "I do robotics" needs one —
 * so the interview happens in a chat and hands back JSON. This reads it.
 * Additive by design: a second interview months later adds what's new instead
 * of wiping what the counselor learned in between.
 */
function ImportCard() {
  const c = useCounselor();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ summary: string[]; warnings: string[] } | null>(null);

  if (!open) {
    return (
      <button type="button" className="counselor-import-open" onClick={() => setOpen(true)}>
        <Icon path={ICON.uploadTray} size={14} />
        <span style={{ flex: 1, textAlign: "left" }}>
          Paste an intake record
          <span className="counselor-import-hint">
            {" "}— fills this in from a JSON record you produced elsewhere
          </span>
        </span>
      </button>
    );
  }

  return (
    <div className="counselor-import">
      <div className="counselor-import-head">
        <span className="section-label" style={{ flex: 1 }}>
          Paste an intake record
        </span>
        <button
          type="button"
          className="icon-btn"
          style={{ width: 26, height: 26 }}
          onClick={() => {
            setOpen(false);
            setResult(null);
            setText("");
          }}
          aria-label="Close"
        >
          <Icon path={ICON.close} size={12} />
        </button>
      </div>

      <textarea
        className="counselor-input counselor-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder='{ "profile": { … }, "memories": [ … ], "coursework": [ … ] }'
        spellCheck={false}
        style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!text.trim()}
          onClick={() => {
            const outcome = c.importFrom(text);
            setResult(outcome);
            if (outcome.summary.length) setText("");
          }}
        >
          Read it in
        </button>
        {result?.summary.length ? (
          <span className="counselor-import-ok">Added {result.summary.join(", ")}.</span>
        ) : null}
      </div>

      {result?.warnings.length ? (
        <ul className="counselor-import-warn">
          {result.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Whether the counseling library is indexed on this machine.
 *
 * Worth surfacing because its absence is invisible otherwise: the counselor
 * still answers, just out of its own general knowledge instead of the
 * practice's written guidance, and a student would have no way to tell.
 */
function LibraryCard() {
  const [status, setStatus] = useState<{ ready: boolean; documents: number; chunks: number } | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/counselor/library")
      .then((r) => r.json())
      .then((body) => {
        if (live) setStatus(body);
      })
      .catch(() => {
        if (live) setStatus({ ready: false, documents: 0, chunks: 0 });
      });
    return () => {
      live = false;
    };
  }, []);

  if (!status) return null;

  return (
    <div className={`counselor-library${status.ready ? " is-ready" : ""}`}>
      <Icon path={status.ready ? ICON.check : ICON.file} size={14} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <p className="counselor-library-title">
          {status.ready ? "Counseling library indexed" : "No counseling library"}
        </p>
        <p className="counselor-library-sub">
          {status.ready
            ? `${status.documents} source files, ${status.chunks.toLocaleString()} passages. The counselor searches these before answering.`
            : "The counselor is answering from general knowledge. Index your own guides with npm run counselor:ingest -- <folder>."}
        </p>
      </div>
    </div>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="counselor-group">
      <div className="counselor-group-head">
        <span className="section-label">{title}</span>
        {hint && <span className="counselor-group-hint">{hint}</span>}
      </div>
      <div className="counselor-group-body">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="counselor-field">
      <span className="counselor-field-label">
        {label}
        {hint && <span className="counselor-field-hint">{hint}</span>}
      </span>
      <span className="counselor-field-control">{children}</span>
    </label>
  );
}
