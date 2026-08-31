"use client";

import { useEffect, useRef, useState } from "react";

import { IMPACT_LABEL, useStore, type SubmitState } from "@/lib/store";
import { fmtBytes, fmtClock, fmtMinutes } from "@/lib/format";
import { Badge, ClockIcon, Icon, ICON, Spinner } from "./ui";
import AssessmentPanel from "./AssessmentPanel";

/**
 * What's happening right now, while Schoology's dropbox is being driven.
 *
 * The stages are real — the scraper reports each one as it starts — and the
 * clock is there because the honest answer to "how long does this take" is "a
 * few seconds, and here's proof it isn't stuck".
 */
function SubmitProgress({ state }: { state: SubmitState }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const elapsed = state.startedAt ? Math.max(0, Math.round((now - state.startedAt) / 1000)) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Spinner />
        <span style={{ fontSize: 12, color: "var(--text)" }}>{state.step ?? "Submitting"}…</span>
        <span style={{ flex: 1 }} />
        <span className="tabular" style={{ fontSize: 12, color: "var(--muted)" }}>
          {elapsed}s
        </span>
      </div>
      <div className="progress" />
      <p style={{ margin: 0, fontSize: 11, color: "var(--muted)", lineHeight: 1.45 }}>
        Slates is working through Schoology&apos;s own submission box in the background. Moving to
        another view won&apos;t interrupt it.
      </p>
    </div>
  );
}

export default function AssignmentView() {
  const s = useStore();
  const id = s.assignmentId!;
  const a = s.assignmentById(id);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (!a) return null;

  const course = s.courseById(a.courseId);
  const status = s.statusOf(a);
  const submitted = status === "done";
  const overlay = a.submit === "overlay";
  // Don't call something timed unless Schoology says it has a limit — most
  // assessments don't, and the badge was claiming otherwise for all of them.
  const schoologyLabel = a.assessment
    ? a.assessment.timeLimitMin
      ? "Timed assessment"
      : "Assessment"
    : a.kind === "drive"
      ? "Google Drive"
      : a.kind === "discussion"
        ? "Schoology discussion"
        : "Schoology assignment";
  const files = s.files[id] ?? [];
  const comments = [...(a.comments ?? []), ...(s.localComments[id] ?? [])];
  const submitState = s.submitState[id] ?? { phase: "idle" as const };
  const busy = submitState.phase === "submitting" || submitState.phase === "verifying";
  const tracked = s.timeTotals[id] ?? 0;
  const timing = s.activeTimer === id;
  const acceptsText = a.submissionTypes?.includes("text") ?? true;
  const acceptsFiles = a.submissionTypes?.includes("file") ?? true;

  // A locally-ticked item was never handed in anywhere; saying otherwise would
  // misreport what Schoology actually has.
  const nothingToSubmit = a.submit === "none";
  const meta = s.submittedAt[id]
    ? `Turned in · ${s.submittedAt[id]}`
    : submitted
      ? nothingToSubmit
        ? "Marked done in Slates"
        : "Turned in on Schoology"
    : s.draftSavedAt[id]
      ? `Draft saved · ${s.draftSavedAt[id]}`
      : "Not turned in yet";

  return (
    <div className="scroll centered" style={{ paddingBottom: 32 }}>
      <div className="col" style={{ maxWidth: 640, gap: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          {course && <Badge tone={course.tone}>{course.short}</Badge>}
          <Badge tone={IMPACT_LABEL[a.impact].tone}>{IMPACT_LABEL[a.impact].label}</Badge>
          <Badge tone={submitted ? "success" : status === "active" ? "secondary" : "outline"}>
            {submitted
              ? nothingToSubmit
                ? "Done"
                : "Turned in"
              : status === "active"
                ? "In progress"
                : "Not started"}
          </Badge>
          {overlay && <Badge tone="speed">{schoologyLabel}</Badge>}
        </div>

        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.3 }}>
            {a.title}
          </h2>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>
            {a.due} · {fmtMinutes(a.minutes)} · {a.code}
          </p>
        </div>

        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--text-2)" }}>{a.brief}</p>

        {/* Time tracking — the thing only the extension can measure. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--line)",
            background: "var(--sunken)",
            boxShadow: "var(--shadow-sunken)",
            padding: "10px 14px",
          }}
        >
          <ClockIcon size={14} />
          <span className="tabular" style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
            {fmtClock(tracked)}
          </span>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {timing ? "tracking now" : tracked ? "tracked so far" : "no time tracked yet"}
          </span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className={`btn ${timing ? "btn--quiet" : "btn--primary"}`}
            onClick={() => s.toggleTimer(id)}
          >
            {timing ? "Stop" : "Start timer"}
          </button>
        </div>

        {a.grade && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              borderRadius: "var(--radius-sm)",
              border: "1px solid oklch(0.55 0.13 145 / 0.3)",
              background: "oklch(0.72 0.13 145 / 0.1)",
              padding: "14px 16px",
            }}
          >
            <span
              className="tabular"
              style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--good)" }}
            >
              {Math.round((a.grade.earned / a.grade.possible) * 100)}%
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                Graded · {a.grade.earned}/{a.grade.possible}
              </p>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-2)", lineHeight: 1.4 }}>
                {a.grade.feedback}
              </p>
            </div>
          </div>
        )}

        <div className="divider" />

        {nothingToSubmit ? (
          /* Schoology exposes no dropbox for this one — nothing can be handed
             in from Slates or from Schoology itself. Showing a response box
             here would be inventing a submission that doesn't exist. */
          <div
            style={{
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--line)",
              background: "var(--sunken)",
              padding: "18px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <span className="section-label">Nothing to hand in</span>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--text-2)" }}>
              Schoology has no submission box for this — it&apos;s handed in on paper, done in
              class, or just something to have ready. Tick it off here when you&apos;ve done it.
            </p>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                className={submitted ? "btn" : "btn btn--primary"}
                style={{ height: 36 }}
                onClick={() => s.setStatus(id, submitted ? "todo" : "done")}
              >
                {submitted ? "Move back to to-do" : "Mark done"}
              </button>
              <a
                className="btn"
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ height: 36, textDecoration: "none" }}
              >
                <Icon path={ICON.external} size={14} />
                View on Schoology
              </a>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", lineHeight: 1.45 }}>
              This only changes Slates. There is nothing for Schoology to receive, so your
              teacher still marks it however they normally do.
            </p>
          </div>
        ) : a.assessment ? (
          /* A real Schoology assessment: its own config tells us the limit,
             attempts, window, and whether it can run in a browser at all. */
          <AssessmentPanel a={a} />
        ) : overlay ? (
          /* Quizzes, assessments, and Drive-linked work: Schoology owns the
             attempt. Slates opens the real page with its overlay on top. */
          <div
            style={{
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--line)",
              background: "var(--sunken)",
              padding: "18px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <span className="section-label">
              {schoologyLabel}
            </span>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--text-2)" }}>
              {a.kind === "drive"
                ? "The doc lives in your Google account and Schoology owns the handoff. Slates opens the real page with your timer and notes on top."
                : a.kind === "assessment" || a.kind === "quiz"
                  ? "Schoology runs the timer and grades this attempt. Slates opens the real page with your timer and notes overlaid — your attempt stays where your teacher expects it."
                  : "This activity uses Schoology's own submission setup. Slates opens the real page so you see the exact response, attachment, discussion, or external-tool controls your teacher configured."}
            </p>
            {a.timeLimitMin && (
              <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
                {a.timeLimitMin} minute limit · attempt{" "}
                {(a.attemptsUsed ?? 0) + 1} of {a.attemptsAllowed ?? "unlimited"}
                {a.resumable ? " · resumable" : ""}
              </p>
            )}
            <button
              type="button"
              className="btn btn--primary"
              style={{ alignSelf: "flex-start", height: 36 }}
              onClick={() => s.openOverlay(id)}
            >
              <Icon path={ICON.external} size={14} />
              Open in Schoology
            </button>
          </div>
        ) : (
          <>
            {acceptsText && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span className="section-label">Written response</span>
                <div className="ph-field">
                  <textarea
                    className="textarea"
                    style={{ minHeight: 90, opacity: submitted ? 0.6 : 1 }}
                    value={s.text[id] ?? ""}
                    onChange={(e) => s.setText(id, e.target.value)}
                    readOnly={submitted}
                    aria-label="Type your response here"
                    placeholder=" "
                  />
                  <span className="ph-field__hint" aria-hidden>
                    Type your response here
                    <span className="ph-field__dots">...</span>
                  </span>
                </div>
              </div>
            )}

            {acceptsFiles && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span className="section-label">Attachments</span>

              <input
                ref={fileRef}
                type="file"
                multiple
                style={{ display: "none" }}
                onChange={(e) => {
                  s.addFiles(id, e.target.files);
                  e.target.value = "";
                }}
              />

              <button
                type="button"
                onClick={() => !submitted && fileRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!submitted) setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (!submitted) s.addFiles(id, e.dataTransfer.files);
                }}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  width: "100%",
                  borderRadius: "var(--radius-sm)",
                  border: `1.5px dashed ${dragging ? "var(--ring)" : "var(--line-strong)"}`,
                  background: dragging ? "oklch(0.4 0.08 250 / 0.12)" : "oklch(0.269 0 0 / 0.4)",
                  padding: "26px 16px",
                  textAlign: "center",
                  font: "inherit",
                  cursor: submitted ? "default" : "pointer",
                  transition: "background .15s, border-color .15s",
                  opacity: submitted ? 0.6 : 1,
                  pointerEvents: submitted ? "none" : "auto",
                }}
              >
                <span style={{ color: "var(--faint)" }}>
                  <Icon path={[ICON.upload, ICON.uploadTray]} size={22} />
                </span>
                <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>
                  Drop files, or click to browse
                </span>
                <span style={{ fontSize: 11, color: "var(--faint)" }}>
                  {files.length
                    ? `${files.length} file${files.length > 1 ? "s" : ""} attached`
                    : "No files attached yet"}
                </span>
              </button>

              {files.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {files.map((f) => (
                    <div
                      key={f.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        borderRadius: 12,
                        border: "1px solid var(--line)",
                        background: "var(--sunken)",
                        padding: "8px 10px",
                      }}
                    >
                      <span style={{ color: "var(--faint)" }}>
                        <Icon path={ICON.file} size={14} />
                      </span>
                      <span className="truncate" style={{ flex: 1, fontSize: 12, color: "var(--text)" }}>
                        {f.name}
                      </span>
                      <span className="tabular" style={{ flexShrink: 0, fontSize: 11, color: "var(--faint)" }}>
                        {fmtBytes(f.size)}
                      </span>
                      {!submitted && (
                        <button
                          type="button"
                          aria-label="Remove file"
                          onClick={() => s.removeFile(id, f.id)}
                          style={{
                            flexShrink: 0,
                            width: 18,
                            height: 18,
                            border: 0,
                            borderRadius: 9999,
                            background: "transparent",
                            color: "var(--muted)",
                            fontSize: 14,
                            lineHeight: 1,
                            cursor: "pointer",
                          }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}

            {busy ? (
              <SubmitProgress state={submitState} />
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{meta}</span>
              </div>
            )}

            {/* Submitting to Schoology isn't wired up yet — this surfaces that
                plainly rather than implying the work was turned in. */}
            {submitState.phase === "error" && (
              <div
                style={{
                  borderRadius: 12,
                  border: "1px solid oklch(0.6 0.18 25 / 0.3)",
                  background: "oklch(0.6 0.18 25 / 0.12)",
                  padding: "10px 12px",
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: "var(--bad)",
                }}
              >
                {submitState.message ?? "Submission failed."} Check Schoology directly before assuming this
                is turned in.
              </div>
            )}

            {!submitted ? (
              <>
                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    type="button"
                    className={`btn btn--quiet ${busy ? "btn--busy" : ""}`}
                    style={{ flex: 1, height: 36 }}
                    disabled={busy}
                    onClick={() => void s.saveDraft(id)}
                  >
                    Save draft
                  </button>
                  <button
                    type="button"
                    className={`btn btn--primary ${busy ? "btn--busy" : ""}`}
                    style={{ flex: 1, height: 36 }}
                    disabled={busy}
                    onClick={() => {
                      // This goes to the teacher. Worth one deliberate click.
                      if (confirming) {
                        setConfirming(false);
                        void s.turnIn(id);
                      } else {
                        setConfirming(true);
                      }
                    }}
                  >
                    {busy ? (
                      <>
                        <Spinner />
                        {submitState.phase === "verifying" ? "Checking..." : "Turning in..."}
                      </>
                    ) : confirming ? (
                      "Confirm — send to Schoology"
                    ) : (
                      "Turn in"
                    )}
                  </button>
                </div>
                {confirming && !busy && (
                  <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", lineHeight: 1.45 }}>
                    This submits to Schoology for real, where your teacher sees it.{" "}
                    <button
                      type="button"
                      onClick={() => setConfirming(false)}
                      style={{
                        border: 0,
                        background: "transparent",
                        padding: 0,
                        font: "inherit",
                        color: "var(--text-2)",
                        textDecoration: "underline",
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                  </p>
                )}
              </>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button
                  type="button"
                  className="btn btn--quiet"
                  style={{ height: 36, alignSelf: "flex-start" }}
                  onClick={() => void s.unsubmit(id)}
                >
                  Submit again
                </button>
                <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", lineHeight: 1.45 }}>
                  Slates can&apos;t retract a submission. Submitting again adds a new one on
                  Schoology, the same as resubmitting there.
                </p>
              </div>
            )}
          </>
        )}

        <div className="divider" />

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="section-label">Comments</span>

          {comments.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {comments.map((c, i) => (
                <div key={i} style={{ borderRadius: 14, background: "var(--sunken)", padding: "10px 12px" }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: c.from ? "var(--text)" : "var(--ring)",
                      }}
                    >
                      {c.from ?? "You"}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--faint)", flexShrink: 0 }}>{c.time}</span>
                  </div>
                  <p style={{ margin: "4px 0 0", fontSize: 13, lineHeight: 1.4, color: "var(--text-2)" }}>
                    {c.text}
                  </p>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <div className="ph-field ph-field--compact" style={{ flex: 1 }}>
              <textarea
                className="textarea"
                rows={1}
                style={{ minHeight: 0, resize: "none", padding: "8px 10px" }}
                value={s.commentDraft[id] ?? ""}
                onChange={(e) => s.setCommentDraft(id, e.target.value)}
                aria-label="Add a comment"
                placeholder=" "
              />
              <span className="ph-field__hint" aria-hidden>
                Add a comment
                <span className="ph-field__dots">...</span>
              </span>
            </div>
            <button
              type="button"
              className="btn btn--quiet"
              style={{ height: 32, flexShrink: 0 }}
              disabled={!(s.commentDraft[id] ?? "").trim()}
              onClick={() => s.addComment(id)}
            >
              Post
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
