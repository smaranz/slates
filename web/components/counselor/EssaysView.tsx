"use client";

import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { countWords } from "@/lib/counselor/ai-signals";
import { DEFAULT_LIMIT, ESSAY_KIND_LABEL, RUBRICS } from "@/lib/counselor/rubric";
import { essayScope, inScope } from "@/lib/counselor/essays";
import { noteFor, splitSentences, verdictCounts } from "@/lib/counselor/sentences";
import { GRADE_LABEL, uid } from "@/lib/counselor/state";
import { useCounselor } from "@/lib/counselor/store";
import { reportMarkdown } from "@/lib/counselor/essay-report";
import {
  COLLEGE_ONLY_KINDS,
  ESSAY_KINDS,
  type AiDetection,
  type Essay,
  type EssayFeedback,
  type EssayKind,
  type EssayReport,
  type EssayScope,
  type LineNote,
  type LineReview,
  type LineVerdict,
  type SentenceCheck,
} from "@/lib/counselor/types";
import { isDocx, readDocx } from "@/lib/docx";
import { readAttachment } from "@/lib/attachments";
import { useStore } from "@/lib/store";
import { Icon, ICON, Spinner } from "../ui";

/**
 * The essay studio.
 *
 * Four things a student actually needs while drafting, in one place: the draft
 * with its word count against the real limit, a rubric review that has to cite
 * the line it is scoring, a line-by-line read where every sentence gets a
 * verdict and the weak ones get steps, and an honest read of how
 * machine-written the prose sounds.
 *
 * The counselor reads what's here — it is part of the record — so the essay
 * you're stuck on is something you can ask it about in the next conversation
 * without pasting it again.
 */

type Tab = "draft" | "report" | "history";

/**
 * The school side's essays: coursework, and the writing that goes with an
 * assignment on the board. College essays live in the counselor half, where
 * they belong to applications and carry deadlines — see CollegeEssaysView.
 */
export default function EssaysView({ scope = "school" }: { scope?: EssayScope }) {
  const c = useCounselor();
  const [tab, setTab] = useState<Tab>("draft");
  const [pendingDelete, setPendingDelete] = useState<Essay | null>(null);

  const mine = useMemo(() => c.essays.filter(inScope(scope)), [c.essays, scope]);
  const [listOpen, setListOpen] = useState(mine.length === 0);

  const essay = useMemo(
    () => mine.find((e) => e.id === c.essayId) ?? mine[0] ?? null,
    [mine, c.essayId]
  );

  function create() {
    const now = Date.now();
    const fresh: Essay = {
      id: uid(),
      title: "Untitled essay",
      scope,
      // Coursework by default here; the application kinds belong to the
      // college side, which sets its own.
      kind: scope === "school" ? "other" : "personal-statement",
      prompt: "",
      wordLimit: scope === "school" ? null : DEFAULT_LIMIT["personal-statement"],
      content: "",
      versions: [],
      createdAt: now,
      updatedAt: now,
    };
    c.createEssay(fresh);
    c.openEssay(fresh.id);
    setTab("draft");
    setListOpen(false);
  }

  return (
    <div className={`counselor-split ${listOpen || !essay ? "is-list" : "has-selection"}`}>
      <div className="counselor-list-pane">
        <div className="counselor-pane-head">
          <span className="section-label" style={{ flex: 1 }}>
            Essays
          </span>
          <button type="button" className="icon-btn" onClick={create} aria-label="New essay" style={{ width: 26, height: 26 }}>
            <Icon path={ICON.plus} size={13} />
          </button>
        </div>

        <div className="counselor-list-scroll">
          {mine.length === 0 && (
            <p className="counselor-empty-note">
              Nothing yet. Start one, paste a draft, or upload a Word doc or PDF.
            </p>
          )}
          {mine.map((e) => {
            const words = countWords(e.content);
            const over = e.wordLimit != null && words > e.wordLimit;
            return (
              <div
                key={e.id}
                className={`counselor-doc-row${e.id === essay?.id ? " is-active" : ""}`}
              >
                <button
                  type="button"
                  className="counselor-doc-open"
                  onClick={() => {
                    c.openEssay(e.id);
                    setTab("draft");
                    setListOpen(false);
                  }}
                >
                  <span className="truncate counselor-doc-title">{e.title}</span>
                  <span className="counselor-doc-meta">
                    {ESSAY_KIND_LABEL[e.kind]} ·{" "}
                    <span style={over ? { color: "var(--bad)" } : undefined}>
                      {words}
                      {e.wordLimit ? `/${e.wordLimit}` : ""} words
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="essay-list-delete"
                  onClick={() => setPendingDelete(e)}
                  aria-label={`Delete ${e.title || "essay"}`}
                  title="Delete essay"
                >
                  <Icon path={ICON.trash} size={13} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {essay ? (
        <Studio
          key={essay.id}
          essay={essay}
          tab={tab}
          setTab={setTab}
          onShowList={() => setListOpen(true)}
          onRequestDelete={() => setPendingDelete(essay)}
          scope={scope}
        />
      ) : (
        <div className="counselor-blank">Start an essay.</div>
      )}

      {pendingDelete && (
        <DeleteEssayDialog
          essay={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            const id = pendingDelete.id;
            c.removeEssay(id);
            setPendingDelete(null);
            if (id === essay?.id) setListOpen(true);
          }}
        />
      )}
    </div>
  );
}

export function DeleteEssayDialog({
  essay,
  onCancel,
  onConfirm,
}: {
  essay: Essay;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="counselor-dialog-backdrop" onMouseDown={onCancel}>
      <section
        className="counselor-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-essay-title"
        aria-describedby="delete-essay-detail"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p className="section-label">Permanent action</p>
        <h2 id="delete-essay-title">Delete “{essay.title || "Untitled essay"}”?</h2>
        <p id="delete-essay-detail">
          This removes the current draft, report, and {essay.versions.length} saved version{essay.versions.length === 1 ? "" : "s"} from this device.
        </p>
        <div className="counselor-dialog-actions">
          <button type="button" className="btn btn--quiet" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn--danger" onClick={onConfirm}>
            Delete essay
          </button>
        </div>
      </section>
    </div>
  );
}

export function Studio({ essay, tab, setTab, onShowList, onRequestDelete, scope }: { essay: Essay; tab: Tab; setTab: (t: Tab) => void; onShowList: () => void; onRequestDelete: () => void; scope: EssayScope }) {
  const c = useCounselor();
  const school = useStore();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [busy, setBusy] = useState<"" | "report" | "upload" | "download">("");
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState(false);
  const operationRef = useRef(0);
  const reportAbortRef = useRef<AbortController | null>(null);

  const words = countWords(essay.content);

  /*
   * The draft grows with what's in it, so the pane scrolls once rather than
   * nesting a scrollbar inside a scrollbar.
   */
  useEffect(() => {
    const el = draftRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [essay.content, tab]);

  useEffect(() => {
    return () => {
      operationRef.current += 1;
      reportAbortRef.current?.abort();
    };
  }, []);

  const patch = useCallback(
    (next: Partial<Essay>) => c.updateEssay({ ...essay, ...next, updatedAt: Date.now() }),
    [c, essay]
  );

  /** The report is stamped with the word count it was written about. */
  const stale = essay.report != null && essay.report.words !== words;

  /** One button: the rubric review, the line read and the AI check, together. */
  async function run() {
    const operation = ++operationRef.current;
    const controller = new AbortController();
    reportAbortRef.current = controller;
    setError(null);
    setBusy("report");
    try {
      const res = await fetch("/api/counselor/essay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "report",
          content: essay.content,
          kind: essay.kind,
          prompt: essay.prompt || undefined,
          wordLimit: essay.wordLimit,
          // The teacher's own sheet, when they dropped one in.
          rubric: essay.customRubric,
          studentContext:
            [
              c.profile.intendedMajor && `Intended major: ${c.profile.intendedMajor}`,
              c.profile.activities.length &&
                `Activities: ${c.profile.activities.map((a) => a.name).join(", ")}`,
              c.memories.length &&
                `Known about them: ${c.memories.slice(0, 8).map((m) => m.content).join(" ")}`,
            ]
              .filter(Boolean)
              .join("\n") || undefined,
        }),
        signal: controller.signal,
      });
      const body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error ?? `Failed (${res.status})`);
      if (operation !== operationRef.current) return;
      patch({ report: body as EssayReport });
      setTab("report");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      if (operation === operationRef.current) setBusy("");
      if (reportAbortRef.current === controller) reportAbortRef.current = null;
    }
  }

  /**
   * The report as a file, through the same converter the tutor's documents use
   * — so this arrives as a real .docx rather than a text dump.
   */
  async function download() {
    if (!essay.report) return;
    setError(null);
    setBusy("download");
    try {
      const res = await fetch("/api/tutor/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: `${essay.title} — report`,
          body: reportMarkdown(essay, essay.report),
          format: "docx",
        }),
      });
      const body = (await res.json()) as { name?: string; error?: string };
      if (!res.ok || !body.name) throw new Error(body.error ?? "Couldn't build that file.");
      const a = document.createElement("a");
      a.href = `/api/tutor/files?name=${encodeURIComponent(body.name)}`;
      a.download = body.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't build that file.");
    } finally {
      setBusy("");
    }
  }

  async function upload(file: File) {
    const operation = ++operationRef.current;
    setError(null);
    setBusy("upload");
    try {
      const text = isDocx(file) ? await readDocx(file) : await readText(file);
      if (operation !== operationRef.current) return;
      if (!text.trim()) throw new Error(`Couldn't find any text in ${file.name}.`);
      // The draft on screen is snapshotted first, so an upload can't quietly
      // destroy what was already written.
      const versions = essay.content.trim()
        ? [
            {
              id: uid(),
              content: essay.content,
              words,
              savedAt: Date.now(),
              note: `Replaced by ${file.name}`,
            },
            ...essay.versions,
          ]
        : essay.versions;
      patch({ content: text, versions, title: essay.title === "Untitled essay" ? file.name.replace(/\.[^.]+$/, "") : essay.title });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that file.");
    } finally {
      if (operation === operationRef.current) setBusy("");
    }
  }

  const openWork = school.snapshot.assignments.filter(
    (a) => school.onBoard(a) && school.statusOf(a) !== "done"
  );

  function snapshot() {
    patch({
      versions: [{ id: uid(), content: essay.content, words, savedAt: Date.now() }, ...essay.versions],
    });
  }

  return (
    <div className="counselor-detail-pane">
      <div className="essay-head">
        <button type="button" className="counselor-mobile-back" onClick={onShowList} aria-label="Back to essays">
          <Icon path={ICON.chevronLeft} size={15} />
        </button>
        <div className="essay-head-id">
          <input
            className="essay-title"
            value={essay.title}
            onChange={(e) => patch({ title: e.target.value })}
            aria-label="Essay title"
          />
          <p className="essay-head-meta">
            {ESSAY_KIND_LABEL[essay.kind]}
            {essay.collegeName ? ` · ${essay.collegeName}` : ""}
            {essay.assignmentTitle ? ` · for ${essay.assignmentTitle}` : ""}
          </p>
        </div>

        <button
          type="button"
          className={`essay-head-btn${meta ? " is-on" : ""}`}
          onClick={() => setMeta((v) => !v)}
          aria-expanded={meta}
        >
          <Icon path={ICON.settings} size={13} />
          Setup
        </button>
        <button type="button" className="essay-delete-trigger" onClick={onRequestDelete}>
          <Icon path={ICON.trash} size={13} />
          Delete essay
        </button>
      </div>

      {meta && (
        <Setup
          essay={essay}
          patch={patch}
          scope={scope}
          assignments={openWork.map((a) => ({
            id: a.id,
            title: a.title,
            course: school.courseById(a.courseId)?.short ?? "",
          }))}
        />
      )}

      {/*
       * Three tabs, not five. The rubric review, the sentence-by-sentence read
       * and the AI check were separate tabs with a button each, which meant the
       * usual outcome was one of them run and the other two forgotten. They are
       * one pass and one document now.
       */}
      <div className="essay-tabs">
        {(
          [
            ["draft", "Draft", null],
            ["report", "Report", essay.report ? String(essay.report.lines.score) : null],
            ["history", "History", essay.versions.length ? String(essay.versions.length) : null],
          ] as [Tab, string, string | null][]
        ).map(([key, label, chip]) => (
          <button
            key={key}
            type="button"
            className={`essay-tab${tab === key ? " is-on" : ""}`}
            onClick={() => setTab(key)}
          >
            {label}
            {chip && <span className="essay-tab-chip">{chip}</span>}
          </button>
        ))}
      </div>

      {error && <div className="counselor-error essay-error">{error}</div>}

      {/*
       * A page on a canvas, the way every document editor since the first one
       * has drawn this: 816 x 1056 at 96dpi is US Letter, and the inch of
       * margin is real. An empty draft then looks like a blank sheet you can
       * write on rather than an empty pane with a caret in it.
       */}
      <div className="doc-canvas">
        {tab === "draft" && (
          <div className="doc-sheet">
            {essay.prompt && <p className="doc-prompt">{essay.prompt}</p>}
            <textarea
              ref={draftRef}
              className="doc-body"
              value={essay.content}
              onChange={(e) => patch({ content: e.target.value })}
              placeholder="Start typing, or paste your draft."
              spellCheck
              aria-label="Draft"
            />
          </div>
        )}

        {tab === "report" && (
          <div className="doc-sheet doc-sheet--note">
            {essay.report ? (
              <EssayReportView
                essay={essay}
                report={essay.report}
                stale={stale}
                grade={GRADE_LABEL[c.profile.gradeLevel]}
                onReplace={(start: number, end: number, next: string) =>
                  patch({ content: essay.content.slice(0, start) + next + essay.content.slice(end) })
                }
              />
            ) : (
              <PassPrompt
                title="One read of the whole essay"
                blurb="Scored against the rubric with a quote behind every score, then read sentence by sentence so nothing in the draft goes unjudged, then measured for how machine-written it sounds — by a detector that runs on this machine and sends your draft nowhere. One report, and you can download it."
                cta="Check this essay"
                words={words}
                busy={busy === "report"}
                blocked={!!busy}
                onRun={() => void run()}
                slow="About a minute on a full-length draft."
              />
            )}
          </div>
        )}

        {tab === "history" && (
          <div className="doc-sheet doc-sheet--note">
            <History
              essay={essay}
              onRestore={(content) =>
                patch({
                  content,
                  versions: [
                    { id: uid(), content: essay.content, words, savedAt: Date.now(), note: "Before restore" },
                    ...essay.versions,
                  ],
                })
              }
            />
          </div>
        )}
      </div>

      {/*
       * The status bar. Word count on the left where a document editor puts
       * it, and the actions that belong to whatever tab you're on the right.
       */}
      <div className="doc-status">
        <WordMeter words={words} limit={essay.wordLimit} />
        <span className="doc-status-gap" />

        {tab === "draft" && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".docx,.pdf,.txt,.md,text/plain,application/pdf"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void upload(file);
              }}
            />
            <span className="doc-status-hint">
              {essay.versions.length
                ? `${essay.versions.length} saved ${essay.versions.length === 1 ? "draft" : "drafts"}`
                : "No snapshots yet"}
            </span>
            <button
              type="button"
              className="doc-status-btn"
              disabled={!essay.content.trim()}
              onClick={snapshot}
            >
              <Icon path={ICON.clockFace} size={12} />
              Save a snapshot
            </button>
            <button type="button" className="doc-status-btn" disabled={!!busy} onClick={() => fileRef.current?.click()}>
              {busy === "upload" ? <Spinner size={11} /> : <Icon path={ICON.upload} size={12} />}
              {busy === "upload" ? "Reading the file…" : "Upload"}
            </button>
            <button
              type="button"
              className="doc-status-btn is-primary"
              disabled={!!busy || words < MIN_WORDS}
              onClick={() => void run()}
              title={words < MIN_WORDS ? `Write at least ${MIN_WORDS} words first` : "Rubric, every sentence, and the AI check"}
            >
              {busy === "report" ? <Spinner size={11} /> : <Icon path={ICON.check} size={12} />}
              {busy === "report" ? "Reading it…" : "Check this essay"}
            </button>
          </>
        )}

        {tab === "report" && essay.report && (
          <>
            <span className="doc-status-hint">
              {new Date(essay.report.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </span>
            <button type="button" className="doc-status-btn" disabled={!!busy} onClick={() => void download()}>
              {busy === "download" ? <Spinner size={11} /> : <Icon path={ICON.download} size={12} />}
              {busy === "download" ? "Building the file…" : "Download the report"}
            </button>
            <button type="button" className="doc-status-btn is-primary" disabled={!!busy} onClick={() => void run()}>
              {busy === "report" ? <Spinner size={11} /> : <Icon path={ICON.retry} size={12} />}
              {busy === "report" ? "Reading it…" : "Check it again"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The word count as a count, not a sentence.
 *
 * It sits in the header because it's the one number a student checks
 * constantly while drafting, and it fills toward the real limit so being
 * close to it is visible without reading either number.
 */
function WordMeter({ words, limit }: { words: number; limit: number | null }) {
  if (!limit) return <span className="essay-meter-plain">{words} words</span>;

  const over = words > limit;
  const ratio = Math.min(words / limit, 1);

  return (
    <div className={`essay-meter${over ? " is-over" : ratio > 0.9 ? " is-close" : ""}`}>
      <span className="essay-meter-track">
        <span style={{ width: `${ratio * 100}%` }} />
      </span>
      <span className="essay-meter-n">
        {words}
        <span className="essay-meter-of"> / {limit}</span>
      </span>
      {over && <span className="essay-meter-over">{words - limit} over</span>}
    </div>
  );
}

/** The shortest draft worth spending a model pass on. Matches the route. */
const MIN_WORDS = 40;

/**
 * What a tab looks like before it has been run.
 *
 * Says what the pass does and gives the one button that does it. When the
 * draft is too short it says how short instead of showing a button that
 * can't be pressed — a dead control reads as a broken app, and the reason is
 * the useful part anyway.
 */
function PassPrompt({
  title,
  blurb,
  cta,
  words,
  busy,
  blocked,
  onRun,
  slow,
}: {
  title: string;
  blurb: string;
  cta: string;
  words: number;
  busy: boolean;
  blocked: boolean;
  onRun: () => void;
  slow?: string;
}) {
  return (
    <div className="essay-pass">
      <h2 className="essay-pass-title">{title}</h2>
      <p className="essay-pass-blurb">{blurb}</p>

      {words < MIN_WORDS ? (
        <p className="essay-pass-wait">
          {words === 0
            ? "Nothing to read yet — write or paste a draft first."
            : `${words} of ${MIN_WORDS} words so far. Keep going.`}
        </p>
      ) : (
        <div className="essay-pass-go">
          <button type="button" className="btn btn--primary" disabled={blocked} onClick={onRun}>
            {busy ? <Spinner size={12} /> : null}
            {cta}
          </button>
          {slow && <span className="doc-status-hint">{busy ? "Reading it now." : slow}</span>}
        </div>
      )}
    </div>
  );
}

function Setup({
  essay,
  patch,
  assignments,
  scope,
}: {
  essay: Essay;
  patch: (next: Partial<Essay>) => void;
  assignments: { id: string; title: string; course: string }[];
  scope: EssayScope;
}) {
  /*
   * Admissions belongs to the counselor.
   *
   * A history paper has no college attached to it and never will, and the
   * application-specific kinds are noise on a list of school essays. Both are
   * still there on the counselor side, where they mean something.
   */
  const college = scope === "college";
  const kinds = college ? ESSAY_KINDS : ESSAY_KINDS.filter((k) => !COLLEGE_ONLY_KINDS.has(k));

  return (
    <div className="counselor-essay-setup">
      <label className="counselor-field" style={{ padding: 0 }}>
        <span className="counselor-field-label" style={{ width: 110, paddingTop: 7 }}>
          Kind
        </span>
        <span className="counselor-field-control">
          <select
            className="counselor-input"
            value={essay.kind}
            onChange={(e) => {
              const kind = e.target.value as EssayKind;
              // Move the limit with the kind, unless the student set their own.
              const wasDefault = essay.wordLimit === DEFAULT_LIMIT[essay.kind];
              patch({ kind, ...(wasDefault ? { wordLimit: DEFAULT_LIMIT[kind] } : {}) });
            }}
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {ESSAY_KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <span className="counselor-essay-hint" style={{ display: "block", marginTop: 4 }}>
            {essay.customRubric
              ? "Replaced by your teacher's rubric, below."
              : `${RUBRICS[essay.kind].label}: scored on ${RUBRICS[essay.kind].criteria
                  .map((x) => x.name.toLowerCase())
                  .join(", ")}.`}
          </span>
        </span>
      </label>

      <label className="counselor-field" style={{ padding: 0 }}>
        <span className="counselor-field-label" style={{ width: 110, paddingTop: 7 }}>
          Word limit
        </span>
        <span className="counselor-field-control">
          <input
            className="counselor-input"
            type="number"
            value={essay.wordLimit ?? ""}
            onChange={(e) => patch({ wordLimit: e.target.value ? Number(e.target.value) : null })}
            placeholder="No limit"
            style={{ maxWidth: 120 }}
          />
        </span>
      </label>

      {college && (
        <label className="counselor-field" style={{ padding: 0 }}>
          <span className="counselor-field-label" style={{ width: 110, paddingTop: 7 }}>
            College
          </span>
          <span className="counselor-field-control">
            <input
              className="counselor-input"
              value={essay.collegeName ?? ""}
              onChange={(e) => patch({ collegeName: e.target.value })}
              placeholder="For supplements"
              style={{ maxWidth: 260 }}
            />
          </span>
        </label>
      )}

      <label className="counselor-field" style={{ padding: 0 }}>
        <span className="counselor-field-label" style={{ width: 110, paddingTop: 7 }}>
          Prompt
          <span className="counselor-field-hint">Scored against, so paste it exactly.</span>
        </span>
        <span className="counselor-field-control">
          <textarea
            className="counselor-input counselor-textarea"
            value={essay.prompt}
            onChange={(e) => patch({ prompt: e.target.value })}
            rows={2}
            placeholder="Paste the prompt as the application prints it"
          />
        </span>
      </label>

      {/*
       * The escape hatch for the split.
       *
       * Which half an essay belongs to is inferred for anything written before
       * the two lists existed, and an inference is sometimes wrong — at which
       * point the essay is sitting in a list the student isn't looking at,
       * which feels exactly like losing it. This is how they put it back.
       */}
      <label className="counselor-field" style={{ padding: 0 }}>
        <span className="counselor-field-label" style={{ width: 110, paddingTop: 7 }}>
          Belongs to
          <span className="counselor-field-hint">Which list this shows up in.</span>
        </span>
        <span className="counselor-field-control">
          <select
            className="counselor-input"
            value={essayScope(essay)}
            onChange={(e) => patch({ scope: e.target.value as EssayScope })}
            style={{ maxWidth: 260 }}
          >
            <option value="college">College essays — the counselor side</option>
            <option value="school">School work — the school side</option>
          </select>
        </span>
      </label>

      <label className="counselor-field" style={{ padding: 0 }}>
        <span className="counselor-field-label" style={{ width: 110, paddingTop: 7 }}>
          Assignment
          <span className="counselor-field-hint">Link it to real coursework from the school side.</span>
        </span>
        <span className="counselor-field-control">
          <select
            className="counselor-input"
            value={essay.assignmentId ?? ""}
            onChange={(e) => {
              const found = assignments.find((a) => a.id === e.target.value);
              patch({ assignmentId: found?.id, assignmentTitle: found?.title });
            }}
          >
            <option value="">Not linked</option>
            {assignments.map((a) => (
              <option key={a.id} value={a.id}>
                {a.course ? `${a.course} — ` : ""}
                {a.title}
              </option>
            ))}
          </select>
          {assignments.length === 0 && (
            <span className="counselor-essay-hint" style={{ display: "block", marginTop: 4 }}>
              Nothing open on your board — sync the school side to link one.
            </span>
          )}
        </span>
      </label>

      <RubricPanel essay={essay} patch={patch} />
    </div>
  );
}

/** The rubric section of the report: every criterion, with the line behind it. */
/**
 * The rubric this essay is graded on, shown rather than described.
 *
 * It used to be a single line naming the criteria, which meant a student could
 * not see what any of them actually asked for — and the criteria are the whole
 * basis of the score they are about to be given. Now the sheet is on the page.
 *
 * A teacher's own handout replaces it. Drop a photo of the page and the model
 * transcribes it into the same shape the built-in rubrics use, so grading,
 * scoring and rendering all carry on unchanged and nothing downstream needs to
 * know where the rubric came from.
 */
function RubricPanel({
  essay,
  patch,
}: {
  essay: Essay;
  patch: (next: Partial<Essay>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const rubric = essay.customRubric ?? RUBRICS[essay.kind];
  const custom = Boolean(essay.customRubric);

  const read = useCallback(
    async (file: File) => {
      setError(null);
      setBusy(true);
      try {
        const res = await fetch("/api/counselor/rubric", {
          method: "POST",
          headers: { "content-type": file.type || "application/octet-stream" },
          body: file,
        });
        const body = (await res.json()) as { rubric?: Essay["customRubric"]; error?: string };
        if (!res.ok || body.error || !body.rubric) {
          throw new Error(body.error ?? `Reading it failed (${res.status}).`);
        }
        patch({ customRubric: body.rubric, customRubricSource: file.name });
        setOpen(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Reading that rubric failed.");
      } finally {
        setBusy(false);
      }
    },
    [patch]
  );

  return (
    <div className="rubricp">
      <div className="rubricp-head">
        <button
          type="button"
          className="rubricp-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <Icon
            path={ICON.chevronDown}
            size={12}
            style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .18s" }}
          />
          <span className="rubricp-name">{rubric.label}</span>
          <span className="rubricp-where">
            {custom ? `from ${essay.customRubricSource ?? "your file"}` : "built in"}
          </span>
        </button>

        <span style={{ flex: 1 }} />

        {custom && (
          <button
            type="button"
            className="btn btn--quiet"
            style={{ height: 28 }}
            onClick={() => patch({ customRubric: undefined, customRubricSource: undefined })}
          >
            Use the built-in one
          </button>
        )}
      </div>

      {open && (
        <ol className="rubricp-criteria">
          {rubric.criteria.map((c) => (
            <li key={c.name}>
              <span className="rubricp-criterion">{c.name}</span>
              <span className="rubricp-detail">{c.detail}</span>
            </li>
          ))}
          {rubric.note && <li className="rubricp-note">{rubric.note}</li>}
        </ol>
      )}

      {/* Drag target and file picker in one. A photo of the handout is the
          common case, so the copy says photo first. */}
      <div
        className={`rubricp-drop${dragging ? " is-over" : ""}${busy ? " is-busy" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void read(file);
        }}
        onClick={() => !busy && fileRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (!busy) fileRef.current?.click();
          }
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf,text/plain,text/markdown"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void read(file);
          }}
        />
        {busy ? (
          <>
            <Spinner size={13} />
            <span>Reading the rubric…</span>
          </>
        ) : (
          <>
            <Icon path={ICON.upload} size={13} />
            <span>
              Drop a photo of your teacher&apos;s rubric — or a PDF or text file — and Slates will
              grade against it instead.
            </span>
          </>
        )}
      </div>

      {error && <p className="rubricp-error">{error}</p>}
    </div>
  );
}

function Review({ feedback }: { feedback: EssayFeedback }) {
  return (
    <div className="counselor-review">
      {feedback.scores.map((s) => (
        <motion.div
          key={s.criterion}
          className="counselor-criterion"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          <div className="counselor-criterion-head">
            <span className="counselor-criterion-name">{s.criterion}</span>
            <span className="counselor-criterion-bar">
              {Array.from({ length: s.max }, (_, i) => (
                <span key={i} className={i < s.score ? "is-on" : ""} style={barColor(s.score, s.max, i)} />
              ))}
            </span>
            <span className="counselor-criterion-score">
              {s.score}/{s.max}
            </span>
          </div>
          <p className="counselor-criterion-quote">&ldquo;{s.evidence}&rdquo;</p>
          <p className="counselor-criterion-fix">{s.fix}</p>
        </motion.div>
      ))}

      {feedback.strengths.length > 0 && (
        <div className="counselor-review-block">
          <span className="section-label">Keep</span>
          <ul>
            {feedback.strengths.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      )}

      {feedback.cuts.length > 0 && (
        <div className="counselor-review-block is-cut">
          <span className="section-label">Cut</span>
          <ul>
            {feedback.cuts.map((x, i) => (
              <li key={i}>&ldquo;{x}&rdquo;</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function barColor(score: number, max: number, i: number) {
  if (i >= score) return undefined;
  const ratio = score / max;
  return { background: ratio >= 0.8 ? "var(--good)" : ratio >= 0.5 ? "var(--warn)" : "var(--bad)" };
}

/** What each verdict means, said once, above the draft. */
const VERDICT_LABEL: Record<LineVerdict, string> = {
  strong: "Carrying the essay",
  okay: "Doing its job",
  weak: "Needs work",
};

/** One sentence of the draft, tightened to its own text so a swap lands exactly. */
interface Line {
  start: number;
  end: number;
  text: string;
  /** Null when the last read didn't judge this sentence — usually a later edit. */
  note: LineNote | null;
}

function Lines({
  review,
  content,
  grade,
  onReplace,
}: {
  review: LineReview;
  content: string;
  grade?: string;
  onReplace: (start: number, end: number, next: string) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);

  /*
   * The draft is re-split on every keystroke it changes by, and each sentence
   * is looked up in the review by its own text — not by position. A sentence
   * the student rewrites simply stops matching and loses its tint, which is
   * the honest outcome: the read no longer covers it.
   */
  const lines = useMemo<Line[]>(
    () =>
      splitSentences(content).map((span) => {
        const raw = content.slice(span.start, span.end);
        const lead = raw.length - raw.trimStart().length;
        const start = span.start + lead;
        return { start, end: start + span.text.length, text: span.text, note: noteFor(span.text, review) };
      }),
    [content, review]
  );

  const counts = verdictCounts(review);
  const selected = picked != null ? lines[picked] : null;

  // The draft, rebuilt verbatim: every sentence a button, every gap between
  // them the original whitespace, so paragraph breaks survive.
  const rendered: React.ReactNode[] = [];
  let at = 0;
  lines.forEach((line, i) => {
    if (line.start > at) rendered.push(<span key={`gap-${i}`}>{content.slice(at, line.start)}</span>);
    rendered.push(
      <button
        key={`line-${i}`}
        type="button"
        className={`counselor-line${line.note ? ` is-${line.note.verdict}` : ""}${picked === i ? " is-picked" : ""}`}
        onClick={() => setPicked(picked === i ? null : i)}
        title={line.note ? VERDICT_LABEL[line.note.verdict] : "Not in the last read — edited since."}
      >
        {/* The colour is the fast signal; this is the same verdict in words,
            since a tint is not information a screen reader can see. */}
        <span className="sr-only">
          {line.note ? `${VERDICT_LABEL[line.note.verdict]}: ` : "Not judged: "}
        </span>
        {content.slice(line.start, line.end)}
      </button>
    );
    at = line.end;
  });
  if (at < content.length) rendered.push(<span key="tail">{content.slice(at)}</span>);

  return (
    <div className="counselor-review">
      <div className="counselor-lines-legend">
        {(["strong", "okay", "weak"] as LineVerdict[]).map((v) => (
          <span key={v} className={`counselor-lines-key is-${v}`}>
            <i />
            {counts[v]} {VERDICT_LABEL[v].toLowerCase()}
          </span>
        ))}
      </div>

      <div className="counselor-lines-draft">{rendered}</div>

      {selected && (
        <SentenceCard
          key={selected.start}
          line={selected}
          grade={grade}
          onClose={() => setPicked(null)}
          onReplace={(next) => {
            onReplace(selected.start, selected.end, next);
            setPicked(null);
          }}
        />
      )}

    </div>
  );
}

function barTone(ratio: number): string {
  return ratio >= 0.8 ? "var(--good)" : ratio >= 0.6 ? "var(--warn)" : "var(--bad)";
}

/**
 * One sentence, opened up.
 *
 * The steps from the read, then a box the student retypes it in themselves.
 * Re-checking sends only that sentence back, and what returns is a verdict,
 * steps, and the same technique demonstrated on an unrelated subject — never a
 * rewritten version of their line. Nothing reaches the draft unless they press
 * the button that puts it there.
 */
function SentenceCard({
  line,
  grade,
  onClose,
  onReplace,
}: {
  line: Line;
  grade?: string;
  onClose: () => void;
  onReplace: (next: string) => void;
}) {
  const [typed, setTyped] = useState(line.text);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<SentenceCheck | null>(null);
  const [error, setError] = useState<string | null>(null);

  const edited = typed.trim() !== line.text && typed.trim().length > 0;

  async function recheck() {
    setError(null);
    setChecking(true);
    try {
      const res = await fetch("/api/counselor/essay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sentence", sentence: typed.trim(), grade }),
      });
      const body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error ?? `Failed (${res.status})`);
      setResult(body as SentenceCheck);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't check that sentence.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="counselor-sentence-card">
      <div className="counselor-sentence-head">
        <span className={`counselor-verdict-pill is-${line.note?.verdict ?? "okay"}`}>
          {line.note ? VERDICT_LABEL[line.note.verdict] : "Not in the last read"}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" className="icon-btn" style={{ width: 24, height: 24 }} onClick={onClose} aria-label="Close">
          <Icon path={ICON.close} size={12} />
        </button>
      </div>

      <p className="counselor-criterion-quote">&ldquo;{line.text}&rdquo;</p>

      {line.note ? (
        <>
          <p className="counselor-criterion-fix">{line.note.note}</p>
          {line.note.steps.length > 0 && (
            <ol className="counselor-sentence-steps">
              {line.note.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          )}
        </>
      ) : (
        <p className="counselor-criterion-fix">
          This sentence wasn&apos;t in the last read. Retype it below to have it checked on its own,
          or read the lines again for the whole draft.
        </p>
      )}

      <span className="section-label" style={{ marginTop: 10, display: "block" }}>
        Your turn
      </span>
      <textarea
        className="counselor-input counselor-textarea"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        rows={3}
        spellCheck
        aria-label="Rewrite this sentence"
      />

      <div className="counselor-sentence-actions">
        <button type="button" className="btn btn--quiet" disabled={checking || !typed.trim()} onClick={() => void recheck()}>
          {checking ? <Spinner size={12} /> : null}
          Check this sentence
        </button>
        <button type="button" className="btn btn--primary" disabled={!edited} onClick={() => onReplace(typed.trim())}>
          Put it in the draft
        </button>
        <span className="counselor-essay-hint">
          {edited ? "Replaces the sentence above." : "Rewrite it in your own words first."}
        </span>
      </div>

      {error && <div className="counselor-error">{error}</div>}

      {result && (
        <div className="counselor-sentence-result">
          <div className="counselor-sentence-head">
            <span className={`counselor-verdict-pill is-${result.verdict}`}>{VERDICT_LABEL[result.verdict]}</span>
          </div>
          <p className="counselor-criterion-fix">{result.summary}</p>
          {result.steps.length > 0 && (
            <ol className="counselor-sentence-steps">
              {result.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          )}
          {result.example && (
            <>
              <span className="section-label" style={{ marginTop: 8, display: "block" }}>
                The same move, someone else&apos;s subject
              </span>
              <p className="counselor-criterion-quote">&ldquo;{result.example}&rdquo;</p>
              <p className="counselor-essay-hint">
                Deliberately not about your topic — the technique is the point, not the sentence.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The AI section of the report.
 *
 * Leads with the verdict and the score against its own calibrated line,
 * because the probability is the misleading number here: MELD sits near 0.5
 * for ordinary human prose, and "50% AI" is not what that means. Underneath,
 * the local statistics say what about the writing reads that way — which is
 * the part a student can actually act on.
 */
/**
 * The AI check, as its own page.
 *
 * Three things a student wants here and could not get before: a number, a
 * verdict, and which sentences caused it. The first two were buried under the
 * rubric; the third existed only as "the worst six passages", which leaves
 * every unnamed sentence ambiguous — checked and cleared, or never looked at?
 * Every sentence is listed with its own mark.
 *
 * The percentage is deliberately the model's calibrated probability and is
 * labelled as one. It is not "37% of this essay is AI" — no detector can say
 * that — and writing it that way would invite a student to argue with a number
 * that does not mean what it appears to.
 */
function AiCheck({ detection }: { detection: AiDetection }) {
  const meld = detection.meld;
  const lines = meld?.lines ?? [];
  const flaggedLines = lines.filter((l) => l.over);

  if (!meld) {
    return (
      <div className="counselor-review">
        <div className="counselor-warn">
          {detection.unavailable ?? "The local detector didn't run."} The measurements below are
          computed from your own words and still stand.
        </div>
        <Detection detection={detection} />
      </div>
    );
  }

  const pct = Math.round(meld.probability * 100);
  const tone = meld.flagged ? "var(--bad)" : "var(--good)";

  return (
    <div className="counselor-review aicheck">
      <div className="aicheck-head">
        <div className="aicheck-dial" style={{ borderColor: tone }}>
          <span className="aicheck-pct" style={{ color: tone }}>
            {pct}%
          </span>
          <span className="aicheck-pct-label">machine-like</span>
        </div>

        <div style={{ minWidth: 0, flex: 1 }}>
          <p className="aicheck-verdict" style={{ color: tone }}>
            {meld.score.toFixed(2)} <span className="aicheck-verdict-of">of {meld.threshold.toFixed(2)}</span>
          </p>
          <p className="aicheck-detail">
            Scored {meld.score.toFixed(2)} against a {meld.threshold.toFixed(2)} line — the score
            below which 99% of human writing fell, so about one human essay in a hundred trips it.
            {meld.truncated
              ? " It reads the first 2,048 tokens and this draft is longer, so the end was not scored."
              : ` It read ${meld.tokensRead} tokens.`}
          </p>
          <p className="aicheck-where">
            Run by MELD on this machine. Your draft is never uploaded to a detection service.
          </p>
        </div>
      </div>

      {lines.length > 0 && (
        <div className="report-section">
          <h3 className="report-heading">
            Sentence by sentence
            <span className="aicheck-count">
              {flaggedLines.length} of {lines.length} underlined
            </span>
          </h3>

          {meld.flagged && flaggedLines.length === 0 && (
            <p className="counselor-criterion-fix" style={{ marginBottom: 10 }}>
              No single sentence stands out against the rest — the draft reads this way throughout
              rather than in one pasted passage, which is what a whole-document flag with no
              individual lines means.
            </p>
          )}

          {/* The draft as prose, with the marked sentences underlined in place.
              A list of numbered rows made it a database of your own essay;
              reading it straight through is how you actually judge whether the
              marks are fair. */}
          <p className="aicheck-prose">
            {lines.map((line, i) => (
              <span key={i} className={line.over ? "aicheck-mark" : undefined} title={line.over ? `AI-like · ${line.score.toFixed(2)}` : undefined}>
                {line.text}{" "}
              </span>
            ))}
          </p>

          <p className="aicheck-foot">
            A sentence is marked when it clears both the document line and this draft&apos;s own
            level ({(meld.sentenceCut ?? meld.threshold).toFixed(2)}). Judging against the document
            line alone flags ordinary sentences in a draft that already scores high.
          </p>
        </div>
      )}

      <div className="report-section">
        <h3 className="report-heading">What the writing itself shows</h3>
        <Detection detection={detection} />
      </div>
    </div>
  );
}

function Detection({ detection }: { detection: AiDetection }) {
  const meld = detection.meld;
  const tone = !meld ? "var(--muted)" : meld.flagged ? "var(--bad)" : "var(--good)";

  return (
    <div className="counselor-review">
      {meld ? (
        <div className="counselor-aiscore">
          <span className="counselor-aiscore-n" style={{ color: tone, fontSize: 26 }}>
            {meld.flagged ? "Flagged" : "Reads human"}
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p className="counselor-aiscore-label">MELD, running on this machine</p>
            <p className="counselor-aiscore-verdict">
              Scored {meld.score.toFixed(2)} against a {meld.threshold.toFixed(2)} line — the score
              below which 99% of human writing fell, so one in a hundred human essays trips it.
              {meld.truncated
                ? " It reads the first 2,048 tokens, and this draft is longer than that."
                : ` It read ${meld.tokensRead} tokens.`}
            </p>
          </div>
        </div>
      ) : (
        <div className="counselor-warn">
          {detection.unavailable ?? "The local detector didn't run."} The measurements below still
          stand — they&apos;re computed from your own words.
        </div>
      )}

      {meld && meld.flagged && meld.passages.length === 0 && (
        <p className="counselor-criterion-fix">
          No single passage stands out against the rest — the whole draft reads this way, rather than
          one pasted paragraph inside it.
        </p>
      )}

      {meld && meld.passages.length > 0 && (
        <div className="counselor-review-block is-cut">
          <span className="section-label">Passages above that line</span>
          {meld.passages.map((x, i) => (
            <div key={i} className="counselor-flagged">
              <p className="counselor-criterion-quote">&ldquo;{x.text}&rdquo;</p>
              <p className="counselor-criterion-fix">Scored {x.score.toFixed(2)}.</p>
            </div>
          ))}
        </div>
      )}

      <div className="counselor-review-block">
        <span className="section-label">What was measured in the prose</span>
        {detection.signals.map((sig) => (
          <div key={sig.label} className="counselor-signal">
            <div className="counselor-signal-head">
              <span className="counselor-signal-name">{sig.label}</span>
              <span className="counselor-signal-track">
                <span style={{ width: `${Math.round(sig.score * 100)}%` }} />
              </span>
            </div>
            <p className="counselor-signal-detail">{sig.detail}</p>
          </div>
        ))}
      </div>

      <p className="counselor-aiscore-caveat">
        Advisory, not evidence. No detector can prove who wrote something, and they misfire most
        often on careful, formal writing — which a college essay is by definition. Treat a flag as
        &ldquo;this reads flat&rdquo;, and fix it the way you&apos;d fix any flat paragraph: put the
        specifics back in.
      </p>
    </div>
  );
}

/**
 * The report: one pass over the essay, read top to bottom.
 *
 * Ordered the way a student uses it — what to do next, then the rubric that
 * says why, then their own draft with every sentence marked, then how
 * machine-written it sounds. The same order the downloaded document is in, so
 * the file and the screen are the same thing.
 */
/** The report's pages. Each answers a different question about the draft. */
const REPORT_TABS = [
  { id: "rubric", label: "Rubric" },
  { id: "sentences", label: "Every sentence" },
  { id: "ai", label: "AI check" },
] as const;

type ReportTab = (typeof REPORT_TABS)[number]["id"];

/**
 * A finished report.
 *
 * Split into pages rather than one long scroll. The three passes answer
 * different questions — how it scores, how each sentence reads, and how
 * machine-written it sounds — and stacked vertically the last one sat below
 * forty sentence cards, which is to say nobody reached it. The three headline
 * numbers stay above the tabs, because those are the thing you came for and
 * they should not require choosing a page first.
 */
function EssayReportView({
  essay,
  report,
  stale,
  grade,
  onReplace,
}: {
  essay: Essay;
  report: EssayReport;
  stale: boolean;
  grade?: string;
  onReplace: (start: number, end: number, next: string) => void;
}) {
  const [tab, setTab] = useState<ReportTab>("rubric");

  const got = report.rubric.scores.reduce((sum, x) => sum + x.score, 0);
  const max = report.rubric.scores.reduce((sum, x) => sum + x.max, 0);
  const meld = report.detection.meld;

  return (
    <div className="counselor-review report">
      {stale && (
        <div className="counselor-warn">
          You&apos;ve edited since this report — it covered a {report.words}-word draft, so sentences
          you&apos;ve changed since are untinted.
        </div>
      )}

      <div className="report-scores">
        <div className="report-score">
          <span className="report-score-n">{report.lines.score}</span>
          <span className="report-score-label">out of 100</span>
        </div>
        <div className="report-score">
          <span className="report-score-n">
            {got}
            <span className="report-score-of">/{max}</span>
          </span>
          <span className="report-score-label">on the rubric</span>
        </div>
        {/* The number, not a verdict. "Flagged" is a judgement a detector has
            not earned the right to make about a student's own writing; the
            score says the same thing and lets them weigh it. */}
        <button
          type="button"
          className="report-score report-score--link"
          onClick={() => setTab("ai")}
          title="Open the AI check"
        >
          <span
            className="report-score-n"
            style={{ color: meld ? (meld.flagged ? "var(--bad)" : "var(--good)") : "var(--muted)" }}
          >
            {meld ? `${Math.round(meld.probability * 100)}%` : "—"}
          </span>
          <span className="report-score-label">machine-like</span>
        </button>
      </div>

      <p className="counselor-review-verdict">{report.rubric.verdict}</p>
      <p className="report-impression">{report.lines.impression}</p>

      <nav className="report-tabs" aria-label="Report sections">
        {REPORT_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`report-tab${tab === t.id ? " is-on" : ""}`}
            aria-current={tab === t.id ? "page" : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "sentences" && report.lines.lines.length > 0 && (
              <span className="report-tab-n">{report.lines.lines.length}</span>
            )}
            {t.id === "ai" && meld?.flagged && <span className="report-tab-dot" aria-label="flagged" />}
          </button>
        ))}
      </nav>

      {tab === "rubric" && (
        <>
          <div className="report-section report-section--points">
            <h3 className="report-heading report-heading--points">Where the points went</h3>
            {report.lines.categories.map((cat) => (
              <div key={cat.name} className="counselor-signal">
                <div className="counselor-signal-head">
                  <span className="counselor-signal-name">{cat.name}</span>
                  <span className="counselor-signal-track">
                    <span
                      style={{
                        width: `${Math.round((cat.score / cat.max) * 100)}%`,
                        background: barTone(cat.score / cat.max),
                      }}
                    />
                  </span>
                  <span className="counselor-criterion-score">
                    {cat.score}/{cat.max}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="report-section">
            <h3 className="report-heading">The rubric, line by line</h3>
            <Review feedback={report.rubric} />
          </div>

          {report.lines.improvements.length > 0 && (
            <div className="report-section">
              <h3 className="report-heading">Change</h3>
              {report.lines.improvements.map((x, i) => (
                <div key={i} className="counselor-lines-point">
                  <p className="counselor-lines-point-title">{x.title}</p>
                  <p className="counselor-criterion-fix">{x.detail}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "sentences" && (
        <div className="report-section">
          {report.lines.unavailable ? (
            <p className="counselor-empty-note">{report.lines.unavailable}</p>
          ) : (
            <Lines review={report.lines} content={essay.content} grade={grade} onReplace={onReplace} />
          )}
        </div>
      )}

      {tab === "ai" && (
        <div className="report-section">
          <AiCheck detection={report.detection} />
        </div>
      )}
    </div>
  );
}

function History({ essay, onRestore }: { essay: Essay; onRestore: (content: string) => void }) {
  if (!essay.versions.length) {
    return <p className="counselor-empty-note">No saved drafts yet.</p>;
  }
  return (
    <div className="counselor-review">
      {essay.versions.map((v) => (
        <div key={v.id} className="counselor-version">
          <div style={{ minWidth: 0, flex: 1 }}>
            <p className="counselor-version-when">
              {new Date(v.savedAt).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
              {" · "}
              {v.words} words
              {v.note ? ` · ${v.note}` : ""}
            </p>
            <p className="counselor-version-peek">{v.content.slice(0, 180)}…</p>
          </div>
          <button type="button" className="btn btn--quiet" onClick={() => onRestore(v.content)}>
            Restore
          </button>
        </div>
      ))}
    </div>
  );
}

/** PDF and plain text go through the reader the tutor already uses. */
async function readText(file: File): Promise<string> {
  const attachment = await readAttachment(file);
  if (attachment.kind !== "document") throw new Error("That's an image — upload a document.");
  return attachment.text;
}
