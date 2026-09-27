"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { StudySummary } from "@/app/api/study/route";
import { useStore } from "@/lib/store";
import { studyTargets, type StudyTarget } from "@/lib/study/detect";
import type { BuildRequest, StudyItemInput } from "@/lib/study/types";
import type { Assignment, Course, SyncSnapshot } from "@/lib/types";
import StudySetView from "./study/StudySetView";
import { useStudySets } from "./study/useStudySets";
import { Icon, ICON, Spinner } from "./ui";

/**
 * Study Studio: every test and quiz coming up, and a study set for any of them
 * built from what the teacher actually posted in Schoology.
 *
 * The list is found, not typed in — Slates already knows which items are tests
 * (see lib/study/detect.ts). Building a set is the student's call, because it
 * reads the class's files and spends a model run on them.
 */

export function courseLabel(course: Pick<Course, "name" | "short"> | undefined): string {
  if (!course) return "Class";
  return course.short?.trim() || course.name.replace(/\s+-\s+\d+$/, "");
}

export function whenLabel(offset: number | null): { day: string; date: string; relative: string } {
  if (offset === null) return { day: "", date: "No date", relative: "No date yet" };
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() + offset);
  return {
    day: offset === 0 ? "Today" : offset === 1 ? "Tmrw" : day.toLocaleDateString(undefined, { weekday: "short" }),
    date: day.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    relative: offset === 0 ? "today" : offset === 1 ? "tomorrow" : `in ${offset} days`,
  };
}

function itemInput(assignment: Assignment): StudyItemInput {
  return {
    id: assignment.id,
    title: assignment.title.slice(0, 500),
    kind: assignment.kind,
    brief: assignment.brief?.slice(0, 20_000),
    due: assignment.due?.slice(0, 200),
    dateOffset: assignment.dateOffset,
    url: assignment.url || null,
    attachments: assignment.attachments?.slice(0, 40),
  };
}

function requestFor(target: StudyTarget, snapshot: SyncSnapshot): BuildRequest {
  const course = snapshot.courses.find((entry) => entry.id === target.courseId);
  return {
    target: {
      ...(target.assignment ? itemInput(target.assignment) : { id: target.id, title: target.title, due: target.due, dateOffset: target.dateOffset, url: target.url }),
      courseId: target.courseId,
      testKind: target.kind,
    },
    course: { id: target.courseId, name: course?.name ?? "this class" },
    related: snapshot.assignments.filter((entry) => entry.courseId === target.courseId && entry.id !== target.id).slice(0, 300).map(itemInput),
  };
}

const KIND_LABEL = { test: "Test", quiz: "Quiz", exam: "Exam" } as const;

function Row({
  target,
  course,
  summary,
  onBuild,
  onOpen,
}: {
  target: StudyTarget;
  course: string;
  summary: StudySummary | undefined;
  onBuild: () => void;
  onOpen: () => void;
}) {
  const when = whenLabel(target.dateOffset);
  const building = summary?.status === "gathering" || summary?.status === "writing";
  return (
    <li className="study-row">
      <div className={`study-when${target.dateOffset !== null && target.dateOffset <= 1 ? " is-soon" : ""}`}>
        <strong>{when.day || "—"}</strong>
        <span>{when.date}</span>
      </div>
      <button type="button" className="study-row-main" onClick={summary ? onOpen : onBuild} disabled={!summary && building}>
        <span className="study-row-course">{course}</span>
        <span className="study-row-title">{target.title}</span>
        <span className="study-row-meta">{KIND_LABEL[target.kind]} · {when.relative} · {target.because}</span>
      </button>
      <div className="study-row-side">
        {building ? (
          <span className="study-row-status"><Spinner size={12} /> {summary!.step || "Building"}</span>
        ) : summary?.status === "failed" ? (
          <>
            <span className="study-row-status is-bad">Couldn’t build</span>
            <button type="button" className="btn btn--quiet" onClick={onBuild}>Try again</button>
          </>
        ) : summary?.status === "ready" ? (
          <>
            <span className="study-row-status">
              {summary.cards} cards · {summary.questions} questions{summary.mastery !== null ? ` · ${summary.mastery}% right` : ""}
            </span>
            <button type="button" className="btn btn--quiet" onClick={onOpen}>Open</button>
          </>
        ) : (
          <button type="button" className="btn btn--primary" onClick={onBuild}>Build study set</button>
        )}
      </div>
    </li>
  );
}

function Picker({ snapshot, taken, onPick }: { snapshot: SyncSnapshot; taken: Set<string>; onPick: (assignment: Assignment) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const choices = snapshot.assignments
    .filter((assignment) => !taken.has(assignment.id) && !assignment.grade && (assignment.dateOffset === null || assignment.dateOffset >= 0))
    .sort((a, b) => (a.dateOffset ?? 999) - (b.dateOffset ?? 999));

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div className="study-picker" ref={wrap}>
      <button type="button" className="btn btn--quiet" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Icon path={ICON.plus} size={12} /> Study for something else
      </button>
      {open && (
        <div className="study-picker-pop" role="listbox" aria-label="Pick an assignment">
          {choices.length === 0 && <p className="study-muted">Nothing else is coming up.</p>}
          {choices.map((assignment) => (
            <button key={assignment.id} type="button" role="option" aria-selected={false} className="study-picker-item" onClick={() => { setOpen(false); onPick(assignment); }}>
              <span>{assignment.title}</span>
              <span className="study-muted">{courseLabel(snapshot.courses.find((course) => course.id === assignment.courseId))} · {whenLabel(assignment.dateOffset).relative}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function StudyView() {
  const s = useStore();
  const study = useStudySets();
  const [openId, setOpenId] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);

  const targets = useMemo(() => studyTargets(s.snapshot), [s.snapshot]);
  const byId = useMemo(() => new Map(study.sets.map((set) => [set.id, set])), [study.sets]);
  const courseOf = (id: string) => courseLabel(s.snapshot.courses.find((course) => course.id === id));

  async function build(target: StudyTarget) {
    setBuildError(null);
    try {
      await study.build(requestFor(target, s.snapshot));
    } catch (error) {
      setBuildError(error instanceof Error ? error.message : String(error));
    }
  }

  function buildOther(assignment: Assignment) {
    void build({
      id: assignment.id,
      courseId: assignment.courseId,
      title: assignment.title,
      kind: "test",
      because: "You picked this one",
      dateOffset: assignment.dateOffset,
      due: assignment.due,
      url: assignment.url || null,
      assignment,
    });
  }

  if (openId) {
    return (
      <StudySetView
        id={openId}
        domain={s.snapshot.domain}
        onBack={() => {
          setOpenId(null);
          void study.refresh();
        }}
        onRebuild={() => {
          const target = targets.find((entry) => entry.id === openId);
          const assignment = s.snapshot.assignments.find((entry) => entry.id === openId);
          if (target) void build(target);
          else if (assignment) buildOther(assignment);
        }}
      />
    );
  }

  const groups = [
    { label: "This week", rows: targets.filter((target) => target.dateOffset !== null && target.dateOffset <= 6) },
    { label: "Later", rows: targets.filter((target) => target.dateOffset !== null && target.dateOffset > 6) },
    { label: "No date yet", rows: targets.filter((target) => target.dateOffset === null) },
  ].filter((group) => group.rows.length);
  const targetIds = new Set(targets.map((target) => target.id));
  const others = study.sets.filter((set) => !targetIds.has(set.id));

  return (
    <div className="scroll centered">
      <div className="col study-home">
        <div className="study-home-bar">
          <p className="study-muted">
            {targets.length
              ? `${targets.length} ${targets.length === 1 ? "test or quiz" : "tests and quizzes"} coming up, found on your board and in your grades.`
              : "No tests or quizzes coming up on your board or in your grades."}
          </p>
          <Picker snapshot={s.snapshot} taken={targetIds} onPick={buildOther} />
        </div>

        {(buildError || study.error) && (
          <p className="study-notice is-bad" role="alert"><Icon path={ICON.alert} size={13} /> {buildError ?? study.error}</p>
        )}

        {groups.map((group) => (
          <section key={group.label} className="study-group" aria-label={group.label}>
            <h2>{group.label}</h2>
            <ul className="study-rows">
              {group.rows.map((target) => (
                <Row
                  key={target.id}
                  target={target}
                  course={courseOf(target.courseId)}
                  summary={byId.get(target.id)}
                  onBuild={() => void build(target)}
                  onOpen={() => setOpenId(target.id)}
                />
              ))}
            </ul>
          </section>
        ))}

        {others.length > 0 && (
          <section className="study-group" aria-label="Other study sets">
            <h2>Other study sets</h2>
            <ul className="study-rows">
              {others.map((set) => (
                <li key={set.id} className="study-row">
                  <div className="study-when"><strong>—</strong><span>Done</span></div>
                  <button type="button" className="study-row-main" onClick={() => setOpenId(set.id)}>
                    <span className="study-row-course">{courseOf(set.courseId)}</span>
                    <span className="study-row-title">{set.title}</span>
                    <span className="study-row-meta">{set.cards} cards · {set.questions} questions{set.mastery !== null ? ` · ${set.mastery}% right` : ""}</span>
                  </button>
                  <div className="study-row-side">
                    <button type="button" className="btn btn--quiet" onClick={() => void study.remove(set.id)}>Delete</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!targets.length && !others.length && study.loaded && (
          <p className="study-empty">
            When a teacher posts a test or quiz, or adds one to the gradebook, it shows up here. You can also build a set for any assignment with “Study for something else”.
          </p>
        )}
      </div>
    </div>
  );
}
