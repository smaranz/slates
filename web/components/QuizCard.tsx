"use client";

import { useState } from "react";

import type { Quiz, QuizFRQuestion } from "@/lib/tutor-quiz";
import GraphCard from "./GraphCard";
import MathText from "./MathText";
import { Icon, ICON } from "./ui";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

function MCQ({
  q,
  index,
  onSelect,
}: {
  q: Extract<Quiz["questions"][number], { type: "mcq" }>;
  index: number;
  onSelect: (choice: number) => void;
}) {
  const answered = q.selected != null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: "var(--text)" }}>
        <span style={{ color: "var(--muted)" }}>{index + 1}. </span>
        <MathText text={q.prompt} />
      </p>
      {q.graph && <GraphCard graph={q.graph} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {q.choices.map((choice, i) => {
          const isCorrect = i === q.answer;
          const isPicked = i === q.selected;
          const tone = !answered ? null : isCorrect ? "var(--good)" : isPicked ? "var(--bad)" : null;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(i)}
              disabled={answered}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                width: "100%",
                textAlign: "left",
                borderRadius: "var(--radius-xs)",
                border: `1px solid ${tone ?? "var(--line)"}`,
                background: tone ? `color-mix(in oklab, ${tone} 12%, transparent)` : "var(--sunken)",
                padding: "9px 11px",
                font: "inherit",
                fontSize: 13,
                color: tone ?? "var(--text)",
                cursor: answered ? "default" : "pointer",
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  width: 18,
                  paddingTop: 2,
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--muted)",
                }}
              >
                {LETTERS[i]}
              </span>
              <span style={{ flex: 1 }}>
                <MathText text={choice} />
              </span>
              {answered && (isCorrect || isPicked) && (
                <Icon path={isCorrect ? ICON.check : ICON.close} size={13} style={{ flexShrink: 0, color: tone ?? undefined }} />
              )}
            </button>
          );
        })}
      </div>
      {answered && q.explanation && (
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--muted)" }}>
          <MathText text={q.explanation} />
        </p>
      )}
    </div>
  );
}

function FRQ({
  q,
  index,
  onReveal,
  onRequestFeedback,
  busy,
}: {
  q: QuizFRQuestion;
  index: number;
  onReveal: () => void;
  onRequestFeedback: (answer: string) => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState("");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: "var(--text)" }}>
        <span style={{ color: "var(--muted)" }}>{index + 1}. </span>
        <MathText text={q.prompt} />
      </p>
      {q.graph && <GraphCard graph={q.graph} />}
      {q.rubric && (
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: "var(--muted)" }}>
          <span style={{ color: "var(--text-2)", fontWeight: 600 }}>What a full answer covers: </span>
          <MathText text={q.rubric} />
        </p>
      )}
      <div className="ph-field">
        <textarea
          className="textarea"
          style={{ minHeight: 70 }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={`Your answer to question ${index + 1}`}
          placeholder=" "
        />
        <span className="ph-field__hint" aria-hidden>
          Type your answer here
        </span>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn--quiet"
          style={{ height: 30 }}
          disabled={!draft.trim() || busy}
          onClick={() => onRequestFeedback(draft.trim())}
        >
          Get feedback
        </button>
        {q.sampleAnswer && !q.revealed && (
          <button type="button" className="btn btn--quiet" style={{ height: 30 }} onClick={onReveal}>
            Show sample answer
          </button>
        )}
      </div>
      {q.revealed && q.sampleAnswer && (
        <p
          style={{
            margin: 0,
            fontSize: 12.5,
            lineHeight: 1.5,
            color: "var(--text-2)",
            borderRadius: "var(--radius-xs)",
            background: "var(--sunken)",
            padding: "9px 11px",
          }}
        >
          <MathText text={q.sampleAnswer} />
        </p>
      )}
    </div>
  );
}

export default function QuizCard({
  quiz,
  onSelect,
  onReveal,
  onRequestFeedback,
  busy,
}: {
  quiz: Quiz;
  onSelect: (questionIndex: number, choice: number) => void;
  onReveal: (questionIndex: number) => void;
  onRequestFeedback: (question: QuizFRQuestion, answer: string) => void;
  busy: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--line)",
        background: "var(--surface)",
        padding: "16px 18px",
      }}
    >
      {quiz.title && (
        <span className="section-label" style={{ margin: 0 }}>
          <MathText text={quiz.title} />
        </span>
      )}
      {quiz.questions.map((q, i) =>
        q.type === "mcq" ? (
          <MCQ key={i} q={q} index={i} onSelect={(choice) => onSelect(i, choice)} />
        ) : (
          <FRQ
            key={i}
            q={q}
            index={i}
            busy={busy}
            onReveal={() => onReveal(i)}
            onRequestFeedback={(answer) => onRequestFeedback(q, answer)}
          />
        )
      )}
    </div>
  );
}
