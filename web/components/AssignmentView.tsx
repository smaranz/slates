"use client";

import { useEffect, useRef, useState } from "react";

import { IMPACT_LABEL, useStore, type SubmitState } from "@/lib/store";
import { fmtBytes, fmtClock, fmtMinutes } from "@/lib/format";
import type { AssessmentReview, ItemAttachment } from "@/lib/types";
import { Badge, ClockIcon, Icon, ICON, Spinner } from "./ui";
import AssessmentPanel from "./AssessmentPanel";
import QuestionReview from "./QuestionReview";

/**
 * Whether an item is really an online assessment barely ever changes once
 * answered, so the answer is kept here — module-scoped, keyed by URL — rather
 * than in component state. Without it, navigating back to an item already
 * looked at in this session would repeat the multi-second real-page check and
 * flash the submission box again while it ran.
 */
const reviewCache = new Map<string, AssessmentReview>();

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

/** File types Chromium draws itself. Anything else is handed to the browser. */
const DRAWABLE = /\.(pdf|png|jpe?g|gif|webp|svg|txt)$/i;

/**
 * Handouts and links posted with the item.
 *
 * Often this *is* the assignment — "Quizlet: 1.1 Vocabulario" has no write-up
 * at all, just a link to the set you're meant to study — so it sits directly
 * under the description rather than behind an "open in Schoology" trip.
 *
 * A file Chromium can draw opens in place: its bytes come back through the
 * scraper, which is the only thing holding a Schoology session. A link leaves
 * for the real site, and goes to the destination itself rather than through
 * Schoology's redirect, which would need that session too.
 */
function Attachments({ items, domain }: { items: ItemAttachment[]; domain: string }) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span className="section-label">
        {items.length === 1 ? "Attached" : `Attached · ${items.length}`}
      </span>

      {items.map((at) => {
        const drawable = at.kind === "file" && DRAWABLE.test(at.url);
        const showing = open === at.url;
        const away = at.target || new URL(at.url, `https://${domain}`).href;
        // The filename only earns a line when it isn't just the title again.
        const sub = [at.filename !== at.title ? at.filename : "", at.size]
          .filter(Boolean)
          .join(" · ");

        return (
          <div key={at.url} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              type="button"
              className="palette-row"
              onClick={() =>
                drawable
                  ? setOpen(showing ? null : at.url)
                  : window.open(away, "_blank", "noopener,noreferrer")
              }
              style={{
                border: "1px solid var(--line)",
                background: "var(--surface)",
                padding: "11px 13px",
                alignItems: "flex-start",
              }}
            >
              <span style={{ display: "flex", width: 18, justifyContent: "center", marginTop: 1, flexShrink: 0 }}>
                <Icon
                  path={at.kind === "file" ? ICON.file : ICON.external}
                  size={14}
                  style={{ color: "var(--text-2)" }}
                />
              </span>

              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="truncate" style={{ display: "block", fontSize: 13.5, color: "var(--text)" }}>
                  {at.title}
                </span>
                {sub && (
                  <span
                    className="truncate"
                    style={{ display: "block", marginTop: 3, fontSize: 12, color: "var(--muted)" }}
                  >
                    {sub}
                  </span>
                )}
              </span>

              <span style={{ flexShrink: 0, fontSize: 11.5, color: "var(--faint)" }}>
                {drawable ? (showing ? "Hide" : "Open") : at.kind === "file" ? "Download" : "Open ↗"}
              </span>
            </button>

            {showing && (
              <iframe
                src={`/api/materials/file?path=${encodeURIComponent(at.url)}`}
                title={at.title}
                style={{
                  height: 620,
                  width: "100%",
                  border: "1px solid var(--line)",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--surface)",
                }}
              />
            )}
          </div>
        );
      })}
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

  /*
   * Some graded items aren't tagged `kind === "assessment"` at all — a
   * teacher-built "worksheet" can still be an online, Learnosity-backed quiz
   * under the hood, and Slates has no cheap way to tell in advance. Checking
   * is silent and automatic: nobody wants to read "Slates doesn't know yet",
   * so this fetches in the background and only ever renders the answer —
   * the breakdown if it's really online, the ordinary submission box if it
   * isn't. A check that fails degrades to that same submission box rather
   * than announcing the failure; the worst case is a write-response field
   * next to a paper grade, which is exactly what showed before this existed.
   *
   * `undefined` means "still checking" and is its own render state — never
   * showing the submission box before the check is settled is the whole
   * point, otherwise a real quiz flashes a fake response field for a moment
   * on every first visit.
   */
  const [review, setReview] = useState<AssessmentReview | undefined>(() =>
    a ? reviewCache.get(a.url) : undefined
  );
  // Reset for a new item during render rather than in an effect — an effect
  // would paint the previous item's breakdown for one frame before clearing it.
  const [reviewForId, setReviewForId] = useState(id);
  if (reviewForId !== id) {
    setReviewForId(id);
    setReview(a ? reviewCache.get(a.url) : undefined);
  }

  // Exactly the population that would otherwise fall into the generic
  // submission branch below — a real grade with nothing already explaining it.
  // Computed with optional chaining (not after the `!a` check) because the
  // effect that reads it is a hook and has to run on every render regardless.
  const maybeOnline = Boolean(a?.grade) && !a?.assessment && a?.submit !== "overlay" && a?.submit !== "none";
  const assignmentUrl = a?.url;

  useEffect(() => {
    if (!maybeOnline || !assignmentUrl || reviewCache.has(assignmentUrl)) return;
    let live = true;
    (async () => {
      // Not cached on failure, so a later visit gets to try the real check
      // again — but this visit still needs an answer now, and "assume it's
      // an ordinary submission" is the same safe default the whole feature
      // falls back to everywhere else.
      let result: AssessmentReview = { online: false, title: "", attempts: [] };
      try {
        const res = await fetch(`/api/assessment/review?url=${encodeURIComponent(assignmentUrl)}`, {
          cache: "no-store",
        });
        if (res.ok) {
          result = await res.json();
          reviewCache.set(assignmentUrl, result);
        }
      } catch {
        /* falls through to the offline default below */
      }
      if (live) setReview(result);
    })();
    return () => {
      live = false;
    };
  }, [maybeOnline, assignmentUrl]);

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
      <div className="col" style={{ maxWidth: 1300, gap: 20 }}>
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

        {/* The cards below use the full width; prose reads better capped narrower. */}
        <div style={{ maxWidth: "70ch" }}>
          <h2 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.3 }}>
            {a.title}
          </h2>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>
            {[
              submitted ? "Turned in" : a.due,
              fmtMinutes(a.minutes),
              a.code,
              a.postedAt && `Posted ${a.postedAt}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        {/* What the teacher actually wrote, structure and all. Markup when the
            scraper kept it; otherwise the plain text, whose line breaks are
            the only structure left to preserve. */}
        {a.briefHtml ? (
          <div
            className="prose"
            style={{ maxWidth: "70ch" }}
            dangerouslySetInnerHTML={{ __html: a.briefHtml }}
          />
        ) : (
          a.brief && (
            <div className="prose prose--plain" style={{ maxWidth: "70ch" }}>
              {a.brief}
            </div>
          )
        )}

        {(a.attachments?.length ?? 0) > 0 && (
          <Attachments items={a.attachments!} domain={s.snapshot.domain} />
        )}

        {/* Time tracking and the grade sit in one card, not two — both are
            metadata about the assignment, not separate topics. */}
        <div
          style={{
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--line)",
            background: "var(--sunken)",
            boxShadow: "var(--shadow-sunken)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px" }}>
            <ClockIcon size={14} />
            <span className="tabular" style={{ fontSize: 17, fontWeight: 600, color: "var(--text)" }}>
              {fmtClock(tracked)}
            </span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {timing ? "tracking now" : tracked ? "tracked so far" : "no time tracked yet"}
            </span>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              className={`btn ${timing ? "btn--quiet" : "btn--primary"}`}
              style={{ height: 36 }}
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
                gap: 12,
                padding: "16px 20px",
                borderTop: "1px solid var(--line)",
              }}
            >
              <span
                className="tabular"
                style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--good)" }}
              >
                {Math.round((a.grade.earned / a.grade.possible) * 100)}%
              </span>
              <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                  Graded · {a.grade.earned}/{a.grade.possible}
                </span>
                {a.grade.feedback && (
                  <span style={{ marginTop: 2, fontSize: 12, color: "var(--muted)", lineHeight: 1.4 }}>
                    {a.grade.feedback}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

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
              padding: "24px 26px",
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
                style={{ height: 40 }}
                onClick={() => s.setStatus(id, submitted ? "todo" : "done")}
              >
                {submitted ? "Move back to to-do" : "Mark done"}
              </button>
              <a
                className="btn"
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ height: 40, textDecoration: "none" }}
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
              padding: "24px 26px",
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
              style={{ alignSelf: "flex-start", height: 40 }}
              onClick={() => s.openOverlay(id)}
            >
              <Icon path={ICON.external} size={14} />
              Open in Schoology
            </button>
          </div>
        ) : maybeOnline && review?.online ? (
          /* Confirmed online: there's nothing to write or attach, so the
             breakdown replaces the submission box instead of sitting above it. */
          <div
            style={{
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--line)",
              background: "var(--sunken)",
              padding: "24px 26px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <span className="section-label">Question breakdown</span>
            <QuestionReview url={a.url} preloaded={{ review, error: null }} />
          </div>
        ) : maybeOnline && review === undefined ? (
          /* Still checking — shown instead of the submission box, not before
             it, so a real online quiz never flashes a fake response field.
             The same sweeping bar `SubmitProgress` uses below: there's no
             percentage to report here either, just motion that keeps saying
             "still working" instead of sitting there looking frozen. */
          <div
            style={{
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--line)",
              background: "var(--sunken)",
              padding: "24px 26px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <span style={{ fontSize: 13, color: "var(--text-2)" }}>Checking…</span>
            <div className="progress" />
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
                  padding: "36px 20px",
                  textAlign: "center",
                  font: "inherit",
                  cursor: submitted ? "default" : "pointer",
                  transition: "background .15s, border-color .15s",
                  opacity: submitted ? 0.6 : 1,
                  pointerEvents: submitted ? "none" : "auto",
                }}
              >
                <span style={{ color: "var(--faint)" }}>
                  <Icon path={[ICON.upload, ICON.uploadTray]} size={28} />
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
                        padding: "10px 13px",
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
                  padding: "13px 15px",
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
                    style={{ flex: 1, height: 40 }}
                    disabled={busy}
                    onClick={() => void s.saveDraft(id)}
                  >
                    Save draft
                  </button>
                  <button
                    type="button"
                    className={`btn btn--primary ${busy ? "btn--busy" : ""}`}
                    style={{ flex: 1, height: 40 }}
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
                  style={{ height: 40, alignSelf: "flex-start" }}
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
                <div key={i} style={{ borderRadius: 14, background: "var(--sunken)", padding: "13px 15px" }}>
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
              style={{ height: 36, flexShrink: 0 }}
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
