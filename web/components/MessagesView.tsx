"use client";

import { useEffect, useState } from "react";

import { useStore, type SubmitState } from "@/lib/store";
import type { Recipient } from "@/lib/types";
import { Badge, Dot, Spinner } from "./ui";

/**
 * Replying drives Schoology's own message form in a real browser, which takes
 * a few seconds — long enough that the stages are worth naming rather than
 * spinning over. Same treatment as handing an assignment in.
 */
function ReplyProgress({ state }: { state: SubmitState }) {
  const working = state.phase === "submitting" || state.phase === "verifying";
  if (state.phase === "idle") return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 12.5,
          // Compose has no separate "Sent" chip the way the reply box does, so
          // the outcome has to read as one here rather than as another step.
          color:
            state.phase === "error"
              ? "var(--bad)"
              : state.phase === "done"
                ? "var(--good)"
                : "var(--text-2)",
        }}
      >
        {working && <Spinner />}
        <span>{working ? state.step : state.message}</span>
      </div>
      {working && <div className="progress" />}
    </div>
  );
}

export default function MessagesView() {
  const s = useStore();
  const active = s.snapshot.messages.find((m) => m.id === s.msgOpen);
  const activeCourse = active ? s.courseById(active.courseId) : null;

  return (
    <div className="messages-view" style={{ flex: 1, minHeight: 0, display: "flex", padding: "0 24px 24px" }}>
      <div className={`messages-layout ${active || s.composing ? "messages-layout--detail" : ""}`} style={{ width: "100%", display: "flex", minHeight: 0 }}>
        <div
          className="messages-list"
          style={{
            width: 380,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            borderRight: "1px solid var(--line)",
          }}
        >
          <div style={{ flexShrink: 0, padding: "0 16px 12px" }}>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => s.openCompose(true)}
              style={{ width: "100%" }}
            >
              New message
            </button>
          </div>

          <div style={{ overflowY: "auto", minHeight: 0 }}>
          {s.snapshot.messages.map((m) => {
            const c = s.courseById(m.courseId);
            const unread = m.unread && !s.msgRead[m.id];
            const isOpen = s.msgOpen === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  s.openCompose(false);
                  s.openMessage(m.id);
                }}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  width: "100%",
                  border: 0,
                  borderBottom: "1px solid var(--line)",
                  background: isOpen ? "var(--hover)" : "transparent",
                  padding: "14px 16px",
                  font: "inherit",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span style={{ marginTop: 4 }}>
                  <Dot color={unread ? "oklch(0.72 0.16 250)" : "transparent"} radius={9999} />
                </span>
                <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3 }}>
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%" }}>
                    <span style={{ fontSize: 13, fontWeight: unread ? 600 : 500, color: "var(--text)" }}>{m.from}</span>
                    <span style={{ flexShrink: 0, fontSize: 11, color: "var(--muted)" }}>{m.time}</span>
                  </span>
                  <span
                    className="truncate"
                    style={{
                      width: "100%",
                      fontSize: 13,
                      fontWeight: unread ? 600 : 400,
                      color: unread ? "var(--text)" : "var(--text-2)",
                    }}
                  >
                    {m.subject}
                  </span>
                  {c && <Badge tone={c.tone}>{c.short}</Badge>}
                </span>
              </button>
            );
          })}
          </div>
        </div>

        <div className="messages-detail" style={{ flex: 1, minWidth: 0, overflowY: "auto", minHeight: 0, padding: "22px 26px" }}>
          {(active || s.composing) && (
            <button
              type="button"
              className="btn btn--quiet messages-back"
              onClick={() => {
                s.openCompose(false);
                s.openMessage(null);
              }}
            >
              Back to inbox
            </button>
          )}
          {s.composing && <ComposePanel />}
          {!s.composing && !active && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 13, color: "var(--muted)" }}>
              Select a message to read it
            </div>
          )}
          {!s.composing && active && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {activeCourse && <Badge tone={activeCourse.tone}>{activeCourse.short}</Badge>}
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{active.time}</span>
              </div>
              <div style={{ marginTop: 10, fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--text)" }}>
                {active.subject}
              </div>
              <div style={{ marginTop: 4, fontSize: 13, color: "var(--muted)" }}>{active.from}</div>
              <p
                style={{
                  margin: "18px 0 0",
                  fontSize: 14,
                  lineHeight: 1.6,
                  color: "var(--text-2)",
                  maxWidth: "80ch",
                  whiteSpace: "pre-wrap",
                }}
              >
                {active.body}
              </p>

              <ReplyBox key={active.id} threadId={active.id} to={active.from} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Reply to a teacher without leaving Slates.
 *
 * Deliberately two steps: writing and sending are separate presses, and the
 * confirm names who it goes to. A message to a teacher can't be unsent, and
 * the rest of this app treats "reaches a real person" as the line worth
 * pausing at — the same reason handing work in asks twice.
 */
function ReplyBox({ threadId, to }: { threadId: string; to: string }) {
  const s = useStore();
  const draft = s.replyDrafts[threadId] ?? "";
  const state = s.replyState[threadId] ?? { phase: "idle" as const };
  const [confirming, setConfirming] = useState(false);

  const busy = state.phase === "submitting" || state.phase === "verifying";
  const ready = draft.trim().length > 0;

  return (
    <div style={{ maxWidth: "80ch", marginTop: 26, borderTop: "1px solid var(--line)", paddingTop: 18 }}>
      <div className="section-label" style={{ marginBottom: 8 }}>
        Reply
      </div>

      <textarea
        className="textarea"
        rows={4}
        value={draft}
        disabled={busy}
        onChange={(e) => {
          s.setReplyDraft(threadId, e.target.value);
          setConfirming(false);
        }}
        placeholder={`Write back to ${to}`}
        aria-label={`Reply to ${to}`}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
        {!confirming ? (
          <button
            type="button"
            className="btn"
            disabled={!ready || busy}
            onClick={() => setConfirming(true)}
            style={{ opacity: ready && !busy ? 1 : 0.5 }}
          >
            {busy ? "Sending…" : "Reply"}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                setConfirming(false);
                void s.sendReply(threadId);
              }}
            >
              Send to {to}
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        )}
        <span style={{ flex: 1 }} />
        {state.phase === "done" && (
          <span style={{ fontSize: 12, color: "var(--good)" }}>Sent</span>
        )}
      </div>

      <div style={{ marginTop: 10 }}>
        <ReplyProgress state={state} />
      </div>
    </div>
  );
}

/**
 * Start a conversation with someone new.
 *
 * The recipient list is Schoology's own directory, searched as you type — the
 * uid that comes back is what gets sent, so Slates never guesses at who a
 * name belongs to. Two people with one surname stay two different people.
 */
function ComposePanel() {
  const s = useStore();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Recipient[]>([]);
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const state = s.composeState;
  const busy = state.phase === "submitting" || state.phase === "verifying";
  const ready = s.composeTo.length > 0 && s.composeSubject.trim() && s.composeBody.trim();

  /* Search on a pause in typing, not on every keystroke — each one is a round
     trip through the scraper to Schoology. Results for a query too short to
     search are dropped at render rather than cleared here, so this effect
     never has to touch state on its way in. */
  const shown = query.trim().length >= 2 ? hits : [];

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let live = true;
    const t = window.setTimeout(async () => {
      setLooking(true);
      setLookupError(null);
      try {
        const people = await s.findRecipients(q);
        if (live) setHits(people);
      } catch (e) {
        if (live) setLookupError(e instanceof Error ? e.message : "Directory lookup failed.");
      } finally {
        if (live) setLooking(false);
      }
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
    // findRecipients is stable; re-running on every store change would refetch
    // the same query each time anything else in the app moved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div style={{ maxWidth: "80ch" }}>
      <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--text)" }}>
        New message
      </div>

      <div className="section-label" style={{ margin: "18px 0 8px" }}>
        To
      </div>
      {s.composeTo.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {s.composeTo.map((p) => (
            <span
              key={p.uid}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                borderRadius: 9999,
                border: "1px solid var(--line)",
                background: "var(--sunken)",
                padding: "4px 6px 4px 10px",
                fontSize: 12.5,
                color: "var(--text)",
              }}
            >
              {p.name}
              <button
                type="button"
                onClick={() => s.removeRecipient(p.uid)}
                aria-label={`Remove ${p.name}`}
                disabled={busy}
                style={{
                  border: 0,
                  background: "transparent",
                  color: "var(--muted)",
                  cursor: "pointer",
                  font: "inherit",
                  lineHeight: 1,
                  padding: "0 2px",
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        className="input"
        value={query}
        disabled={busy}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search for a teacher or classmate"
        aria-label="Search for someone to message"
      />

      {lookupError && (
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--bad)" }}>{lookupError}</p>
      )}
      {!lookupError && query.trim().length >= 2 && (
        <div
          style={{
            marginTop: 8,
            borderRadius: 12,
            border: "1px solid var(--line)",
            background: "var(--surface)",
            overflow: "hidden",
          }}
        >
          {looking && !shown.length && (
            <p style={{ margin: 0, padding: "10px 12px", fontSize: 12.5, color: "var(--muted)" }}>
              Searching Schoology…
            </p>
          )}
          {!looking && !shown.length && (
            <p style={{ margin: 0, padding: "10px 12px", fontSize: 12.5, color: "var(--muted)" }}>
              No one matches “{query.trim()}”.
            </p>
          )}
          {shown.map((p) => (
            <button
              key={p.uid}
              type="button"
              className="palette-row"
              onClick={() => {
                s.addRecipient(p);
                setQuery("");
                setHits([]);
              }}
              style={{ borderRadius: 0, background: "transparent" }}
            >
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: "block", fontSize: 13.5, color: "var(--text)" }}>{p.name}</span>
                {p.school && (
                  <span style={{ display: "block", marginTop: 2, fontSize: 12, color: "var(--muted)" }}>
                    {p.school}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="section-label" style={{ margin: "18px 0 8px" }}>
        Subject
      </div>
      <input
        className="input"
        value={s.composeSubject}
        disabled={busy}
        onChange={(e) => {
          s.setComposeSubject(e.target.value);
          setConfirming(false);
        }}
        placeholder="What's this about?"
        aria-label="Subject"
      />

      <div className="section-label" style={{ margin: "18px 0 8px" }}>
        Message
      </div>
      <textarea
        className="textarea"
        rows={6}
        value={s.composeBody}
        disabled={busy}
        onChange={(e) => {
          s.setComposeBody(e.target.value);
          setConfirming(false);
        }}
        placeholder="Write your message"
        aria-label="Message"
      />

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
        {!confirming ? (
          <button
            type="button"
            className="btn"
            disabled={!ready || busy}
            onClick={() => setConfirming(true)}
            style={{ opacity: ready && !busy ? 1 : 0.5 }}
          >
            {busy ? "Sending…" : "Send"}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                setConfirming(false);
                void s.sendNewMessage();
              }}
            >
              Send to {s.composeTo.map((p) => p.name).join(", ")}
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        )}
      </div>

      <div style={{ marginTop: 12 }}>
        <ReplyProgress state={state} />
      </div>
    </div>
  );
}
