"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useStore } from "@/lib/store";
import {
  byWhenItMatters,
  courseNameOf,
  ingest,
  useStudy,
  type StudyModule,
  type StudySession,
} from "@/lib/study";
import type { Quiz, QuizFRQuestion } from "@/lib/tutor-quiz";
import type { Assignment } from "@/lib/types";
import QuizCard from "./QuizCard";
import { Icon, ICON } from "./ui";

/**
 * Study Studio — one prepared module per real assessment on the board.
 *
 * The premise is the thing a general tutor cannot copy: Slates already knows
 * the test exists, what the teacher wrote about it, what was handed out with
 * it, when it is, and how this student has been scoring in that class. So the
 * studio never asks "what do you want to study?" — it lists the tests you
 * actually have and builds a module for the one you pick.
 *
 * Deliberately not a chat. The tutor view is the place for a conversation; a
 * module is a fixed artifact you sit down with, and it stays put between
 * sittings so returning to it is continuing rather than restarting.
 */

/* --------------------------------------------------------------- utilities */

/** How much runway is left, worded the way a student would say it. */
function runway(offset: number | null | undefined): { text: string; tone: string } {
  if (offset === null || offset === undefined) return { text: "No date", tone: "var(--muted)" };
  if (offset < 0) return { text: offset === -1 ? "Yesterday" : `${-offset} days ago`, tone: "var(--muted)" };
  if (offset === 0) return { text: "Today", tone: "var(--bad)" };
  if (offset === 1) return { text: "Tomorrow", tone: "var(--bad)" };
  if (offset <= 3) return { text: `In ${offset} days`, tone: "var(--warn, var(--bad))" };
  return { text: `In ${offset} days`, tone: "var(--muted)" };
}

function minutesOf(module: StudyModule): number {
  return module.plan?.steps.reduce((sum, s) => sum + s.minutes, 0) ?? 0;
}

function saidPlainly(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/* -------------------------------------------------------------- the studio */

export default function StudyView() {
  const s = useStore();
  const study = useStudy();
  const [openId, setOpenId] = useState<string | null>(null);

  /*
   * Keep the studio in step with the board. Runs on every snapshot change
   * rather than once on mount: a sync that lands while the studio is open
   * should make a newly posted test appear, not wait for a navigation.
   */
  useEffect(() => {
    ingest(s.snapshot.assignments);
  }, [s.snapshot.assignments]);

  const byId = useMemo(
    () => new Map(s.snapshot.assignments.map((a) => [a.id, a])),
    [s.snapshot.assignments]
  );

  /*
   * Modules paired with their live assignment, soonest first. The assignment
   * may be gone — an unpublished item, a new term — and the module survives
   * that, so everything downstream treats it as optional.
   */
  const rows = useMemo(() => {
    return study.modules
      .map((module) => ({ module, assignment: byId.get(module.assignmentId) }))
      /*
       * Only what's still ahead. A test already sat is not something to study
       * for, and leaving them here turns the studio into an archive you have
       * to look past to find the one that matters.
       *
       * The check is on the live assignment, so a module goes quiet on its own
       * the day after its test without anything being deleted — the plan and
       * its sessions stay in storage, and reappear if the date ever moves back.
       */
      .filter(({ assignment }) => (assignment?.dateOffset ?? 0) >= 0)
      .sort(byWhenItMatters);
  }, [study.modules, byId]);

  const open = openId ? rows.find((r) => r.module.id === openId) : undefined;

  if (open) {
    return (
      <ModuleView
        key={`${open.module.id}:${open.module.plan?.generator.at ?? 0}`}
        module={open.module}
        assignment={open.assignment}
        onBack={() => setOpenId(null)}
      />
    );
  }

  return (
    <div className="scroll centered">
      <div className="col" style={{ maxWidth: 1100, gap: 14 }}>
      <header className="study-head">
        <div>
          <h1 className="study-title">Study Studio</h1>
          <p className="study-sub">
            Every test and quiz on your board, each with a module built from what your teacher
            actually posted.
          </p>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="study-empty">
          <Icon path={ICON.bands} size={22} />
          <p>Nothing coming up.</p>
          <span>
            When a teacher posts a test or quiz, it shows up here with a module you can build in
            a click.
          </span>
        </div>
      ) : (
        <div className="study-grid">
          {rows.map(({ module, assignment }) => (
            <ModuleCard
              key={module.id}
              module={module}
              assignment={assignment}
              course={courseNameOf(s.snapshot.courses, module.courseId)}
              sessions={study.sessionsFor(module.id)}
              onOpen={() => setOpenId(module.id)}
            />
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- the card */

function ModuleCard({
  module,
  assignment,
  course,
  sessions,
  onOpen,
}: {
  module: StudyModule;
  assignment: Assignment | undefined;
  course: string;
  sessions: StudySession[];
  onOpen: () => void;
}) {
  const when = runway(assignment?.dateOffset);
  const built = module.plan !== null;

  return (
    <button type="button" className="study-card" onClick={onOpen}>
      <div className="study-card-top">
        <span className="study-card-course">{course}</span>
        <span className="study-card-when" style={{ color: when.tone }}>
          {when.text}
        </span>
      </div>

      <h2 className="study-card-title">{module.title}</h2>

      <div className="study-card-foot">
        {module.building ? (
          <span className="study-chip study-chip--busy">
            <span className="study-spinner" aria-hidden />
            Building
          </span>
        ) : module.error ? (
          <span className="study-chip study-chip--bad">Couldn&rsquo;t build</span>
        ) : built ? (
          <>
            <span className="study-chip">{saidPlainly(minutesOf(module))}</span>
            {module.plan?.practice && (
              <span className="study-chip">
                {module.plan.practice.questions.length} practice
              </span>
            )}
            {sessions.length > 0 && (
              <span className="study-chip study-chip--quiet">
                {sessions.length === 1 ? "1 session" : `${sessions.length} sessions`}
              </span>
            )}
          </>
        ) : (
          <span className="study-chip study-chip--new">Not built yet</span>
        )}
      </div>
    </button>
  );
}

/* ---------------------------------------------------------------- the module */

function ModuleView({
  module,
  assignment,
  onBack,
}: {
  module: StudyModule;
  assignment: Assignment | undefined;
  onBack: () => void;
}) {
  const s = useStore();
  const study = useStudy();
  const [quiz, setQuiz] = useState<Quiz | null>(module.plan?.practice ?? null);

  /*
   * The unmount cleanup below reads the answers as they stood at the end, and
   * a cleanup closes over the render that registered it — so the live set is
   * mirrored into a ref for it to read.
   */
  const quizRef = useRef<Quiz | null>(quiz);
  useEffect(() => {
    quizRef.current = quiz;
  }, [quiz]);

  /*
   * A sitting starts when the module is opened and ends when it is left. The
   * recap is written from what actually happened in the practice, not from a
   * model call — a summary of nothing would be worse than no summary.
   */
  useEffect(() => {
    if (!module.plan) return;
    const id = study.startSession(module.id);
    const openedAt = Date.now();
    return () => {
      const answered = countAnswered(quizRef.current);
      const seconds = Math.round((Date.now() - openedAt) / 1000);

      /*
       * A sitting counts if practice was attempted or the module was actually
       * open for a while. Anything less was a glance, and a list of glances is
       * not a study history.
       */
      if (answered === 0 && seconds < 60) {
        study.dropSession(id);
        return;
      }

      const correct = countCorrect(quizRef.current);
      study.endSession(
        id,
        answered > 0
          ? `Worked ${answered} practice question${answered === 1 ? "" : "s"}, ${correct} right.`
          : `Read through the plan for ${saidPlainly(Math.max(1, Math.round(seconds / 60)))}.`,
        { answered, correct }
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module.id, module.plan !== null]);

  const build = useCallback(async () => {
    study.setModule(module.id, { building: true, error: undefined });

    /*
     * Everything Slates knows about this assessment, gathered here rather than
     * on the server: the snapshot lives in the browser, and shipping the whole
     * board to a route so it can pick one item out would be silly.
     */
    const grades = s.snapshot.assignments
      .filter((a) => a.courseId === module.courseId && a.grade && a.id !== module.assignmentId)
      .sort((a, b) => (a.dateOffset ?? 0) - (b.dateOffset ?? 0))
      .slice(-15)
      .map((a) => ({
        title: a.title,
        score: `${a.grade!.earned}/${a.grade!.possible}`,
        category: a.code || undefined,
      }));

    try {
      const res = await fetch("/api/study/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: module.title,
          course: courseNameOf(s.snapshot.courses, module.courseId),
          due: module.due,
          kind: assignment?.kind,
          brief: assignment?.brief,
          points: assignment?.points ?? null,
          assessment: assignment?.assessment
            ? {
                timeLimitMin: assignment.assessment.timeLimitMin ?? null,
                questionPoints: assignment.assessment.questionPoints ?? null,
              }
            : null,
          attachments: assignment?.attachments?.map((a) => a.title).filter(Boolean),
          grades,
        }),
      });

      const data = (await res.json()) as { plan?: StudyModule["plan"]; error?: string };
      if (!res.ok || !data.plan) throw new Error(data.error ?? `Request failed (${res.status})`);

      /* Storing the plan changes this view's key, which remounts it with the
         new practice — so there is nothing to set here. */
      study.setModule(module.id, { plan: data.plan, building: false, error: undefined });
    } catch (err) {
      study.setModule(module.id, {
        building: false,
        error: err instanceof Error ? err.message : "Building the module failed.",
      });
    }
  }, [module, assignment, s.snapshot, study]);

  /*
   * Free response is marked here rather than in the tutor. A module is a
   * sitting, not a thread: sending the student to another view to read one
   * paragraph of feedback would end the sitting to answer a question about it.
   */
  const [marking, setMarking] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const mark = useCallback(
    async (question: QuizFRQuestion, answer: string) => {
      setMarking(true);
      setFeedback(null);
      try {
        const res = await fetch("/api/study/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: question.prompt,
            answer,
            rubric: question.rubric,
            assessment: module.title,
          }),
        });
        const data = (await res.json()) as { feedback?: string; error?: string };
        if (!res.ok || !data.feedback) throw new Error(data.error ?? "Marking it failed.");
        setFeedback(data.feedback);
      } catch (err) {
        setFeedback(err instanceof Error ? err.message : "Marking it failed.");
      } finally {
        setMarking(false);
      }
    },
    [module.title]
  );

  const past = study.sessionsFor(module.id);
  const when = runway(assignment?.dateOffset);

  return (
    <div className="scroll centered">
      <div className="col" style={{ maxWidth: 820, gap: 14 }}>
      <button type="button" className="study-back" onClick={onBack}>
        <Icon path={ICON.chevronLeft} size={14} />
        All modules
      </button>

      <header className="study-module-head">
        <div className="study-module-meta">
          <span>{courseNameOf(s.snapshot.courses, module.courseId)}</span>
          <span style={{ color: when.tone }}>{when.text}</span>
          {module.due && <span>{module.due}</span>}
        </div>
        <h1 className="study-module-title">{module.title}</h1>
        {assignment && (
          <button
            type="button"
            className="study-link"
            onClick={() => s.openAssignment(assignment.id)}
          >
            Open the assignment
            <Icon path={ICON.external} size={12} />
          </button>
        )}
      </header>

      {!module.plan ? (
        <div className="study-build">
          <p>
            {module.building
              ? "Claude Opus 5 is reading the write-up, the handouts and your grades in this class."
              : "Nothing built yet. Slates will read the teacher’s write-up, whatever was posted with it, and your marks in this class, then put together a plan and practice on the same skills."}
          </p>
          <button
            type="button"
            className="btn btn--primary"
            onClick={build}
            disabled={module.building}
          >
            {module.building ? "Building…" : "Build the module"}
          </button>
          {module.error && <p className="study-error">{module.error}</p>}
        </div>
      ) : (
        <div className="study-module-body">
          <Section title="What it covers">
            <ul className="study-covers">
              {module.plan.covers.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </Section>

          {module.plan.weakTopics.length > 0 && (
            <Section title="Worth extra time">
              <ul className="study-weak">
                {module.plan.weakTopics.map((w, i) => (
                  <li key={i}>
                    <strong>{w.topic}</strong>
                    <span>{w.evidence}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title={`The plan · ${saidPlainly(minutesOf(module))}`}>
            <ol className="study-steps">
              {module.plan.steps.map((step, i) => (
                <li key={i}>
                  <div className="study-step-head">
                    <span className="study-step-title">{step.title}</span>
                    <span className="study-step-min">{step.minutes} min</span>
                  </div>
                  <p>{step.detail}</p>
                </li>
              ))}
            </ol>
          </Section>

          {quiz && (
            <Section title="Practice">
              <QuizCard
                quiz={quiz}
                busy={marking}
                onSelect={(qi, choice) =>
                  setQuiz((q) => (q ? patchQuestion(q, qi, { selected: choice }) : q))
                }
                onReveal={(qi) =>
                  setQuiz((q) => (q ? patchQuestion(q, qi, { revealed: true }) : q))
                }
                onRequestFeedback={mark}
              />
              {marking && <p className="study-marking">Marking your answer\u2026</p>}
              {feedback && <p className="study-feedback">{feedback}</p>}
            </Section>
          )}

          {past.length > 0 && (
            <Section title="Past sessions">
              <ul className="study-sessions">
                {past.slice(0, 6).map((session) => (
                  <li key={session.id}>
                    <span>{new Date(session.endedAt ?? 0).toLocaleDateString()}</span>
                    <span>{session.recap}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <footer className="study-module-foot">
            <span className="study-built">
              Built by {module.plan.generator.model} on{" "}
              {new Date(module.plan.generator.at).toLocaleDateString()}
            </span>
            <button
              type="button"
              className="btn"
              onClick={build}
              disabled={module.building}
            >
              {module.building ? "Rebuilding…" : "Rebuild"}
            </button>
          </footer>
          {module.error && <p className="study-error">{module.error}</p>}
        </div>
      )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="study-section">
      <span className="section-label">{title}</span>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ scoring */

function patchQuestion(quiz: Quiz, index: number, patch: Record<string, unknown>): Quiz {
  return {
    ...quiz,
    questions: quiz.questions.map((q, i) => (i === index ? { ...q, ...patch } : q)),
  };
}

function countAnswered(quiz: Quiz | null): number {
  if (!quiz) return 0;
  return quiz.questions.filter((q) => q.type === "mcq" && q.selected != null).length;
}

function countCorrect(quiz: Quiz | null): number {
  if (!quiz) return 0;
  return quiz.questions.filter((q) => q.type === "mcq" && q.selected === q.answer).length;
}
