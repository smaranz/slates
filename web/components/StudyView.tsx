"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import type { StudySummary } from "@/app/api/study/route";
import { useStore } from "@/lib/store";
import { studyTargets, type StudyTarget, type TestKind } from "@/lib/study/detect";
import type { BuildRequest, StudyInputs, StudyItemInput, StudySet } from "@/lib/study/types";
import type { Assignment, Course, SyncSnapshot } from "@/lib/types";
import StudyBuildSheet, { type BuildChoice, type SheetTest } from "./study/StudyBuildSheet";
import StudySetView from "./study/StudySetView";
import { useStudySets } from "./study/useStudySets";
import { Icon, ICON, Spinner } from "./ui";

/**
 * Study Studio: every test and quiz coming up, and a study set for any of them
 * built from what the teacher actually posted in Schoology.
 *
 * The list is found, not typed in — Slates already knows which items are tests
 * (see lib/study/detect.ts). Building a set is the student's call, because it
 * reads the class's files and spends a model run on them, and before it runs
 * they can pick the Materials it reads, upload their own, or add a test Slates
 * didn't find.
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

/** Days from today to a yyyy-mm-dd date; null when there's no date. */
function offsetOf(day: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day ?? "");
  if (!m) return null;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() - start.getTime()) / 86_400_000);
}

function dueOf(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";
}

/** "c" and fourteen base-36 characters: what lib/study/store.ts accepts for a test added by hand. */
function customId(): string {
  return `c${[...crypto.getRandomValues(new Uint8Array(14))].map((byte) => (byte % 36).toString(36)).join("")}`;
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

/** What a build needs to know about the test itself, however it came to be on the list. */
interface TestSpec {
  id: string;
  courseId: string;
  title: string;
  kind: TestKind;
  dateOffset: number | null;
  due: string;
  url: string | null;
  assignment?: Assignment;
  /** Added by hand, with its yyyy-mm-dd date. */
  custom?: { date: string };
}

type Choice = Pick<BuildChoice, "picks" | "uploads" | "notes" | "auto">;

function choiceOf(inputs: StudyInputs | undefined): Choice | undefined {
  return inputs && { picks: inputs.picks, uploads: inputs.uploads.map((upload) => upload.id), notes: inputs.notes, auto: inputs.auto };
}

function requestFor(test: TestSpec, snapshot: SyncSnapshot, choice?: Choice): BuildRequest {
  const course = snapshot.courses.find((entry) => entry.id === test.courseId);
  return {
    target: {
      ...(test.assignment ? itemInput(test.assignment) : { id: test.id, title: test.title, due: test.due, dateOffset: test.dateOffset, url: test.url }),
      courseId: test.courseId,
      testKind: test.kind,
    },
    course: { id: test.courseId, name: course?.name ?? "this class" },
    ...(/^[\w.-]+\.schoology\.com$/.test(snapshot.domain ?? "") ? { domain: snapshot.domain } : {}),
    related: snapshot.assignments.filter((entry) => entry.courseId === test.courseId && entry.id !== test.id).slice(0, 300).map(itemInput),
    ...(choice ? { picks: choice.picks, uploads: choice.uploads, notes: choice.notes, auto: choice.auto } : {}),
    ...(test.custom ? { custom: true, ...(test.custom.date ? { date: test.custom.date } : {}) } : {}),
  };
}

function targetSpec(target: StudyTarget): TestSpec {
  return { id: target.id, courseId: target.courseId, title: target.title, kind: target.kind, dateOffset: target.dateOffset, due: target.due, url: target.url, assignment: target.assignment };
}

function assignmentSpec(assignment: Assignment): TestSpec {
  return { id: assignment.id, courseId: assignment.courseId, title: assignment.title, kind: "test", dateOffset: assignment.dateOffset, due: assignment.due, url: assignment.url || null, assignment };
}

const KIND_LABEL = { test: "Test", quiz: "Quiz", exam: "Exam" } as const;

/** One test on the list: found by Slates, or added by hand. */
interface Entry {
  id: string;
  courseId: string;
  title: string;
  kind: TestKind;
  dateOffset: number | null;
  because: string;
  target?: StudyTarget;
  custom?: StudySummary;
}

/** What's open in the build sheet, and what the build is for. */
type Sheet =
  | { test: SheetTest; initial?: StudyInputs; for: "target"; target: StudyTarget }
  | { test: SheetTest; initial?: StudyInputs; for: "assignment"; assignment: Assignment }
  | { test: SheetTest; initial?: StudyInputs; for: "custom"; id?: string }
  | { test: SheetTest; initial?: StudyInputs; for: "set"; set: StudySet };

function countdown(offset: number | null): string {
  if (offset === null) return "No date yet";
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  return `In ${offset} days`;
}

function CourseTag({ course }: { course: Course | undefined }) {
  return (
    <span className="study-course">
      <span className="study-course-dot" style={{ background: course?.dot ?? "var(--dim)" }} />
      {courseLabel(course)}
    </span>
  );
}

function DateTile({ offset }: { offset: number | null }) {
  if (offset === null) {
    return (
      <div className="study-date is-none" aria-label="No date yet">
        <span>No</span>
        <strong>–</strong>
        <span>date</span>
      </div>
    );
  }
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() + offset);
  return (
    <div className={`study-date${offset <= 1 ? " is-soon" : ""}`} aria-label={day.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}>
      <span>{offset === 0 ? "Today" : offset === 1 ? "Tmrw" : day.toLocaleDateString(undefined, { weekday: "short" })}</span>
      <strong>{day.getDate()}</strong>
      <span>{day.toLocaleDateString(undefined, { month: "short" })}</span>
    </div>
  );
}

/** How much of the set is right so far, as a ring. */
function Ring({ pct, size = 34 }: { pct: number | null; size?: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <span className={`study-ring${pct !== null && pct >= 80 ? " is-good" : ""}`} style={{ width: size, height: size }} role="img" aria-label={pct === null ? "Not practiced yet" : `${pct}% right so far`}>
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle cx="18" cy="18" r={r} className="study-ring-track" />
        {pct !== null && pct > 0 && <circle cx="18" cy="18" r={r} className="study-ring-fill" strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 18 18)" />}
      </svg>
      <span>{pct === null ? "–" : pct}</span>
    </span>
  );
}

function isBuilding(summary: StudySummary | undefined): boolean {
  return summary?.status === "gathering" || summary?.status === "writing";
}

/** The right-hand side of a test: build it, watch it build, or open it. */
function Status({ summary, loaded, onBuild, onOpen }: { summary: StudySummary | undefined; loaded: boolean; onBuild: () => void; onOpen: () => void }) {
  if (!loaded) return <span className="study-skeleton-pill" aria-hidden="true" />;
  if (isBuilding(summary)) {
    return (
      <button type="button" className="study-status is-building" onClick={onOpen}>
        <Spinner size={12} />
        <span>{summary!.step || "Building"}</span>
      </button>
    );
  }
  if (summary?.status === "failed") {
    return (
      <>
        <span className="study-status is-bad">Couldn’t build</span>
        <button type="button" className="btn btn--quiet" onClick={onBuild}>Try again</button>
      </>
    );
  }
  if (summary?.status === "ready") {
    return (
      <>
        <span className="study-status">
          {summary.cards} cards · {summary.questions} questions
        </span>
        <Ring pct={summary.mastery} />
        <button type="button" className="btn btn--quiet" onClick={onOpen}>Study</button>
      </>
    );
  }
  return (
    <button type="button" className="btn btn--primary" onClick={onBuild}>
      Build study set
    </button>
  );
}

function TestRow({ entry, course, summary, loaded, onBuild, onOpen }: { entry: Entry; course: Course | undefined; summary: StudySummary | undefined; loaded: boolean; onBuild: () => void; onOpen: () => void }) {
  return (
    <li className={`study-item${summary?.status === "ready" ? " is-ready" : ""}`}>
      <DateTile offset={entry.dateOffset} />
      <button type="button" className="study-item-main" onClick={summary ? onOpen : onBuild}>
        <span className="study-item-meta">
          <CourseTag course={course} />
          <span className="study-kind">{KIND_LABEL[entry.kind]}</span>
          {entry.custom && <span className="study-kind is-custom">Added by you</span>}
        </span>
        <span className="study-item-title">{entry.title}</span>
        {!entry.custom && <span className="study-item-why">{entry.because}</span>}
      </button>
      <div className="study-item-side">
        <Status summary={summary} loaded={loaded} onBuild={onBuild} onOpen={onOpen} />
      </div>
    </li>
  );
}

function NextUp({ entry, course, summary, loaded, onBuild, onOpen }: { entry: Entry; course: Course | undefined; summary: StudySummary | undefined; loaded: boolean; onBuild: () => void; onOpen: () => void }) {
  const day = whenLabel(entry.dateOffset);
  const building = isBuilding(summary);
  const ready = summary?.status === "ready";
  return (
    <section className="study-next" aria-label="Next up" style={{ "--course": course?.dot ?? "var(--dim)" } as CSSProperties}>
      <div className={`study-next-when${entry.dateOffset !== null && entry.dateOffset <= 1 ? " is-soon" : ""}`}>
        <span>Next up</span>
        <strong>{countdown(entry.dateOffset)}</strong>
        <span>{entry.dateOffset === null ? "" : day.date}</span>
      </div>
      <div className="study-next-main">
        <span className="study-item-meta">
          <CourseTag course={course} />
          <span className="study-kind">{KIND_LABEL[entry.kind]}</span>
          {entry.custom && <span className="study-kind is-custom">Added by you</span>}
        </span>
        <h2>{entry.title}</h2>
        <p>
          {!loaded
            ? " "
            : ready
              ? `${summary!.cards} flashcards and ${summary!.questions} practice questions${summary!.mastery !== null ? `, ${summary!.mastery}% right so far` : ", ready when you are"}.`
              : building
                ? summary!.step || "Building the study set."
                : summary?.status === "failed"
                  ? "The last build didn’t finish. Try it again, or change what it’s built from."
                  : "No study set yet. Slates reads what the teacher posted, plus anything you add, and writes a guide, flashcards and practice."}
        </p>
      </div>
      <div className="study-next-side">
        {ready && <Ring pct={summary!.mastery} size={48} />}
        {loaded && (
          ready ? (
            <button type="button" className="btn btn--primary study-btn-lg" onClick={onOpen}>Keep studying</button>
          ) : building ? (
            <button type="button" className="btn btn--quiet study-btn-lg" onClick={onOpen}><Spinner size={12} /> Watch it build</button>
          ) : (
            <button type="button" className="btn btn--primary study-btn-lg" onClick={onBuild}>
              {summary?.status === "failed" ? "Try again" : "Build study set"}
            </button>
          )
        )}
      </div>
    </section>
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
        Study for an assignment <Icon path={ICON.chevronDown} size={11} />
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

/** Every set on the host, most recent first: the library, beside the list of what's coming. */
function Library({ sets, courseOf, upcoming, onOpen, onDelete }: { sets: StudySummary[]; courseOf: (id: string) => Course | undefined; upcoming: Set<string>; onOpen: (id: string) => void; onDelete: (id: string) => void }) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const ordered = [...sets].sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <section className="study-panel" aria-labelledby="study-library">
      <div className="study-panel-head">
        <h2 id="study-library">Your study sets</h2>
        <span className="study-count">{sets.length}</span>
      </div>
      {ordered.length === 0 ? (
        <p className="study-muted">Sets you build show up here, with how much you’ve got right.</p>
      ) : (
        <ul className="study-library">
          {ordered.map((set) => {
            const past = !upcoming.has(set.id);
            return (
              <li key={set.id}>
                <button type="button" className="study-library-item" onClick={() => onOpen(set.id)}>
                  <span className="study-library-title">{set.title}</span>
                  <span className="study-library-meta">
                    {courseLabel(courseOf(set.courseId) ?? { name: set.course, short: "" })}
                    {" · "}
                    {isBuilding(set) ? "Building" : set.status === "failed" ? "Didn’t finish" : set.mastery !== null ? `${set.mastery}% right` : `${set.cards} cards`}
                  </span>
                  {set.status === "ready" && (
                    <span className="study-meter" aria-hidden="true"><span style={{ width: `${set.mastery ?? 0}%` }} /></span>
                  )}
                </button>
                {past && !isBuilding(set) && (
                  <button
                    type="button"
                    className={`study-x${confirming === set.id ? " is-confirming" : ""}`}
                    aria-label={confirming === set.id ? `Really delete ${set.title}?` : `Delete ${set.title}`}
                    title={confirming === set.id ? "Click again to delete" : "Delete"}
                    onClick={() => {
                      if (confirming === set.id) {
                        setConfirming(null);
                        onDelete(set.id);
                      } else {
                        setConfirming(set.id);
                        window.setTimeout(() => setConfirming((current) => (current === set.id ? null : current)), 4000);
                      }
                    }}
                  >
                    <Icon path={confirming === set.id ? ICON.trash : ICON.close} size={10} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default function StudyView() {
  const s = useStore();
  const study = useStudySets();
  const [openId, setOpenId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);

  const targets = useMemo(() => studyTargets(s.snapshot), [s.snapshot]);
  const byId = useMemo(() => new Map(study.sets.map((set) => [set.id, set])), [study.sets]);
  const courseOf = useCallback((id: string) => s.snapshot.courses.find((course) => course.id === id), [s.snapshot.courses]);

  const entries = useMemo<Entry[]>(() => {
    const found = targets.map((target) => ({ id: target.id, courseId: target.courseId, title: target.title, kind: target.kind, dateOffset: target.dateOffset, because: target.because, target }));
    const added = study.sets
      .filter((set) => set.custom)
      .map((set) => ({ id: set.id, courseId: set.courseId, title: set.title, kind: set.kind, dateOffset: offsetOf(set.date), because: "Added by you", custom: set }))
      .filter((entry) => entry.dateOffset === null || entry.dateOffset >= 0);
    return [...found, ...added].sort((a, b) => (a.dateOffset ?? Number.MAX_SAFE_INTEGER) - (b.dateOffset ?? Number.MAX_SAFE_INTEGER));
  }, [targets, study.sets]);

  const closeSheet = useCallback(() => setSheet(null), []);

  function metaOf(courseId: string, kind: TestKind, offset: number | null): string {
    return [courseLabel(courseOf(courseId)), KIND_LABEL[kind], whenLabel(offset).relative].join(" · ");
  }

  function openFor(entry: Entry) {
    // A set that failed, or one being rebuilt, starts from what its last build used.
    const initial = byId.get(entry.id)?.inputs ?? undefined;
    if (entry.custom) {
      setSheet({ for: "custom", id: entry.id, initial, test: { id: entry.id, custom: true, title: entry.title, courseId: entry.courseId, kind: entry.kind, date: entry.custom.date ?? "" } });
      return;
    }
    setSheet({ for: "target", target: entry.target!, initial, test: { id: entry.id, custom: false, title: entry.title, courseId: entry.courseId, kind: entry.kind, date: "", meta: metaOf(entry.courseId, entry.kind, entry.dateOffset) } });
  }

  function addTest() {
    setSheet({ for: "custom", test: { custom: true, title: "", courseId: s.snapshot.courses[0]?.id ?? "", kind: "quiz", date: "" } });
  }

  function studyAssignment(assignment: Assignment) {
    setSheet({
      for: "assignment",
      assignment,
      test: { id: assignment.id, custom: false, title: assignment.title, courseId: assignment.courseId, kind: "test", date: "", meta: metaOf(assignment.courseId, "test", assignment.dateOffset) },
    });
  }

  /** The test behind a set that's already built, however it got there. */
  function specForSet(set: StudySet): TestSpec {
    const target = targets.find((entry) => entry.id === set.id);
    if (target) return targetSpec(target);
    const assignment = s.snapshot.assignments.find((entry) => entry.id === set.id);
    if (assignment) return { ...assignmentSpec(assignment), kind: set.kind };
    return { id: set.id, courseId: set.courseId, title: set.title, kind: set.kind, dateOffset: offsetOf(set.date), due: set.due, url: null, ...(set.custom ? { custom: { date: set.date ?? "" } } : {}) };
  }

  async function run(request: BuildRequest) {
    setBuildError(null);
    try {
      await study.build(request);
    } catch (error) {
      setBuildError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async function buildFromSheet(choice: BuildChoice) {
    if (!sheet) return;
    const picked: Choice = { picks: choice.picks, uploads: choice.uploads, notes: choice.notes, auto: choice.auto };
    let spec: TestSpec;
    if (sheet.for === "target") spec = targetSpec(sheet.target);
    else if (sheet.for === "assignment") spec = assignmentSpec(sheet.assignment);
    else if (sheet.for === "set" && !sheet.set.custom) spec = specForSet(sheet.set);
    else {
      const id = sheet.for === "custom" ? (sheet.id ?? customId()) : sheet.set.id;
      spec = { id, courseId: choice.courseId, title: choice.title, kind: choice.kind, dateOffset: offsetOf(choice.date), due: choice.date ? dueOf(choice.date) : "", url: null, custom: { date: choice.date } };
    }
    await run(requestFor(spec, s.snapshot, picked));
    setSheet(null);
  }

  if (openId) {
    return (
      <>
        <StudySetView
          id={openId}
          domain={s.snapshot.domain}
          inert={!!sheet}
          onBack={() => {
            setOpenId(null);
            void study.refresh();
          }}
          onRebuild={(set) => void run(requestFor(specForSet(set), s.snapshot, choiceOf(set.inputs))).catch(() => {})}
          onChangeMaterial={(set) =>
            setSheet({
              for: "set",
              set,
              initial: set.inputs,
              test: { id: set.id, custom: !!set.custom, title: set.title, courseId: set.courseId, kind: set.kind, date: set.date ?? "", meta: metaOf(set.courseId, set.kind, specForSet(set).dateOffset) },
            })
          }
          onDelete={async (set) => {
            await study.remove(set.id);
            setOpenId(null);
          }}
        />
        {sheet && <StudyBuildSheet key={sheet.test.id ?? "new"} test={sheet.test} courses={s.snapshot.courses} initial={sheet.initial} onClose={closeSheet} onBuild={buildFromSheet} />}
      </>
    );
  }

  const next = entries.find((entry) => entry.dateOffset !== null && entry.dateOffset <= 14);
  const rest = entries.filter((entry) => entry !== next);
  const groups = [
    { label: "This week", rows: rest.filter((entry) => entry.dateOffset !== null && entry.dateOffset <= 6) },
    { label: "Later", rows: rest.filter((entry) => entry.dateOffset !== null && entry.dateOffset > 6) },
    { label: "No date yet", rows: rest.filter((entry) => entry.dateOffset === null) },
  ].filter((group) => group.rows.length);
  const upcoming = new Set(entries.map((entry) => entry.id));
  const taken = new Set([...targets.map((target) => target.id), ...study.sets.map((set) => set.id)]);
  const soon = entries.filter((entry) => entry.dateOffset !== null && entry.dateOffset <= 6).length;

  const row = (entry: Entry) => (
    <TestRow
      key={entry.id}
      entry={entry}
      course={courseOf(entry.courseId)}
      summary={byId.get(entry.id)}
      loaded={study.loaded}
      onBuild={() => openFor(entry)}
      onOpen={() => setOpenId(entry.id)}
    />
  );

  return (
    <div className="scroll study-scroll">
      <div className="study-page" inert={!!sheet}>
        <header className="study-top">
          <div className="study-top-text">
            <h1>
              {entries.length
                ? `${entries.length} ${entries.length === 1 ? "test" : "tests and quizzes"} coming up`
                : "Nothing coming up"}
            </h1>
            <p>
              {entries.length
                ? `${soon ? `${soon} this week. ` : ""}Found on your board and in your grades. Build a study set from what the teacher posted, and add your own material.`
                : "When a teacher posts a test or quiz, or adds one to the gradebook, it shows up here. Missing one? Add it yourself."}
            </p>
          </div>
          <div className="study-top-actions">
            <Picker snapshot={s.snapshot} taken={taken} onPick={studyAssignment} />
            <button type="button" className="btn btn--primary" onClick={addTest} disabled={!s.snapshot.courses.length}>
              <Icon path={ICON.plus} size={12} /> Add a test
            </button>
          </div>
        </header>

        {(buildError || study.error) && (
          <p className="study-notice is-bad study-banner" role="alert"><Icon path={ICON.alert} size={13} /> {buildError ?? study.error}</p>
        )}

        <div className="study-layout">
          <div className="study-main">
            {next && (
              <NextUp
                entry={next}
                course={courseOf(next.courseId)}
                summary={byId.get(next.id)}
                loaded={study.loaded}
                onBuild={() => openFor(next)}
                onOpen={() => setOpenId(next.id)}
              />
            )}

            {groups.map((group) => (
              <section key={group.label} className="study-group" aria-label={group.label}>
                <div className="study-group-head">
                  <h2>{group.label}</h2>
                  <span className="study-count">{group.rows.length}</span>
                </div>
                <ul className="study-list">{group.rows.map(row)}</ul>
              </section>
            ))}

            {!entries.length && (
              <section className="study-blank">
                <span className="study-blank-mark" aria-hidden="true"><Icon path={ICON.checklist} size={20} /></span>
                <h2>No tests on the way</h2>
                <p>Slates checks your board and gradebook every sync. If you know about a quiz that isn’t posted yet, add it and build a set from your own notes and files.</p>
                <button type="button" className="btn btn--primary" onClick={addTest} disabled={!s.snapshot.courses.length}>
                  <Icon path={ICON.plus} size={12} /> Add a test
                </button>
              </section>
            )}
          </div>

          <aside className="study-aside">
            <Library sets={study.sets} courseOf={courseOf} upcoming={upcoming} onOpen={setOpenId} onDelete={(id) => void study.remove(id)} />
            <section className="study-panel study-panel--quiet">
              <h2>Make it yours</h2>
              <ul className="study-how">
                <li><Icon path={ICON.folder} size={13} /> Pick the exact slides and review sheets from the class’s Materials.</li>
                <li><Icon path={[ICON.upload, ICON.uploadTray]} size={13} /> Upload your own notes, packets or slides.</li>
                <li><Icon path={ICON.pencil} size={13} /> Say what’s on it, in your words.</li>
              </ul>
            </section>
          </aside>
        </div>
      </div>

      {sheet && <StudyBuildSheet key={sheet.test.id ?? "new"} test={sheet.test} courses={s.snapshot.courses} initial={sheet.initial} onClose={closeSheet} onBuild={buildFromSheet} />}
    </div>
  );
}
