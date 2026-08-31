"use client";

import { useEffect, useState } from "react";

import type { AssessmentReview, AttemptReview, QuestionResult } from "@/lib/types";
import { Dot } from "./ui";

/**
 * What actually happened inside an assessment you already handed in.
 *
 * Schoology reduces a finished attempt to one number in the gradebook; this is
 * the question-by-question marking behind it, alongside what each question
 * asked and the answer that was submitted.
 *
 * How much of that arrives varies, and the layout has to hold either way: the
 * marks come from Schoology's API and are always there, while the questions are
 * read out of its rendered review and can be missing. A quiz built as an answer
 * sheet for a paper worksheet is also honestly thin — prompts of "Q1", choices
 * of "A" to "D" — because that is genuinely all Schoology was given.
 *
 * Fetched when opened rather than during sync — it costs a real page visit per
 * item, and most items are never opened.
 */
const TONE: Record<QuestionResult["state"], { color: string; label: string }> = {
  correct: { color: "var(--good)", label: "correct" },
  partial: { color: "var(--warn)", label: "partial credit" },
  missed: { color: "var(--bad)", label: "missed" },
  pending: { color: "var(--muted)", label: "not marked yet" },
  dropped: { color: "var(--muted)", label: "thrown out by your teacher" },
};

/**
 * The submitted answer, however it was given.
 *
 * Letter choices are drawn as the row of options they were, with the picked one
 * filled, because that reads the way the quiz did. Options with real wording
 * would make those pills unreadably wide, so those name the pick instead.
 */
function Answer({ q, color }: { q: QuestionResult; color: string }) {
  if (q.written) {
    return (
      <span style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.5 }}>
        <span style={{ color: "var(--muted)" }}>You wrote: </span>
        {q.written}
      </span>
    );
  }

  const options = q.options ?? [];
  if (!options.length) return null;
  const chosen = options.filter((o) => o.chosen).map((o) => o.label);

  if (options.every((o) => o.label.length <= 3)) {
    return (
      <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {options.map((o, i) => (
          <span
            key={`${o.label}-${i}`}
            style={{
              minWidth: 20,
              padding: "1px 5px",
              borderRadius: 5,
              textAlign: "center",
              fontSize: 11,
              fontWeight: o.chosen ? 600 : 400,
              color: o.chosen ? color : "var(--muted)",
              border: `1px solid ${o.chosen ? color : "var(--line)"}`,
              background: o.chosen ? `color-mix(in oklab, ${color} 14%, transparent)` : "transparent",
            }}
          >
            {o.label}
          </span>
        ))}
      </span>
    );
  }

  return (
    <span style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.5 }}>
      <span style={{ color: "var(--muted)" }}>You chose: </span>
      {chosen.join(", ") || "nothing"}
    </span>
  );
}

function QuestionRow({ q, showKind }: { q: QuestionResult; showKind: boolean }) {
  const tone = TONE[q.state];
  const dropped = q.state === "dropped";
  const foot = [showKind ? q.kind : null, q.byHand && q.state !== "pending" ? "marked by hand" : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "3px 22px 1fr auto",
        gap: 10,
        alignItems: "start",
        padding: "12px 0",
        borderTop: "1px solid var(--line)",
        opacity: dropped ? 0.55 : 1,
      }}
    >
      {/* Carries the marking as colour, so a scan down the edge finds the
          questions that cost points without reading any of them. */}
      <span style={{ borderRadius: 2, background: tone.color, alignSelf: "stretch" }} />
      <span className="tabular" style={{ fontSize: 11, color: "var(--muted)", paddingTop: 2 }}>
        {q.n}
      </span>

      <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
        <span style={{ fontSize: 12.5, color: "var(--text)", lineHeight: 1.45 }}>
          {q.stem || `Question ${q.n}`}
        </span>
        <Answer q={q} color={tone.color} />
        {foot && <span style={{ fontSize: 11, color: "var(--muted)" }}>{foot}</span>}
      </div>

      <span
        className="tabular"
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: tone.color,
          whiteSpace: "nowrap",
          paddingTop: 1,
          textDecoration: dropped ? "line-through" : "none",
        }}
        title={tone.label}
      >
        {q.state === "pending" ? "not marked" : `${q.earned}/${q.possible}`}
      </span>
    </div>
  );
}

function Attempt({ a, only, gradedOutOf }: { a: AttemptReview; only: boolean; gradedOutOf?: number | null }) {
  const counts = a.questions.reduce<Record<string, number>>((acc, q) => {
    acc[q.state] = (acc[q.state] ?? 0) + 1;
    return acc;
  }, {});
  const marking = (["missed", "partial", "pending", "dropped"] as const)
    .filter((k) => counts[k])
    .map((k) => `${counts[k]} ${TONE[k].label}`)
    .join(" · ");

  /*
   * A quiz is usually all of one kind, and naming it on all sixteen rows says
   * nothing sixteen times. When that's the case it moves up here instead, and
   * only a genuinely mixed quiz labels its rows individually.
   */
  const kinds = new Set(a.questions.map((q) => q.kind).filter(Boolean));
  const summary = [
    kinds.size === 1
      ? `${a.questions.length} ${[...kinds][0]!.toLowerCase()} questions`
      : a.questions.length
        ? `${a.questions.length} questions`
        : null,
    marking || (counts.correct === a.questions.length ? "every one correct" : null),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        {!only && (
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>Attempt {a.n}</span>
        )}
        {a.possible ? (
          <span className="tabular" style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
            {a.earned}/{a.possible}
            {/* The questions don't always add up to the gradebook total — a
                10-point quiz can be built from 6 one-point questions — so say
                which number this is rather than letting them look wrong. */}
            {gradedOutOf != null && gradedOutOf !== a.possible && (
              <span style={{ fontWeight: 400, color: "var(--muted)" }}>
                {" "}
                on the questions · graded out of {gradedOutOf}
              </span>
            )}
          </span>
        ) : null}
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {[a.modified, a.minutes ? `${a.minutes} min` : null].filter(Boolean).join(" · ")}
        </span>
      </div>

      {a.error ? (
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{a.error}</span>
      ) : (
        <>
          {summary && <span style={{ fontSize: 12, color: "var(--muted)" }}>{summary}</span>}
          <div style={{ display: "flex", flexDirection: "column" }}>
            {a.questions.map((q) => (
              <QuestionRow key={q.n} q={q} showKind={kinds.size > 1} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * What to say about the questions, when they need explaining.
 *
 * Both thin cases look like a bug and aren't: a quiz that is really a bubble
 * sheet for a paper worksheet, and a review Schoology declined to render. Empty
 * when the questions came through as questions and speak for themselves.
 */
function caveat(graded: AttemptReview[]): string {
  const stems = graded.flatMap((a) => a.questions).flatMap((q) => (q.stem ? [q.stem.trim()] : []));
  if (!stems.length) {
    return "Schoology didn't render the questions this time, so this is the marking only. Closing and reopening this usually picks them up.";
  }
  // "Q1", "3.", "Question 4" — a numbering, not a question.
  if (stems.every((s) => /^(q(uestion)?\s*)?\d+[.)]?$/i.test(s))) {
    return "This one is set up as an answer sheet: Schoology holds only the numbering and the choice you bubbled, so the questions themselves are on the worksheet your teacher handed out.";
  }
  return "";
}

/** One row of the attempts table — everything Schoology's own attempt list shows, at a glance. */
function AttemptRow({ a, onView }: { a: AttemptReview; onView: () => void }) {
  const status = !a.completed ? "In progress" : a.reviewable ? "Submitted" : "Awaiting release";
  const statusColor = !a.completed ? "var(--muted)" : a.reviewable ? "var(--good)" : "var(--warn)";
  const viewable = a.completed && !a.error;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "44px 1fr 80px 72px 210px 76px",
        gap: 14,
        alignItems: "center",
        padding: "13px 0",
        borderTop: "1px solid var(--line)",
      }}
    >
      <span className="tabular" style={{ fontSize: 13, color: "var(--muted)" }}>
        #{a.n}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: "var(--text)" }}>
        <Dot color={statusColor} radius={9999} />
        {status}
      </span>
      <span className="tabular" style={{ fontSize: 13, color: "var(--muted)" }}>
        {a.possible ? `${a.earned}/${a.possible}` : "—"}
      </span>
      <span className="tabular" style={{ fontSize: 13, color: "var(--muted)" }}>
        {a.minutes ? `${a.minutes}m` : "—"}
      </span>
      <span className="truncate" style={{ fontSize: 13, color: "var(--muted)", textAlign: "right" }}>
        {a.modified}
      </span>
      <button
        type="button"
        className="btn btn--quiet"
        style={{ height: 28, padding: "0 10px", fontSize: 12, justifySelf: "end" }}
        onClick={onView}
        disabled={!viewable}
        title={!a.completed ? "Still in progress" : a.error}
      >
        View
      </button>
    </div>
  );
}

/**
 * One attempt, full screen — the same weight `SchoologyFrame` gives a live
 * attempt, because reading through sixteen questions deserves the room a card
 * embedded in the assignment page doesn't have.
 */
function AttemptFullscreen({
  a,
  title,
  gradedOutOf,
  onClose,
}: {
  a: AttemptReview;
  title: string;
  gradedOutOf?: number | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tail = a.questions.length ? caveat([a]) : "";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "color-mix(in oklab, var(--bg) 88%, black)",
        display: "flex",
        flexDirection: "column",
        padding: 16,
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
          {title} · Attempt {a.n}
        </span>
        <span style={{ flex: 1 }} />
        {a.possible ? (
          <span className="tabular" style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
            {a.earned}/{a.possible}
          </span>
        ) : null}
        <button type="button" className="btn" style={{ height: 32 }} onClick={onClose}>
          Close
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
          <Attempt a={a} only gradedOutOf={gradedOutOf} />
          {tail && (
            <span style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>{tail}</span>
          )}
        </div>
      </div>
    </div>
  );
}

interface Props {
  url: string;
  /**
   * When a caller has already fetched (or is fetching) the review itself —
   * `AssignmentView` does this to decide whether to show a submission box at
   * all before this ever mounts — pass the result through instead of firing a
   * second real page visit for the same item. Omit to have this fetch on its
   * own, as `AssessmentPanel`'s on-demand toggle does.
   */
  preloaded?: { review: AssessmentReview | null; error: string | null };
}

export default function QuestionReview({ url, preloaded }: Props) {
  const [fetched, setFetched] = useState<AssessmentReview | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const controlled = preloaded !== undefined;
  const review = controlled ? preloaded.review : fetched;
  const error = controlled ? preloaded.error : fetchError;

  // Mounted fresh per item (callers key on the URL), so there is no previous
  // item's marks to clear here — this only ever fetches. Skipped entirely in
  // controlled mode, where the caller owns the request.
  useEffect(() => {
    if (controlled) return;
    let live = true;
    (async () => {
      try {
        const res = await fetch(`/api/assessment/review?url=${encodeURIComponent(url)}`, {
          cache: "no-store",
        });
        const body = await res.json();
        if (!live) return;
        if (!res.ok) throw new Error(body.error ?? "Couldn't read the results.");
        setFetched(body);
      } catch (e) {
        if (live) setFetchError(e instanceof Error ? e.message : "Couldn't read the results.");
      }
    })();
    return () => {
      live = false;
    };
  }, [url, controlled]);

  const [openId, setOpenId] = useState<string | null>(null);

  const note = (text: string) => (
    <span style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>{text}</span>
  );

  // Newest first: the attempt that set the current grade is the one usually being looked for.
  const attempts = review?.online ? [...review.attempts].reverse() : [];
  const open = attempts.find((a) => a.submissionId === openId) ?? null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "18px 20px",
        borderRadius: "var(--radius-sm)",
        background: "var(--sunken)",
        border: "1px solid var(--line)",
      }}
    >
      {error && <span style={{ fontSize: 12, color: "var(--warn)" }}>{error}</span>}

      {!error && !review && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Checking…</span>
          <div className="progress" />
        </div>
      )}

      {review && !review.online && note("Schoology doesn't host this one as an online assessment, so there are no questions to break down — the score came from your teacher.")}

      {review?.online && attempts.length === 0 && note("No attempts handed in yet.")}

      {review?.online && attempts.length > 0 && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "44px 1fr 80px 72px 210px 76px",
              gap: 14,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.02em",
              textTransform: "uppercase",
              color: "var(--muted)",
            }}
          >
            <span>#</span>
            <span>Status</span>
            <span>Score</span>
            <span>Time</span>
            <span style={{ textAlign: "right" }}>Modified</span>
            <span />
          </div>
          {attempts.map((a) => (
            <AttemptRow key={a.submissionId} a={a} onView={() => setOpenId(a.submissionId)} />
          ))}
        </>
      )}

      {open && (
        <AttemptFullscreen
          a={open}
          title={review!.title}
          gradedOutOf={review!.pointsPossible}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
