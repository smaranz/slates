"use client";

import { useEffect, useRef, useState } from "react";

import { emptyOwnWork, type OwnWork } from "@/lib/own-work";
import { useStore } from "@/lib/store";
import { Icon, ICON } from "./ui";

/**
 * Adding a piece of work Schoology never heard about.
 *
 * The fields are the ones that change what the board does with it — a title, a
 * class, a due date, how long it'll take, how much it matters. Everything else
 * an assignment carries is either derived or genuinely absent, and asking for
 * it would be asking the student to fill in a form on the LMS's behalf.
 *
 * Only the title is required. A reading with no deadline is a real thing to
 * write down, and demanding a date would just get a made-up one.
 */

export default function OwnWorkDialog({
  editing,
  courseId,
  onClose,
}: {
  /** An existing entry to edit, or undefined to add a new one. */
  editing?: OwnWork;
  /** Preselected class, when opened from inside a course. */
  courseId?: string;
  onClose: () => void;
}) {
  const s = useStore();
  const [work, setWork] = useState<OwnWork>(() => editing ?? emptyOwnWork(courseId));
  const first = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    first.current?.focus();
  }, []);

  // Escape closes. Bound once — a listener re-registered on every keystroke
  // would fight the fields it sits over.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = <K extends keyof OwnWork>(key: K, value: OwnWork[K]) =>
    setWork((prev) => ({ ...prev, [key]: value }));

  function save() {
    if (!work.title.trim()) return;
    s.saveOwnWork(work);
    onClose();
  }

  return (
    <div className="own-backdrop" onMouseDown={onClose}>
      <div
        className="own-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={editing ? "Edit your assignment" : "Add an assignment"}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="own-head">
          <span className="card-title">{editing ? "Edit assignment" : "Add assignment"}</span>
          <button type="button" className="icon-btn" style={{ width: 26, height: 26 }} onClick={onClose} aria-label="Close">
            <Icon path={ICON.close} size={12} />
          </button>
        </div>

        <form
          className="own-body"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label className="own-field">
            <span className="field-label">What is it</span>
            <input
              ref={first}
              className="own-input"
              value={work.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Read chapters 4–6"
            />
          </label>

          <div className="own-row">
            <label className="own-field" style={{ flex: 1 }}>
              <span className="field-label">Class</span>
              <select className="own-input" value={work.courseId} onChange={(e) => set("courseId", e.target.value)}>
                <option value="">No class</option>
                {s.snapshot.courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="own-field" style={{ width: 150 }}>
              <span className="field-label">Due</span>
              <input
                className="own-input"
                type="date"
                value={work.dueDate ?? ""}
                onChange={(e) => set("dueDate", e.target.value || null)}
              />
            </label>

            <label className="own-field" style={{ width: 110 }}>
              <span className="field-label">Time</span>
              <input
                className="own-input"
                type="time"
                value={work.dueTime ?? ""}
                onChange={(e) => set("dueTime", e.target.value || undefined)}
                disabled={!work.dueDate}
              />
            </label>
          </div>

          <div className="own-row">
            <label className="own-field" style={{ width: 130 }}>
              <span className="field-label">How long</span>
              <span className="own-with-suffix">
                <input
                  className="own-input"
                  type="number"
                  min={5}
                  step={5}
                  value={work.minutes}
                  onChange={(e) => set("minutes", Math.max(5, Number(e.target.value) || 5))}
                />
                <span>min</span>
              </span>
            </label>

            <label className="own-field" style={{ flex: 1 }}>
              <span className="field-label">Weight</span>
              <span className="own-segmented">
                {(["low", "medium", "high"] as const).map((level) => (
                  <button
                    key={level}
                    type="button"
                    className={work.impact === level ? "is-on" : ""}
                    onClick={() => set("impact", level)}
                  >
                    {level === "low" ? "Minor" : level === "medium" ? "Some impact" : "Big impact"}
                  </button>
                ))}
              </span>
            </label>

            <label className="own-field" style={{ width: 110 }}>
              <span className="field-label">
                Out of
                <span className="own-hint"> optional</span>
              </span>
              <input
                className="own-input"
                type="number"
                min={0}
                value={work.points ?? ""}
                onChange={(e) => set("points", e.target.value ? Number(e.target.value) : null)}
                placeholder="—"
              />
            </label>
          </div>

          <label className="own-field">
            <span className="field-label">
              Notes
              <span className="own-hint"> the tutor reads these</span>
            </span>
            <textarea
              className="own-input own-textarea"
              value={work.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
              rows={2}
              placeholder="Anything you'd want to remember about it"
            />
          </label>

          <div className="own-foot">
            {editing && (
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => {
                  s.removeOwnWork(work.id);
                  onClose();
                }}
              >
                <Icon path={ICON.trash} size={13} />
                Delete
              </button>
            )}
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn--quiet" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={!work.title.trim()}>
              {editing ? "Save" : "Add it"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
