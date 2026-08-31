"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useStore } from "@/lib/store";
import { fmtMinutes } from "@/lib/format";
import type { Assignment, Bucket } from "@/lib/types";
import { Badge, ClockIcon, SearchIcon } from "./ui";

/* These name the board's columns, so they track whatever those are called. */
const COLUMN: Record<Bucket, string> = {
  tonight: "Today",
  soon: "Tomorrow",
  week: "This week",
  done: "Turned in",
};

/** Enough to fill the panel without turning it into a scrolling list view. */
const LIMIT = 8;

/**
 * Rank a match the way typing a few letters feels like it should: a title that
 * starts with what you typed comes first, then a word inside the title, then a
 * course name or assignment code. Every term has to land somewhere, so
 * "phys quiz" finds the physics quiz and nothing else.
 */
function rank(a: Assignment, course: string, terms: string[]): number | null {
  const title = a.title.toLowerCase();
  const haystack = `${title} ${course.toLowerCase()} ${a.code.toLowerCase()} ${a.due.toLowerCase()}`;

  let best = Number.POSITIVE_INFINITY;
  for (const term of terms) {
    if (!haystack.includes(term)) return null;
    const at = title.indexOf(term);
    const place =
      at === 0 ? 0 : at > 0 && !/[a-z0-9]/.test(title[at - 1]) ? 1 : at > 0 ? 2 : 3;
    best = Math.min(best, place);
  }
  return best;
}

export default function CommandPalette() {
  const s = useStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /* Whatever had focus before, so closing puts it back where it was. */
  const restoreTo = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setCursor(0);
    restoreTo.current?.focus?.();
    restoreTo.current = null;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) return;
      // The streamed Schoology viewer owns the keyboard while it is up.
      if (document.querySelector("[data-schoology-viewer]")) return;
      e.preventDefault();
      setOpen((was) => {
        if (was) return false;
        restoreTo.current = document.activeElement as HTMLElement | null;
        return true;
      });
      setQuery("");
      setCursor(0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => {
    if (!open) return [];
    const courses = new Map(s.snapshot.courses.map((c) => [c.id, c]));
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

    // Nothing typed yet: offer the plan, nearest first, rather than an empty
    // panel — the same order the board reads in.
    if (!terms.length) {
      const order: Bucket[] = ["tonight", "soon", "week"];
      return s.snapshot.assignments
        .filter((a) => s.onBoard(a) && s.statusOf(a) !== "done")
        .sort((x, y) => order.indexOf(s.bucketOf(x)) - order.indexOf(s.bucketOf(y)))
        .slice(0, LIMIT);
    }

    return s.snapshot.assignments
      .map((a) => ({ a, score: rank(a, courses.get(a.courseId)?.name ?? "", terms) }))
      .filter((hit): hit is { a: Assignment; score: number } => hit.score !== null)
      // Best match first; between equals, work you still owe beats work you've
      // already handed in. Past that the snapshot's due-date order stands.
      .sort(
        (x, y) =>
          x.score - y.score ||
          Number(s.statusOf(x.a) === "done") - Number(s.statusOf(y.a) === "done")
      )
      .slice(0, LIMIT)
      .map((hit) => hit.a);
  }, [open, query, s]);

  // Clamped rather than corrected after the fact: a result list that shrinks
  // as you type must never leave the highlight pointing past the end.
  const selected = results.length ? Math.min(cursor, results.length - 1) : 0;

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected, results]);

  if (!open) return null;

  const choose = (a: Assignment) => {
    s.openAssignment(a.id);
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!results.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setCursor((selected + step + results.length) % results.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const picked = results[selected];
      if (picked) choose(picked);
    }
  };

  return (
    <div className="palette-backdrop" onMouseDown={close}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search assignments"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 16px",
            height: 52,
            borderBottom: results.length ? "1px solid var(--line)" : undefined,
          }}
        >
          <SearchIcon size={16} />
          <input
            ref={inputRef}
            className="bare-field"
            style={{ fontSize: 15 }}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search assignments"
            aria-label="Search assignments"
            aria-controls="palette-results"
            autoComplete="off"
            spellCheck={false}
          />
          <span
            style={{
              flexShrink: 0,
              fontSize: 11,
              color: "var(--muted)",
              border: "1px solid var(--line)",
              borderRadius: 6,
              padding: "1px 5px",
            }}
          >
            esc
          </span>
        </div>

        <div
          id="palette-results"
          ref={listRef}
          role="listbox"
          aria-label="Assignments"
          style={{ maxHeight: 380, overflowY: "auto", padding: results.length ? 6 : 0 }}
        >
          {results.map((a, i) => {
            const course = s.courseById(a.courseId);
            const done = s.statusOf(a) === "done";
            const isSelected = i === selected;
            return (
              <button
                key={a.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                data-selected={isSelected}
                className="palette-row"
                onMouseMove={() => setCursor(i)}
                onClick={() => choose(a)}
                style={{ background: isSelected ? "var(--hover)" : "transparent" }}
              >
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span
                    className="truncate"
                    style={{
                      display: "block",
                      fontSize: 14,
                      color: done ? "var(--muted)" : "var(--text)",
                      textDecoration: done ? "line-through" : undefined,
                    }}
                  >
                    {a.title}
                  </span>
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      marginTop: 3,
                      fontSize: 12,
                      color: "var(--muted)",
                    }}
                  >
                    {course && <Badge tone={course.tone}>{course.short}</Badge>}
                    <span className="truncate">{done ? "Turned in" : a.due}</span>
                    {!done && (
                      <>
                        <ClockIcon />
                        {fmtMinutes(a.minutes)}
                      </>
                    )}
                  </span>
                </span>
                <span style={{ flexShrink: 0, fontSize: 12, color: "var(--faint)" }}>
                  {!s.onBoard(a) ? "Earlier" : done ? COLUMN.done : COLUMN[s.bucketOf(a)]}
                </span>
              </button>
            );
          })}

          {!results.length && (
            <p style={{ margin: 0, padding: "18px 16px", fontSize: 13, color: "var(--muted)" }}>
              {s.snapshot.assignments.length
                ? `Nothing matches “${query.trim()}”.`
                : "Nothing synced yet."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
