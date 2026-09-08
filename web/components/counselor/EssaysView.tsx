"use client";

import { motion } from "motion/react";
import { useCallback, useMemo, useRef, useState } from "react";

import { countWords } from "@/lib/counselor/ai-signals";
import { DEFAULT_LIMIT, ESSAY_KIND_LABEL, RUBRICS } from "@/lib/counselor/rubric";
import { uid } from "@/lib/counselor/state";
import { useCounselor } from "@/lib/counselor/store";
import { ESSAY_KINDS, type AiCheck, type Essay, type EssayFeedback, type EssayKind } from "@/lib/counselor/types";
import { isDocx, readDocx } from "@/lib/docx";
import { readAttachment } from "@/lib/attachments";
import { useStore } from "@/lib/store";
import { Icon, ICON, Spinner } from "../ui";

/**
 * The essay studio.
 *
 * Three things a student actually needs while drafting, in one place: the
 * draft with its word count against the real limit, a rubric review that has
 * to cite the line it is scoring, and an honest read of how machine-written
 * the prose sounds.
 *
 * The counselor reads what's here — it is part of the record — so the essay
 * you're stuck on is something you can ask it about in the next conversation
 * without pasting it again.
 */

type Tab = "draft" | "review" | "check" | "history";

export default function EssaysView() {
  const c = useCounselor();
  const [tab, setTab] = useState<Tab>("draft");

  const essay = useMemo(
    () => c.essays.find((e) => e.id === c.essayId) ?? c.essays[0] ?? null,
    [c.essays, c.essayId]
  );

  function create() {
    const now = Date.now();
    const fresh: Essay = {
      id: uid(),
      title: "Untitled essay",
      kind: "personal-statement",
      prompt: "",
      wordLimit: DEFAULT_LIMIT["personal-statement"],
      content: "",
      versions: [],
      createdAt: now,
      updatedAt: now,
    };
    c.saveEssay(fresh);
    c.openEssay(fresh.id);
    setTab("draft");
  }

  return (
    <div className="counselor-split">
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
          {c.essays.length === 0 && (
            <p className="counselor-empty-note">
              Nothing yet. Start one, paste a draft, or upload a Word doc or PDF.
            </p>
          )}
          {c.essays.map((e) => {
            const words = countWords(e.content);
            const over = e.wordLimit != null && words > e.wordLimit;
            return (
              <button
                key={e.id}
                type="button"
                className={`counselor-doc-row${e.id === essay?.id ? " is-active" : ""}`}
                onClick={() => {
                  c.openEssay(e.id);
                  setTab("draft");
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
            );
          })}
        </div>
      </div>

      {essay ? (
        <Studio key={essay.id} essay={essay} tab={tab} setTab={setTab} />
      ) : (
        <div className="counselor-blank">Start an essay.</div>
      )}
    </div>
  );
}

function Studio({ essay, tab, setTab }: { essay: Essay; tab: Tab; setTab: (t: Tab) => void }) {
  const c = useCounselor();
  const school = useStore();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [busy, setBusy] = useState<"" | "review" | "check" | "upload">("");
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState(false);

  const words = countWords(essay.content);
  const over = essay.wordLimit != null && words > essay.wordLimit;

  const patch = useCallback(
    (next: Partial<Essay>) => c.saveEssay({ ...essay, ...next, updatedAt: Date.now() }),
    [c, essay]
  );

  /** Feedback is stamped with the word count it was written about. */
  const stale = essay.feedback != null && essay.feedback.words !== words;
  const staleCheck = essay.aiCheck != null && essay.aiCheck.words !== words;

  async function run(action: "feedback" | "ai-check") {
    setError(null);
    setBusy(action === "feedback" ? "review" : "check");
    try {
      const res = await fetch("/api/counselor/essay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          content: essay.content,
          kind: essay.kind,
          prompt: essay.prompt || undefined,
          wordLimit: essay.wordLimit,
          studentContext:
            action === "feedback"
              ? [
                  c.profile.intendedMajor && `Intended major: ${c.profile.intendedMajor}`,
                  c.profile.activities.length &&
                    `Activities: ${c.profile.activities.map((a) => a.name).join(", ")}`,
                  c.memories.length &&
                    `Known about them: ${c.memories.slice(0, 8).map((m) => m.content).join(" ")}`,
                ]
                  .filter(Boolean)
                  .join("\n") || undefined
              : undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error ?? `Failed (${res.status})`);
      patch(action === "feedback" ? { feedback: body as EssayFeedback } : { aiCheck: body as AiCheck });
      setTab(action === "feedback" ? "review" : "check");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy("");
    }
  }

  async function upload(file: File) {
    setError(null);
    setBusy("upload");
    try {
      const text = isDocx(file) ? await readDocx(file) : await readText(file);
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
      setBusy("");
    }
  }

  const openWork = school.snapshot.assignments.filter(
    (a) => school.onBoard(a) && school.statusOf(a) !== "done"
  );

  return (
    <div className="counselor-detail-pane">
      <div className="counselor-detail-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <input
            className="counselor-essay-title"
            value={essay.title}
            onChange={(e) => patch({ title: e.target.value })}
            aria-label="Essay title"
          />
          <p className="counselor-detail-sub">
            {ESSAY_KIND_LABEL[essay.kind]}
            {essay.collegeName ? ` · ${essay.collegeName}` : ""}
            {essay.assignmentTitle ? ` · linked to ${essay.assignmentTitle}` : ""}
            {" · "}
            <span style={over ? { color: "var(--bad)", fontWeight: 600 } : undefined}>
              {words}
              {essay.wordLimit ? ` / ${essay.wordLimit}` : ""} words
              {over ? ` — ${words - (essay.wordLimit ?? 0)} over` : ""}
            </span>
          </p>
        </div>

        <button type="button" className="btn btn--quiet" onClick={() => setMeta((v) => !v)}>
          <Icon path={ICON.settings} size={13} />
          Setup
        </button>
        <button
          type="button"
          className="icon-btn"
          style={{ width: 30, height: 30 }}
          onClick={() => c.removeEssay(essay.id)}
          aria-label="Delete essay"
        >
          <Icon path={ICON.trash} size={13} />
        </button>
      </div>

      {meta && (
        <Setup
          essay={essay}
          patch={patch}
          assignments={openWork.map((a) => ({
            id: a.id,
            title: a.title,
            course: school.courseById(a.courseId)?.short ?? "",
          }))}
        />
      )}

      <div className="counselor-tabs">
        {(
          [
            ["draft", "Draft"],
            ["review", essay.feedback ? `Review · ${overall(essay.feedback)}` : "Review"],
            ["check", essay.aiCheck ? `AI check · ${essay.aiCheck.score}` : "AI check"],
            ["history", `History${essay.versions.length ? ` · ${essay.versions.length}` : ""}`],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`counselor-tab${tab === key ? " is-on" : ""}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}

        <span style={{ flex: 1 }} />

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
        <button type="button" className="btn btn--quiet" disabled={!!busy} onClick={() => fileRef.current?.click()}>
          {busy === "upload" ? <Spinner size={12} /> : <Icon path={ICON.upload} size={13} />}
          Upload
        </button>
        <button
          type="button"
          className="btn btn--quiet"
          disabled={!!busy || words < 40}
          onClick={() => void run("ai-check")}
          title={words < 40 ? "Needs a real draft first" : "Estimate how machine-written this reads"}
        >
          {busy === "check" ? <Spinner size={12} /> : null}
          AI check
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!!busy || words < 40}
          onClick={() => void run("feedback")}
        >
          {busy === "review" ? <Spinner size={12} /> : null}
          Review it
        </button>
      </div>

      {error && <div className="counselor-error" style={{ margin: "0 20px 8px" }}>{error}</div>}

      <div className="counselor-detail-scroll">
        {tab === "draft" && (
          <>
            {essay.prompt && <p className="counselor-essay-prompt">{essay.prompt}</p>}
            <textarea
              className="counselor-essay-editor"
              value={essay.content}
              onChange={(e) => patch({ content: e.target.value })}
              placeholder="Write, or paste your draft here."
              spellCheck
            />
            <div className="counselor-essay-foot">
              <button
                type="button"
                className="btn btn--quiet"
                disabled={!essay.content.trim()}
                onClick={() =>
                  patch({
                    versions: [
                      { id: uid(), content: essay.content, words, savedAt: Date.now() },
                      ...essay.versions,
                    ],
                  })
                }
              >
                Save this draft
              </button>
              <span className="counselor-essay-hint">
                Snapshots let you see what a revision actually changed.
              </span>
            </div>
          </>
        )}

        {tab === "review" && <Review feedback={essay.feedback} kind={essay.kind} stale={stale} />}
        {tab === "check" && <Check check={essay.aiCheck} stale={staleCheck} />}
        {tab === "history" && (
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
        )}
      </div>
    </div>
  );
}

function overall(feedback: EssayFeedback): string {
  const got = feedback.scores.reduce((sum, s) => sum + s.score, 0);
  const max = feedback.scores.reduce((sum, s) => sum + s.max, 0);
  return `${got}/${max}`;
}

function Setup({
  essay,
  patch,
  assignments,
}: {
  essay: Essay;
  patch: (next: Partial<Essay>) => void;
  assignments: { id: string; title: string; course: string }[];
}) {
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
            {ESSAY_KINDS.map((k) => (
              <option key={k} value={k}>
                {ESSAY_KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <span className="counselor-essay-hint" style={{ display: "block", marginTop: 4 }}>
            {RUBRICS[essay.kind].label}: scored on{" "}
            {RUBRICS[essay.kind].criteria.map((x) => x.name.toLowerCase()).join(", ")}.
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
    </div>
  );
}

function Review({
  feedback,
  kind,
  stale,
}: {
  feedback?: EssayFeedback;
  kind: EssayKind;
  stale: boolean;
}) {
  if (!feedback) {
    return (
      <p className="counselor-empty-note">
        Not reviewed yet. It&apos;s scored against the {RUBRICS[kind].label.toLowerCase()} rubric —{" "}
        {RUBRICS[kind].criteria.map((c) => c.name.toLowerCase()).join(", ")} — and every score has to
        quote the line it&apos;s judging.
      </p>
    );
  }

  return (
    <div className="counselor-review">
      {stale && (
        <div className="counselor-warn" style={{ marginBottom: 4 }}>
          You&apos;ve edited since this review — it was written about a {feedback.words}-word draft.
        </div>
      )}

      <p className="counselor-review-verdict">{feedback.verdict}</p>

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

function Check({ check, stale }: { check?: AiCheck; stale: boolean }) {
  if (!check) {
    return (
      <p className="counselor-empty-note">
        Not checked yet. This measures your actual prose — rhythm, concrete detail, contractions, and
        the vocabulary models overuse — rather than sending your draft to detector websites. Every
        number below is computed here and shown with the measurement behind it.
      </p>
    );
  }

  const tone = check.score < 25 ? "var(--good)" : check.score < 55 ? "var(--warn)" : "var(--bad)";

  return (
    <div className="counselor-review">
      {stale && (
        <div className="counselor-warn" style={{ marginBottom: 4 }}>
          You&apos;ve edited since this check — it ran on a {check.words}-word draft.
        </div>
      )}

      <div className="counselor-aiscore">
        <span className="counselor-aiscore-n" style={{ color: tone }}>
          {check.score}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p className="counselor-aiscore-label">Reads as machine-written</p>
          <p className="counselor-aiscore-verdict">{check.verdict}</p>
        </div>
      </div>

      <div className="counselor-review-block">
        <span className="section-label">What was measured</span>
        {check.signals.map((s) => (
          <div key={s.label} className="counselor-signal">
            <div className="counselor-signal-head">
              <span className="counselor-signal-name">{s.label}</span>
              <span className="counselor-signal-track">
                <span style={{ width: `${Math.round(s.score * 100)}%` }} />
              </span>
            </div>
            <p className="counselor-signal-detail">{s.detail}</p>
          </div>
        ))}
      </div>

      {check.flagged.length > 0 && (
        <div className="counselor-review-block is-cut">
          <span className="section-label">Passages that read as generated</span>
          {check.flagged.map((f, i) => (
            <div key={i} className="counselor-flagged">
              <p className="counselor-criterion-quote">&ldquo;{f.quote}&rdquo;</p>
              <p className="counselor-criterion-fix">{f.why}</p>
            </div>
          ))}
        </div>
      )}

      {check.external.length > 0 && (
        <div className="counselor-review-block">
          <span className="section-label">Third-party detectors</span>
          <ul>
            {check.external.map((d) => (
              <li key={d.name}>
                {d.name}: {d.score}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="counselor-aiscore-caveat">
        Advisory, not evidence. No detector can prove who wrote something, and they misfire most
        often on careful, formal writing — which a college essay is by definition. Treat a high score
        as &ldquo;this reads flat&rdquo;, and fix it the way you&apos;d fix any flat paragraph: put
        the specifics back in.
      </p>
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
