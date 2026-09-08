"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useCounselor } from "@/lib/counselor/store";
import { buildSchoolContext, buildSchoolRecord } from "@/lib/counselor/school";
import { profileReady, uid } from "@/lib/counselor/state";
import type {
  ActivityStep,
  AskQuestion,
  ChatMessage,
  CounselorEvent,
  DocRef,
  MeetingRef,
  Source,
} from "@/lib/counselor/types";
import { useStore } from "@/lib/store";
import TutorMarkdown from "../TutorMarkdown";
import { Icon, ICON, Spinner } from "../ui";

/**
 * The conversation.
 *
 * A turn here is rarely just text: the counselor reads its own memory, ranks
 * schools, writes a document, books a check-in. So while it works, the reply
 * bubble is replaced by a panel listing what it is actually doing, one line
 * per tool, each timed. That panel is reporting, not decoration — if it stops
 * moving, the turn has genuinely stalled.
 *
 * When the work is done the panel collapses to a single summary line, so a
 * scrolled-back conversation reads as prose rather than as a machine log.
 */

const OPENERS = [
  "Where do I actually stand right now?",
  "Build me a balanced college list.",
  "Is my SAT good enough, or should I retake it?",
  "What should I be doing this month?",
];

export default function ChatView() {
  const c = useCounselor();
  const school = useStore();

  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(true);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const messages = c.thread?.messages ?? [];
  const ready = profileReady(c.profile);

  // Follow the stream, but only while the student is already at the bottom —
  // yanking them back down mid-scroll is worse than a reply they have to
  // scroll to.
  const pinned = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !pinned.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  }, []);

  const send = useCallback(async (override?: string) => {
    const text = (override ?? draft).trim();
    if (!text || busy) return;

    const threadId = c.threadId ?? c.startThread();
    if (!override) setDraft("");
    setError(null);
    pinned.current = true;

    const userMsg: ChatMessage = { id: uid(), role: "user", content: text, ts: Date.now() };
    const activityId = uid();
    const replyId = uid();

    // The history sent is the thread *before* the activity panel and the empty
    // reply are appended — neither is something the model said.
    const history = [...(c.thread?.messages ?? []), userMsg]
      .filter((m) => m.kind !== "activity" && m.content.trim())
      .map((m) => ({ role: m.role, content: m.content }));

    c.setMessages(threadId, (prev) => [
      ...prev,
      userMsg,
      { id: activityId, role: "assistant", content: "", ts: Date.now(), kind: "activity", steps: [] },
      { id: replyId, role: "assistant", content: "", ts: Date.now() },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);

    /** Mutating one message in place, without rewriting the whole thread. */
    const patchMessage = (id: string, fn: (m: ChatMessage) => ChatMessage) =>
      c.setMessages(threadId, (prev) => prev.map((m) => (m.id === id ? fn(m) : m)));

    const startedAt = new Map<string, number>();

    try {
      const res = await fetch("/api/counselor/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: history,
          state: {
            profile: c.profile,
            memories: c.memories,
            tasks: c.tasks,
            documents: c.documents,
            meetings: c.meetings,
            applications: c.applications,
            list: c.list,
            threads: [],
          },
          schoolContext: buildSchoolContext(school) || undefined,
          school: buildSchoolRecord(school),
        }),
      });

      if (!res.ok || !res.body) throw new Error(`The counselor didn't answer (${res.status}).`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text0 = "";
      let docs: DocRef[] = [];
      let meetings: MeetingRef[] = [];
      let sources: Source[] = [];
      let ask: AskQuestion[] | undefined;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // NDJSON: a chunk can end mid-line, so the tail is held back.
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          let event: CounselorEvent;
          try {
            event = JSON.parse(line) as CounselorEvent;
          } catch {
            continue;
          }

          switch (event.t) {
            case "delta":
              text0 += event.v;
              patchMessage(replyId, (m) => ({ ...m, content: text0 }));
              break;
            case "tool":
              startedAt.set(event.label, Date.now());
              patchMessage(activityId, (m) => ({
                ...m,
                steps: [...(m.steps ?? []), { label: event.label, state: "run" }],
              }));
              break;
            case "tool_done": {
              const began = startedAt.get(event.label);
              const secs = began ? (Date.now() - began) / 1000 : undefined;
              patchMessage(activityId, (m) => ({
                ...m,
                steps: markDone(m.steps ?? [], event.label, event.ok, secs),
              }));
              break;
            }
            case "documents":
              docs = event.v;
              break;
            case "meetings":
              meetings = event.v;
              break;
            case "sources":
              sources = event.v;
              break;
            case "ask":
              ask = event.v;
              break;
            case "state":
              c.merge(event.v);
              break;
            case "error":
              setError(event.v);
              break;
            case "done":
              break;
          }
        }
      }

      c.setMessages(threadId, (prev) =>
        prev
          .map((m) => {
            if (m.id === activityId) return { ...m, done: true, steps: settle(m.steps ?? []) };
            if (m.id === replyId) return { ...m, content: text0, documents: docs, meetings, sources, ask };
            return m;
          })
          // A turn that produced no prose and no tools leaves two empty
          // bubbles behind; drop whichever of them has nothing in it.
          .filter((m) => {
            if (m.id === replyId) return Boolean(text0.trim() || docs.length || meetings.length || ask?.length);
            if (m.id === activityId) return Boolean(m.steps?.length);
            return true;
          })
      );
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      if (!aborted) setError(err instanceof Error ? err.message : "Something went wrong.");
      c.setMessages(threadId, (prev) =>
        prev.filter((m) => {
          if (m.id === replyId) return Boolean(m.content.trim());
          if (m.id === activityId) return Boolean(m.steps?.length);
          return true;
        })
      );
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }, [draft, busy, c, school]);

  // Only the most recent question set is still live. Leaving every past one
  // clickable would let a student answer a question the counselor asked four
  // turns ago, out of the context that made it make sense.
  const lastAskId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].ask?.length) return messages[i].id;
    }
    return null;
  }, [messages]);

  return (
    <div className="counselor-chat">
      <ThreadRail open={railOpen} onToggle={() => setRailOpen((v) => !v)} busy={busy} />

      <div className="counselor-chat-main">
        <div className="counselor-scroll" ref={scrollRef} onScroll={onScroll}>
          <div className="counselor-thread">
            {messages.length === 0 ? (
              <Welcome
                name={c.profile.name}
                ready={ready}
                onPick={(q) => setDraft(q)}
                onProfile={() => c.setView("profile")}
              />
            ) : (
              messages.map((m, i) =>
                m.kind === "activity" ? (
                  <ActivityPanel key={m.id} steps={m.steps ?? []} done={Boolean(m.done)} />
                ) : (
                  <Bubble
                    key={m.id}
                    message={m}
                    grouped={grouped(m, messages[i - 1])}
                    onOpenDoc={(id) => {
                      c.openDoc(id);
                      c.setView("documents");
                    }}
                    answerable={!busy && m.id === lastAskId}
                    onAnswer={(answers) => void send(answers)}
                  />
                )
              )
            )}
            {error && <div className="counselor-error">{error}</div>}
          </div>
        </div>

        <div className="counselor-composer">
          <div className="counselor-composer-shell">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={1}
              placeholder={ready ? "Ask your counselor" : "Fill in your profile first — it's how the advice gets personal"}
              aria-label="Ask your counselor"
              className="bare-field bare-field--chat"
            />
            <div className="counselor-composer-row">
              <span className="counselor-hint">
                Remembers you between conversations · Edits your plan, list, and documents
              </span>
              <button
                type="button"
                className="counselor-send"
                onClick={() => (busy ? stop() : void send())}
                disabled={!busy && !draft.trim()}
                aria-label={busy ? "Stop" : "Send"}
              >
                <Icon path={busy ? ICON.stop : ICON.send} size={15} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function grouped(m: ChatMessage, prev: ChatMessage | undefined): boolean {
  if (!prev || prev.kind === "activity") return false;
  return prev.role === m.role && m.ts - prev.ts < 5 * 60_000;
}

/** Marks the first still-running step with this label as finished. */
function markDone(steps: ActivityStep[], label: string, ok: boolean, secs?: number): ActivityStep[] {
  let hit = false;
  return steps.map((s) => {
    if (hit || s.label !== label || s.state !== "run") return s;
    hit = true;
    return { ...s, state: ok ? "ok" : "fail", secs };
  });
}

/** Anything still spinning when the stream ends did finish — the model moved on. */
function settle(steps: ActivityStep[]): ActivityStep[] {
  return steps.map((s) => (s.state === "run" ? { ...s, state: "ok" } : s));
}

function Bubble({
  message,
  grouped,
  onOpenDoc,
  onAnswer,
  answerable,
}: {
  message: ChatMessage;
  grouped: boolean;
  onOpenDoc: (id: string) => void;
  onAnswer: (text: string) => void;
  /** Only the newest ask is still open; older ones read as answered. */
  answerable: boolean;
}) {
  const isUser = message.role === "user";
  return (
    <div className={`counselor-row${isUser ? " is-user" : ""}${grouped ? " is-grouped" : ""}`}>
      {!isUser && !grouped && <span className="counselor-who">Counselor</span>}
      <div className={`counselor-bubble${isUser ? " is-user" : ""}`}>
        {isUser ? message.content : <TutorMarkdown text={message.content} className="prose--chat" />}
      </div>

      {message.documents && message.documents.length > 0 && (
        <div className="counselor-cards">
          {message.documents.map((d) => (
            <button key={d.id} type="button" className="counselor-card-chip" onClick={() => onOpenDoc(d.id)}>
              <Icon path={ICON.file} size={13} />
              <span className="truncate">{d.title}</span>
              <span className="counselor-chip-tag">{d.action}</span>
            </button>
          ))}
        </div>
      )}

      {message.meetings && message.meetings.length > 0 && (
        <div className="counselor-cards">
          {message.meetings.map((m) => (
            <span key={m.id} className="counselor-card-chip is-static">
              <Icon path={ICON.calendar} size={13} />
              <span className="truncate">{m.topic}</span>
              <span className="counselor-chip-tag">
                {m.action === "cancelled" ? "cancelled" : whenLabel(m.scheduledFor)}
              </span>
            </span>
          ))}
        </div>
      )}

      {message.sources && message.sources.length > 0 && (
        <div className="counselor-sources">
          <span className="counselor-sources-label">Sources</span>
          {message.sources.map((source, i) =>
            source.origin === "web" && source.url ? (
              <a
                key={i}
                className="counselor-source"
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                title={source.url}
              >
                {source.title}
              </a>
            ) : (
              <span key={i} className="counselor-source is-library" title="From the counseling library">
                {source.title}
              </span>
            )
          )}
        </div>
      )}

      {message.ask && message.ask.length > 0 && (
        <AskForm questions={message.ask} open={answerable} onSubmit={onAnswer} />
      )}
    </div>
  );
}

/**
 * The counselor's structured question set.
 *
 * A counselor that needs four facts before it can advise shouldn't bury them
 * in a paragraph and hope. The answers go back as an ordinary message, so the
 * thread stays readable afterwards rather than holding a widget nobody can
 * re-read.
 */
function AskForm({
  questions,
  open,
  onSubmit,
}: {
  questions: AskQuestion[];
  open: boolean;
  onSubmit: (text: string) => void;
}) {
  const [answers, setAnswers] = useState<string[][]>(() => questions.map(() => []));
  const [text, setText] = useState<string[]>(() => questions.map(() => ""));

  const pick = (q: number, option: string) => {
    setAnswers((prev) =>
      prev.map((row, i) => {
        if (i !== q) return row;
        if (!questions[q].multi) return [option];
        return row.includes(option) ? row.filter((o) => o !== option) : [...row, option];
      })
    );
  };

  const answered = questions.map((q, i) => (q.options.length ? answers[i] : [text[i].trim()]).filter(Boolean));
  const ready = answered.every((a) => a.length > 0);

  return (
    <div className={`counselor-ask${open ? "" : " is-closed"}`}>
      {questions.map((q, i) => (
        <div key={i} className="counselor-ask-row">
          <p className="counselor-ask-q">{q.question}</p>
          {q.options.length ? (
            <div className="counselor-chips">
              {q.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`counselor-chip${answers[i].includes(option) ? " is-on" : ""}`}
                  onClick={() => pick(i, option)}
                  disabled={!open}
                >
                  {option}
                </button>
              ))}
            </div>
          ) : (
            <input
              className="counselor-input"
              value={text[i]}
              onChange={(e) => setText((prev) => prev.map((v, k) => (k === i ? e.target.value : v)))}
              placeholder="Your answer"
              disabled={!open}
            />
          )}
        </div>
      ))}

      {open && (
        <button
          type="button"
          className="btn btn--primary"
          disabled={!ready}
          onClick={() =>
            onSubmit(questions.map((q, i) => `${q.question} — ${answered[i].join(", ")}`).join("\n"))
          }
        >
          Send answers
        </button>
      )}
    </div>
  );
}

function whenLabel(iso: string): string {
  return new Date(iso).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * What the counselor is doing right now.
 *
 * Open while it works — one line per tool, ticking over — then collapsed to a
 * single line afterwards, expandable if you want to see what it touched.
 */
function ActivityPanel({ steps, done }: { steps: ActivityStep[]; done: boolean }) {
  const [open, setOpen] = useState(false);
  const shown = done && !open;

  const summary = useMemo(() => {
    const failed = steps.filter((s) => s.state === "fail").length;
    const n = steps.length;
    return failed
      ? `${n} step${n === 1 ? "" : "s"}, ${failed} failed`
      : `${n} step${n === 1 ? "" : "s"}`;
  }, [steps]);

  if (!steps.length && done) return null;

  if (shown) {
    return (
      <button type="button" className="counselor-activity is-collapsed" onClick={() => setOpen(true)}>
        <Icon path={ICON.check} size={12} />
        <span>Worked through {summary}</span>
        <Icon path={ICON.chevronDown} size={12} />
      </button>
    );
  }

  return (
    <div className="counselor-activity">
      <div className="counselor-activity-head">
        {done ? <Icon path={ICON.check} size={12} /> : <Spinner size={12} />}
        <span>{done ? "What I did" : "Working"}</span>
        {done && (
          <button type="button" className="counselor-activity-hide" onClick={() => setOpen(false)}>
            Hide
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {steps.map((s, i) => (
          <motion.div
            key={`${s.label}-${i}`}
            className={`counselor-step is-${s.state}`}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
          >
            <span className="counselor-step-dot" />
            <span className="truncate" style={{ flex: 1 }}>
              {s.label}
            </span>
            {s.secs != null && <span className="counselor-step-secs">{s.secs.toFixed(1)}s</span>}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function Welcome({
  name,
  ready,
  onPick,
  onProfile,
}: {
  name: string;
  ready: boolean;
  onPick: (q: string) => void;
  onProfile: () => void;
}) {
  return (
    <motion.div
      className="counselor-welcome"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      <h2>{name ? `Hey ${name.split(" ")[0]}.` : "Let's get you in somewhere good."}</h2>
      <p>
        I keep your profile, your list, your applications, and everything I learn about you — so
        we pick up where we left off instead of starting over.
      </p>

      {!ready ? (
        <button type="button" className="btn btn--primary" onClick={onProfile}>
          Fill in your profile
        </button>
      ) : (
        <div className="counselor-openers">
          {OPENERS.map((q) => (
            <button key={q} type="button" className="counselor-opener" onClick={() => onPick(q)}>
              {q}
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}

/** Past conversations, and the button that starts a new one. */
function ThreadRail({ open, onToggle, busy }: { open: boolean; onToggle: () => void; busy: boolean }) {
  const c = useCounselor();

  if (!open) {
    return (
      <div className="counselor-threads is-closed">
        <button type="button" className="icon-btn" onClick={onToggle} aria-label="Show conversations" style={{ width: 28, height: 28 }}>
          <Icon path={ICON.sidebar} size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="counselor-threads">
      <div className="counselor-threads-head">
        <span className="section-label" style={{ flex: 1 }}>
          Conversations
        </span>
        <button type="button" className="icon-btn" onClick={() => c.startThread()} aria-label="New conversation" style={{ width: 26, height: 26 }}>
          <Icon path={ICON.plus} size={13} />
        </button>
        <button type="button" className="icon-btn" onClick={onToggle} aria-label="Hide conversations" style={{ width: 26, height: 26 }}>
          <Icon path={ICON.sidebar} size={13} />
        </button>
      </div>

      <div className="counselor-threads-list">
        {c.threads.length === 0 && <p className="counselor-threads-empty">Nothing yet.</p>}
        {c.threads.map((t) => (
          <div key={t.id} className={`counselor-thread-row${t.id === c.threadId ? " is-active" : ""}`}>
            <button type="button" className="counselor-thread-open" onClick={() => c.openThread(t.id)}>
              <span className="truncate">{t.title}</span>
              {busy && t.id === c.threadId && <Spinner size={11} />}
            </button>
            <button
              type="button"
              className="counselor-thread-del"
              onClick={() => c.deleteThread(t.id)}
              aria-label={`Delete ${t.title}`}
            >
              <Icon path={ICON.trash} size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
