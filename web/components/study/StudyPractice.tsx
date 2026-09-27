"use client";

import { useState } from "react";

import type { StudyAnswer, StudyQuestion, StudySet } from "@/lib/study/types";
import TutorMarkdown from "../TutorMarkdown";
import { Icon, ICON, Spinner } from "../ui";

/**
 * Practice until it clicks: one question at a time, the answer explained the
 * moment it's given, and another round — aimed at what was missed — whenever
 * the current one runs out.
 */

function ShortAnswer({ question, test, onDone }: { question: StudyQuestion; test: string; onDone: (answer: StudyAnswer) => void }) {
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sample, setSample] = useState(false);

  async function check() {
    setChecking(true);
    setError(null);
    try {
      const response = await fetch("/api/study/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: question.prompt, answer: text, rubric: question.rubric, assessment: test }),
      });
      const body = (await response.json()) as { feedback?: string; error?: string };
      if (!response.ok || !body.feedback) throw new Error(body.error ?? "Marking failed.");
      setFeedback(body.feedback);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="study-short">
      <textarea className="input study-short-input" rows={5} value={text} disabled={!!feedback} placeholder="Write your answer" onChange={(event) => setText(event.target.value)} />
      {error && <p className="study-notice is-bad" role="alert"><Icon path={ICON.alert} size={13} /> {error}</p>}
      {!feedback ? (
        <div className="study-card-actions is-left">
          <button type="button" className="btn btn--primary" disabled={!text.trim() || checking} onClick={() => void check()}>
            {checking ? <><Spinner size={12} /> Checking</> : "Check my answer"}
          </button>
          <button type="button" className="btn btn--quiet" onClick={() => onDone({ correct: false, text, at: Date.now() })}>I don’t know</button>
        </div>
      ) : (
        <>
          <div className="study-feedback">{feedback}</div>
          {question.sample && (
            <button type="button" className="study-link" onClick={() => setSample((value) => !value)}>{sample ? "Hide the sample answer" : "Show a sample answer"}</button>
          )}
          {sample && question.sample && <div className="study-sample"><TutorMarkdown text={question.sample} /></div>}
          <div className="study-card-actions is-left">
            <span className="study-muted">How did it go?</span>
            <button type="button" className="btn btn--quiet study-again" onClick={() => onDone({ correct: false, text, feedback, at: Date.now() })}>I missed parts</button>
            <button type="button" className="btn btn--primary" onClick={() => onDone({ correct: true, text, feedback, at: Date.now() })}>I had it</button>
          </div>
        </>
      )}
    </div>
  );
}

export default function StudyPractice({
  set,
  onAnswer,
  onMore,
}: {
  set: StudySet;
  onAnswer: (questionId: string, answer: StudyAnswer) => void;
  onMore: () => void;
}) {
  const pending = set.questions.filter((question) => !set.progress.answers[question.id]);
  const [showing, setShowing] = useState<string | null>(null);
  const current = set.questions.find((question) => question.id === showing) ?? pending[0];
  const answer = current ? set.progress.answers[current.id] : undefined;
  const answered = set.questions.filter((question) => set.progress.answers[question.id]?.correct != null);
  const right = answered.filter((question) => set.progress.answers[question.id]!.correct).length;

  function next() {
    setShowing(pending.find((question) => question.id !== current?.id)?.id ?? "done");
  }

  /** Keeps the answered question on screen, with its explanation, until "Next". */
  function answer_(questionId: string, result: StudyAnswer) {
    setShowing(questionId);
    onAnswer(questionId, result);
  }

  if (!current || showing === "done") {
    const topics = new Map<string, { right: number; total: number }>();
    for (const question of answered) {
      const entry = topics.get(question.topic) ?? { right: 0, total: 0 };
      entry.total += 1;
      if (set.progress.answers[question.id]!.correct) entry.right += 1;
      topics.set(question.topic, entry);
    }
    const missed = answered.filter((question) => !set.progress.answers[question.id]!.correct);
    return (
      <div className="study-practice">
        <div className="study-done">
          <p><strong>{answered.length ? `${right} of ${answered.length} right` : "No practice answered yet"}</strong></p>
          {topics.size > 0 && (
            <ul className="study-topics">
              {[...topics].sort((a, b) => a[1].right / a[1].total - b[1].right / b[1].total).map(([topic, score]) => (
                <li key={topic}>
                  <span>{topic}</span>
                  <span className="study-topic-bar" aria-hidden="true"><span style={{ transform: `scaleX(${score.right / score.total})` }} /></span>
                  <span className="study-muted">{score.right}/{score.total}</span>
                </li>
              ))}
            </ul>
          )}
          {set.practicing ? (
            <p className="study-muted"><Spinner size={12} /> Writing new questions{missed.length ? ` aimed at the ${missed.length} you missed` : ""}…</p>
          ) : (
            <div className="study-card-actions is-left">
              <button type="button" className="btn btn--primary" onClick={() => { setShowing(null); onMore(); }}>
                {missed.length ? "More practice on what I missed" : "More practice"}
              </button>
              {pending.length > 0 && <button type="button" className="btn btn--quiet" onClick={() => setShowing(null)}>Back to questions</button>}
            </div>
          )}
          {set.practiceError && <p className="study-notice is-bad" role="alert"><Icon path={ICON.alert} size={13} /> {set.practiceError}</p>}
        </div>
      </div>
    );
  }

  const position = set.questions.indexOf(current) + 1;
  return (
    <div className="study-practice">
      <div className="study-cards-bar">
        <span className="study-muted">Question {position} of {set.questions.length}{current.round > 1 ? ` · round ${current.round}` : ""} · {current.topic}</span>
        <span className="study-muted">{right} of {answered.length} right</span>
      </div>
      <div className="study-question">
        <TutorMarkdown text={current.prompt} className="study-question-prompt" />
        {current.type === "mcq" ? (
          <>
            <ol className="study-choices">
              {current.choices!.map((choice, index) => {
                const state = answer
                  ? index === current.answer ? " is-right" : index === answer.picked ? " is-wrong" : ""
                  : "";
                return (
                  <li key={index}>
                    <button
                      type="button"
                      className={`study-choice${state}`}
                      disabled={!!answer}
                      onClick={() => answer_(current.id, { correct: index === current.answer, picked: index, at: Date.now() })}
                    >
                      <span className="study-choice-key">{String.fromCharCode(65 + index)}</span>
                      <TutorMarkdown text={choice} />
                    </button>
                  </li>
                );
              })}
            </ol>
            {answer && (
              <div className={`study-feedback${answer.correct ? " is-right" : " is-wrong"}`}>
                <strong>{answer.correct ? "Right." : "Not quite."}</strong> <TutorMarkdown text={current.explanation ?? ""} />
              </div>
            )}
          </>
        ) : answer ? (
          <div className={`study-feedback${answer.correct ? " is-right" : " is-wrong"}`}>
            <strong>{answer.correct ? "You had it." : "Marked to review."}</strong> {answer.feedback}
          </div>
        ) : (
          <ShortAnswer key={current.id} question={current} test={set.title} onDone={(result) => answer_(current.id, result)} />
        )}
        {answer && (
          <div className="study-card-actions is-left">
            <button type="button" className="btn btn--primary" onClick={next}>{pending.some((question) => question.id !== current.id) ? "Next question" : "See how you did"}</button>
            {current.source && <span className="study-muted">From source [{current.source}]</span>}
          </div>
        )}
      </div>
    </div>
  );
}
