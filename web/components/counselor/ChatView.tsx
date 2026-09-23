"use client";

import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import {
  filesFromDataTransfer,
  readAttachment,
  takePasteFiles,
  toTutorMessageParts,
  type Attachment,
} from "@/lib/attachments";
import { COUNSELOR_MODELS, isCounselorModel } from "@/lib/counselor/models";
import { useDictation } from "@/lib/dictation";
import { useCounselor } from "@/lib/counselor/store";
import { useCounselorModel, useCounselorThinking } from "@/lib/use-counselor-model";
import { useMode } from "@/lib/mode";
import {
  consumeMultitaskCommand,
  finishMultitaskTask,
  startMultitaskTask,
  titleFromPrompt,
  useMultitaskEnabled,
} from "@/lib/multitask";
import { buildSchoolContext, buildSchoolRecord } from "@/lib/counselor/school";
import { profileReady, uid } from "@/lib/counselor/state";
import type {
  ActivityStep,
  AskQuestion,
  ChatMessage,
  CounselorEvent,
  MeetingRef,
  Source,
} from "@/lib/counselor/types";
import { useStore } from "@/lib/store";
import { createEventParser, tidyReasoning } from "@/lib/tutor-stream";
import MathText from "../MathText";
import ModelPicker from "../ModelPicker";
import { MultitaskStrip, MultitaskToggle } from "../Multitask";
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

const ACCEPTED_FILE_TYPES =
  "image/*,.png,.jpg,.jpeg,.gif,.webp,.heic,.heif,.pdf,.txt,.md,.markdown,.csv,.json,.js,.jsx,.ts,.tsx,.py,.html,.css,.xml,.yml,.yaml";

export default function ChatView() {
  const c = useCounselor();
  const school = useStore();
  const { openSettings } = useMode();
  const [model, setModel] = useCounselorModel();
  const [effort, setEffort] = useCounselorThinking();

  const [draft, setDraft] = useState("");
  const [streamingReplyIds, setStreamingReplyIds] = useState<Set<string>>(() => new Set());
  const replyThreadRef = useRef(new Map<string, string>());
  const [error, setError] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(true);
  const [pending, setPending] = useState<Attachment[]>([]);
  const [reading, setReading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const multitask = useMultitaskEnabled();

  const liveRef = useRef(
    new Map<string, { controller: AbortController; threadId: string; taskId: string | null }>()
  );
  /** Latest messages per thread — Multitask needs this when two sends race a React render. */
  const threadMessagesRef = useRef(new Map<string, ChatMessage[]>());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const messages = c.thread?.messages ?? [];
  const ready = profileReady(c.profile);

  useEffect(() => {
    if (!c.threadId || !c.thread) return;
    threadMessagesRef.current.set(c.threadId, c.thread.messages);
  }, [c.threadId, c.thread]);

  const busyThreadIds = useMemo(() => {
    const ids = new Set<string>();
    for (const replyId of streamingReplyIds) {
      const threadId = replyThreadRef.current.get(replyId);
      if (threadId) ids.add(threadId);
    }
    return ids;
  }, [streamingReplyIds]);

  const activeBusy = c.threadId ? busyThreadIds.has(c.threadId) : false;
  /** Composer lock — Multitask keeps the input free while replies run. */
  const composerLocked = !multitask.enabled && activeBusy;

  const dictation = useDictation((text) => {
    setDraft((value) => `${value}${value.trim() ? " " : ""}${text}`);
  });

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("slates.counselorDrawer");
      if (saved != null) setRailOpen(saved !== "closed");
    } catch {}
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem("slates.counselorDrawer", railOpen ? "open" : "closed"); } catch {}
  }, [railOpen]);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.style.height = "auto";
    composer.style.height = `${Math.min(composer.scrollHeight, 180)}px`;
  }, [draft]);

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
    const threadId = c.threadId;
    if (!threadId) return;
    for (const [replyId, live] of liveRef.current) {
      if (live.threadId !== threadId) continue;
      live.controller.abort();
      if (live.taskId) finishMultitaskTask(live.taskId, "stopped");
      liveRef.current.delete(replyId);
    }
  }, [c.threadId]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    setReading(true);
    setError(null);
    try {
      const next = await Promise.all(Array.from(files).slice(0, 6).map(readAttachment));
      setPending((current) => [...current, ...next].slice(0, 6));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that file.");
    } finally {
      setReading(false);
    }
  }, []);

  const copyMessage = useCallback(async (message: ChatMessage) => {
    await navigator.clipboard.writeText(message.content);
    setCopiedId(message.id);
    window.setTimeout(() => setCopiedId((id) => id === message.id ? null : id), 1200);
  }, []);

  const editMessage = useCallback((message: ChatMessage) => {
    if (composerLocked || !c.threadId) return;
    setDraft(message.content);
    setPending(message.attachments ?? []);
    c.setMessages(c.threadId, (current) => current.slice(0, current.findIndex((item) => item.id === message.id)));
    composerRef.current?.focus();
  }, [composerLocked, c]);

  const send = useCallback(async (override?: string, attachmentsOverride?: Attachment[]) => {
    let text = (override ?? draft).trim();
    const attachments = attachmentsOverride ?? pending;
    if (!text && !attachments.length) return;

    const commanded = consumeMultitaskCommand(text, multitask.setEnabled);
    text = commanded.text;
    if (commanded.forced && !text && !attachments.length) {
      setDraft("");
      return;
    }

    const runInBackground = multitask.enabled || commanded.forced;
    if (!runInBackground && activeBusy) return;

    const threadId = c.threadId ?? c.startThread();
    if (!override) {
      setDraft("");
      setPending([]);
    }
    setError(null);
    pinned.current = true;

    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      content: text,
      ts: Date.now(),
      attachments: attachments.length ? attachments : undefined,
    };
    const activityId = uid();
    const replyId = uid();

    const prior = threadMessagesRef.current.get(threadId) ?? c.thread?.messages ?? [];
    // The history sent is the thread *before* the activity panel and the empty
    // reply are appended — neither is something the model said.
    const history = [...prior, userMsg]
      .filter((m) => m.kind !== "activity" && (m.content.trim() || m.attachments?.length))
      .map((m) => ({
        role: m.role,
        content: m.role === "user" ? toTutorMessageParts(m.content, m.attachments) : m.content,
      }));

    const seeded: ChatMessage[] = [
      ...prior,
      userMsg,
      { id: activityId, role: "assistant", content: "", ts: Date.now(), kind: "activity", steps: [] },
      { id: replyId, role: "assistant", content: "", ts: Date.now() },
    ];
    threadMessagesRef.current.set(threadId, seeded);
    c.setMessages(threadId, () => threadMessagesRef.current.get(threadId) ?? seeded);

    const controller = new AbortController();
    replyThreadRef.current.set(replyId, threadId);
    setStreamingReplyIds((prev) => new Set(prev).add(replyId));

    const taskId = runInBackground
      ? startMultitaskTask({
          title: titleFromPrompt(text, attachments.length ? "Attachment" : "Task"),
          surface: "counselor",
          chatId: threadId,
          replyId,
          controller,
        })
      : null;
    liveRef.current.set(replyId, { controller, threadId, taskId });

    const clearLive = (status: "done" | "error" | "stopped", err?: string) => {
      liveRef.current.delete(replyId);
      replyThreadRef.current.delete(replyId);
      setStreamingReplyIds((prev) => {
        if (!prev.has(replyId)) return prev;
        const next = new Set(prev);
        next.delete(replyId);
        return next;
      });
      if (taskId) finishMultitaskTask(taskId, status, err);
    };

    /** Mutating one message in place, without rewriting the whole thread. */
    const patchMessage = (id: string, fn: (m: ChatMessage) => ChatMessage) =>
      c.setMessages(threadId, (prev) => {
        const next = prev.map((m) => (m.id === id ? fn(m) : m));
        threadMessagesRef.current.set(threadId, next);
        return next;
      });

    const startedAt = new Map<string, number>();

    try {
      const res = await fetch("/api/counselor/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: history,
          state: {
            schemaVersion: 2,
            profile: c.profile,
            memories: c.memories,
            tasks: c.tasks,
            meetings: c.meetings,
            applications: c.applications,
            list: c.list,
            coursework: c.coursework,
            testing: c.testing,
            awards: c.awards,
            essays: c.essays,
            threads: [],
            masterPlan: c.masterPlan,
            planProposals: c.planProposals,
            planRevisions: [],
          },
          model,
          thinking: effort,
          schoolContext: buildSchoolContext(school) || undefined,
          school: buildSchoolRecord(school),
        }),
      });

      if (!res.ok || !res.body) throw new Error(`The counselor didn't answer (${res.status}).`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text0 = "";
      let meetings: MeetingRef[] = [];
      let sources: Source[] = [];
      let ask: AskQuestion[] | undefined;
      let reasoning = "";
      const parseEvents = createEventParser<CounselorEvent>();

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const event of parseEvents(decoder.decode(value, { stream: true }))) {
          switch (event.t) {
            case "delta":
              text0 += event.v;
              patchMessage(replyId, (m) => ({ ...m, content: text0 }));
              break;
            case "reasoning":
              reasoning += event.v;
              patchMessage(activityId, (message) => ({ ...message, reasoning: tidyReasoning(reasoning) }));
              break;
            case "tool":
              startedAt.set(event.id, Date.now());
              patchMessage(activityId, (m) => ({
                ...m,
                steps: [...(m.steps ?? []), { id: event.id, name: event.name, label: event.label, state: "run" }],
              }));
              break;
            case "tool_done": {
              const began = startedAt.get(event.id);
              const secs = began ? (Date.now() - began) / 1000 : undefined;
              patchMessage(activityId, (m) => ({
                ...m,
                steps: markDone(m.steps ?? [], event.id, event.ok, secs),
              }));
              break;
            }
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

      c.setMessages(threadId, (prev) => {
        const next = prev
          .map((m) => {
            if (m.id === activityId) return { ...m, done: true, steps: settle(m.steps ?? []) };
            if (m.id === replyId) return { ...m, content: text0, meetings, sources, ask };
            return m;
          })
          // A turn that produced no prose and no tools leaves two empty
          // bubbles behind; drop whichever of them has nothing in it.
          .filter((m) => {
            if (m.id === replyId) return Boolean(text0.trim() || meetings.length || ask?.length);
            if (m.id === activityId) return Boolean(m.steps?.length || m.reasoning);
            return true;
          });
        threadMessagesRef.current.set(threadId, next);
        return next;
      });
      clearLive("done");
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      if (!aborted) {
        const message = err instanceof Error ? err.message : "Something went wrong.";
        setError(message);
        clearLive("error", message);
      } else {
        clearLive("stopped");
      }
      c.setMessages(threadId, (prev) => {
        const next = prev
          .map((message) => message.id === activityId
            ? { ...message, done: true, steps: settle(message.steps ?? []) }
            : message)
          .filter((message) => {
            if (message.id === replyId) return Boolean(message.content.trim());
            if (message.id === activityId) return Boolean(message.steps?.length || message.reasoning);
            return true;
          });
        threadMessagesRef.current.set(threadId, next);
        return next;
      });
    } finally {
      if (liveRef.current.has(replyId)) clearLive("done");
    }
  }, [activeBusy, draft, pending, c, school, model, effort, multitask.enabled, multitask.setEnabled]);

  const retryMessage = useCallback((message: ChatMessage) => {
    if (composerLocked || !c.thread) return;
    const index = c.thread.messages.findIndex((item) => item.id === message.id);
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const previous = c.thread.messages[cursor];
      if (previous.role !== "user") continue;
      void send(previous.content, previous.attachments ?? []);
      return;
    }
  }, [composerLocked, c.thread, send]);

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
    <div className="gpt counselor-gpt" data-drawer={railOpen ? "open" : "closed"}>
      <ThreadRail open={railOpen} onToggle={() => setRailOpen((value) => !value)} busyThreadIds={busyThreadIds} />
      <button type="button" className="gpt-scrim" onClick={() => setRailOpen(false)} aria-label="Close conversations" />

      <div className="gpt-main">
        <header className="gpt-header">
          <button type="button" className="gpt-icon-btn" onClick={() => setRailOpen((value) => !value)} aria-label={railOpen ? "Hide conversations" : "Show conversations"}>
            <Icon path={ICON.sidebar} size={19} />
          </button>
          <ModelPicker
            value={model}
            onChange={(next) => { if (isCounselorModel(next)) setModel(next); }}
            thinking={effort}
            onThinkingChange={setEffort}
            placement="down"
            variant="bare"
            allowedModels={COUNSELOR_MODELS}
          />
          <MultitaskToggle />
          <span className="gpt-header-gap" />
          <button
            type="button"
            className="gpt-icon-btn"
            onClick={() => {
              c.startThread();
              setError(null);
              setDraft("");
              setPending([]);
            }}
            aria-label="New conversation"
            title="New conversation"
          >
            <Icon path={ICON.compose} size={19} />
          </button>
        </header>

        <div className="gpt-thread" ref={scrollRef} onScroll={onScroll}>
          <div className={`gpt-column${messages.length === 0 ? " gpt-column--empty" : ""}`}>
            {messages.length === 0 ? (
              <Welcome
                name={c.profile.name}
                ready={ready}
                onPick={(q) => setDraft(q)}
                onProfile={() => openSettings()}
              />
            ) : (
              messages.map((m, i) =>
                m.kind === "activity" ? (
                  <ActivityPanel key={m.id} steps={m.steps ?? []} reasoning={m.reasoning ?? ""} done={Boolean(m.done)} />
                ) : (
                  <Bubble
                    key={m.id}
                    message={m}
                    grouped={grouped(m, messages[i - 1])}
                    answerable={!composerLocked && m.id === lastAskId}
                    onAnswer={(answers) => void send(answers)}
                    copied={copiedId === m.id}
                    onCopy={() => void copyMessage(m)}
                    onEdit={() => editMessage(m)}
                    onRetry={() => retryMessage(m)}
                    busy={composerLocked}
                  />
                )
              )
            )}
            {error && <div className="counselor-error">{error}</div>}
          </div>
        </div>

        <div className="gpt-composer-dock">
          <MultitaskStrip
            surface="counselor"
            onOpen={(task) => {
              c.openThread(task.chatId);
              setError(null);
              pinned.current = true;
            }}
          />
          <form
            className="gpt-composer"
            onSubmit={(event) => {
              event.preventDefault();
              if (!composerLocked) void send();
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const files = filesFromDataTransfer(event.dataTransfer);
              if (files.length) void addFiles(files);
            }}
          >
            {pending.length > 0 && (
              <div className="gpt-composer-files">
                {pending.map((attachment) => (
                  <AttachmentChip
                    key={attachment.id}
                    attachment={attachment}
                    onRemove={() => setPending((current) => current.filter((item) => item.id !== attachment.id))}
                  />
                ))}
              </div>
            )}
            <textarea
              ref={composerRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (!composerLocked) void send();
                }
              }}
              onPaste={(event) => {
                takePasteFiles(event, (files) => void addFiles(files));
              }}
              rows={1}
              placeholder={
                !ready
                  ? "Complete your profile for personal advice"
                  : multitask.enabled
                    ? "Ask your counselor · Multitask on"
                    : "Ask your counselor"
              }
              aria-label="Ask your counselor"
              className="gpt-input"
            />
            <div className="gpt-composer-row">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPTED_FILE_TYPES}
                onChange={(event) => {
                  if (event.target.files?.length) void addFiles(event.target.files);
                  event.target.value = "";
                }}
                style={{ display: "none" }}
              />
              <button
                type="button"
                className="gpt-round-btn"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Add photos or files"
                disabled={reading || composerLocked}
              >
                <Icon path={ICON.plus} size={17} />
              </button>
              <span className="gpt-composer-gap" />
                            {dictation.available && (
                <button
                  type="button"
                  className={`gpt-round-btn${dictation.recording ? " is-live" : ""}`}
                  onClick={dictation.toggle}
                  disabled={dictation.transcribing}
                  aria-label={
                    dictation.transcribing
                      ? "Transcribing"
                      : dictation.recording
                        ? "Stop dictating"
                        : "Dictate"
                  }
                  aria-pressed={dictation.recording}
                  title={dictation.error ?? undefined}
                >
                  {dictation.transcribing ? (
                    <Spinner size={15} />
                  ) : (
                    <Icon path={dictation.recording ? ICON.waveform : ICON.mic} size={17} />
                  )}
                </button>
              )}
              <button
                type={composerLocked ? "button" : "submit"}
                className="gpt-send"
                onClick={composerLocked ? stop : undefined}
                disabled={!composerLocked && !draft.trim() && pending.length === 0}
                aria-label={composerLocked ? "Stop" : "Send"}
              >
                <Icon path={composerLocked ? ICON.stop : ICON.arrowUp} size={composerLocked ? 13 : 19} />
              </button>
            </div>
          </form>
          <p className="gpt-disclaimer">Slates can make mistakes. Check deadlines and policies that matter.</p>
        </div>
      </div>
    </div>
  );
}

function grouped(m: ChatMessage, prev: ChatMessage | undefined): boolean {
  if (!prev || prev.kind === "activity") return false;
  return prev.role === m.role && m.ts - prev.ts < 5 * 60_000;
}

/** Marks the exact tool call as finished, even when the same tool overlaps. */
function markDone(steps: ActivityStep[], id: string, ok: boolean, secs?: number): ActivityStep[] {
  let hit = false;
  return steps.map((s) => {
    if (hit || (s.id ?? s.label) !== id || s.state !== "run") return s;
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
  onAnswer,
  answerable,
  copied,
  onCopy,
  onEdit,
  onRetry,
  busy,
}: {
  message: ChatMessage;
  grouped: boolean;
  onAnswer: (text: string) => void;
  answerable: boolean;
  copied: boolean;
  onCopy: () => void;
  onEdit: () => void;
  onRetry: () => void;
  busy: boolean;
}) {
  const isUser = message.role === "user";
  return (
    <div className={`gpt-turn ${isUser ? "gpt-turn--user" : "gpt-turn--assistant"}${grouped ? " is-grouped" : ""}`}>
      {isUser ? (
        <>
          <div className="gpt-bubble">
            {message.attachments && message.attachments.length > 0 && (
              <div className="gpt-bubble-files">
                {message.attachments.map((attachment) => <AttachmentChip key={attachment.id} attachment={attachment} />)}
              </div>
            )}
            {message.content ? <MathText text={message.content} /> : null}
          </div>
          <div className="gpt-actions gpt-actions--user">
            <ActionButton label={copied ? "Copied" : "Copy"} icon={copied ? ICON.check : ICON.copy} onClick={onCopy} />
            <ActionButton label="Edit" icon={ICON.pencil} onClick={onEdit} disabled={busy} />
          </div>
        </>
      ) : (
        <>
          {message.content && (
            <div className="gpt-reply">
              <TutorMarkdown text={message.content} className="prose--chat" />
            </div>
          )}

          {message.meetings && message.meetings.length > 0 && (
            <div className="counselor-cards">
              {message.meetings.map((meeting) => (
                <span key={meeting.id} className="counselor-card-chip is-static">
                  <Icon path={ICON.calendar} size={13} />
                  <span className="truncate">{meeting.topic}</span>
                  <span className="counselor-chip-tag">
                    {meeting.action === "cancelled" ? "cancelled" : whenLabel(meeting.scheduledFor)}
                  </span>
                </span>
              ))}
            </div>
          )}

          {message.sources && message.sources.length > 0 && (
            <div className="counselor-sources">
              <span className="counselor-sources-label">Sources</span>
              {message.sources.map((source, index) => source.origin === "web" && source.url ? (
                <a key={index} className="counselor-source" href={source.url} target="_blank" rel="noopener noreferrer" title={source.url}>
                  {source.title}
                </a>
              ) : (
                <span key={index} className="counselor-source is-library" title="From the counseling library">{source.title}</span>
              ))}
            </div>
          )}

          {message.ask && message.ask.length > 0 && <AskForm questions={message.ask} open={answerable} onSubmit={onAnswer} />}

          {message.content && (
            <div className="gpt-actions">
              <ActionButton label={copied ? "Copied" : "Copy"} icon={copied ? ICON.check : ICON.copy} onClick={onCopy} />
              <ActionButton label="Try again" icon={ICON.retry} onClick={onRetry} disabled={busy} />
            </div>
          )}
        </>
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
function ActivityPanel({ steps, reasoning, done }: { steps: ActivityStep[]; reasoning: string; done: boolean }) {
  const [open, setOpen] = useState(false);
  const running = steps.find((step) => step.state === "run");
  const hasDetail = Boolean(reasoning || steps.length);
  if (!hasDetail && done) return null;
  const summary = done
    ? steps.length ? `Used ${steps.length} ${steps.length === 1 ? "tool" : "tools"}` : "Thought about it"
    : running?.label ?? (reasoning ? "Thinking" : "Working");

  return (
    <div className={`tutor-work${open && hasDetail ? " is-open" : ""}`}>
      <button type="button" className="tutor-work-head" onClick={() => setOpen((value) => !value)} disabled={!hasDetail}>
        {done ? <Icon path={ICON.check} size={12} /> : <Spinner size={12} />}
        <span className="tutor-work-summary">{summary}</span>
        {hasDetail && <Icon path={ICON.chevronDown} size={11} style={{ transform: open ? "rotate(180deg)" : "none" }} />}
      </button>
      {open && hasDetail && (
        <div className="tutor-work-body">
          {steps.map((step) => (
            <div key={step.id ?? `${step.label}-${step.secs}`} className={`tutor-step is-${step.state}`}>
              <span className="tutor-step-dot" />
              <span className="truncate" style={{ flex: 1 }}>{step.label}</span>
              {step.secs != null && step.secs >= 0.5 && <span className="tutor-step-secs">{step.secs.toFixed(1)}s</span>}
            </div>
          ))}
          {reasoning && (
            <div className="tutor-reasoning">
              <span className="section-label" style={{ fontSize: 10 }}>Reasoning</span>
              <p>{reasoning}</p>
            </div>
          )}
        </div>
      )}
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
      className="gpt-greeting counselor-greeting"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      <h1>{name ? `What should we solve, ${name.split(" ")[0]}?` : "What should we solve?"}</h1>
      <p>
        Your profile, list, applications, essays, and plan stay connected across every conversation.
      </p>

      {!ready ? (
        <button type="button" className="btn btn--primary" onClick={onProfile}>
          Fill in your profile
        </button>
      ) : (
        <div className="gpt-starters">
          {OPENERS.map((q) => (
            <button key={q} type="button" className="gpt-starter" onClick={() => onPick(q)}>
              {q}
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}

/** Past conversations, and the button that starts a new one. */
function ThreadRail({ open, onToggle, busyThreadIds }: { open: boolean; onToggle: () => void; busyThreadIds: ReadonlySet<string> }) {
  const c = useCounselor();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = [...c.threads]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((thread) => !needle || thread.title.toLowerCase().includes(needle) || thread.messages.some((message) => message.content.toLowerCase().includes(needle)));
  const groups: { label: string; items: typeof matches }[] = [];
  for (const thread of matches) {
    const label = chatBand(thread.updatedAt);
    const current = groups[groups.length - 1];
    if (current?.label === label) current.items.push(thread);
    else groups.push({ label, items: [thread] });
  }

  const commitRename = () => {
    if (editing) c.renameThread(editing, nameDraft);
    setEditing(null);
  };

  return (
    <aside className="gpt-drawer" aria-label="Conversations" aria-hidden={!open}>
      <div className="gpt-drawer-head">
        <button type="button" className="gpt-icon-btn" onClick={onToggle} aria-label="Hide conversations">
          <Icon path={ICON.sidebar} size={19} />
        </button>
        <span className="gpt-header-gap" />
        <button type="button" className="gpt-icon-btn" onClick={() => c.startThread()} aria-label="New conversation">
          <Icon path={ICON.compose} size={19} />
        </button>
      </div>
      <div className="gpt-search">
        <Icon path={ICON.magnifier} size={15} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations" aria-label="Search conversations" className="bare-field" />
      </div>
      <button type="button" className="gpt-drawer-new" onClick={() => c.startThread()}>
        <span className="gpt-drawer-new-icon"><Icon path={ICON.compose} size={15} /></span>
        New conversation
      </button>
      <div className="gpt-drawer-list">
        {!c.threads.length && <p className="gpt-drawer-empty">Nothing yet. Your conversations stay on this device.</p>}
        {c.threads.length > 0 && !matches.length && <p className="gpt-drawer-empty">No conversation matches “{query.trim()}”.</p>}
        {groups.map((group) => (
          <div key={group.label} className="gpt-drawer-group">
            <div className="gpt-drawer-band">{group.label}</div>
            {group.items.map((thread) => editing === thread.id ? (
              <input
                key={thread.id}
                autoFocus
                className="gpt-drawer-rename"
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                onBlur={commitRename}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitRename();
                  if (event.key === "Escape") setEditing(null);
                }}
                aria-label="Rename conversation"
              />
            ) : (
              <div key={thread.id} className="gpt-drawer-row" data-active={thread.id === c.threadId ? "1" : undefined}>
                <button
                  type="button"
                  className="gpt-drawer-open"
                  onClick={() => c.openThread(thread.id)}
                  onDoubleClick={() => { setEditing(thread.id); setNameDraft(thread.title); }}
                  title={thread.title}
                >
                  <span className="truncate">{thread.title}</span>
                  <span className="gpt-drawer-when">{busyThreadIds.has(thread.id) ? "replying..." : chatWhenLabel(thread.updatedAt)}</span>
                </button>
                <button type="button" className="gpt-drawer-delete" onClick={() => c.deleteThread(thread.id)} aria-label={`Delete ${thread.title}`}>
                  <Icon path={ICON.trash} size={14} />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}

function chatWhenLabel(at: number): string {
  const date = new Date(at);
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (days < 7) return date.toLocaleDateString([], { weekday: "long" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function chatBand(at: number): string {
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days <= 7) return "Previous 7 days";
  if (days <= 30) return "Previous 30 days";
  return "Older";
}

function ActionButton({ label, icon, onClick, disabled }: { label: string; icon: string | string[]; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="gpt-action" onClick={onClick} aria-label={label} title={label} disabled={disabled}>
      <Icon path={icon} size={15} />
    </button>
  );
}

function AttachmentChip({ attachment, onRemove }: { attachment: Attachment; onRemove?: () => void }) {
  const thumbnail = attachment.kind === "image" && Boolean(attachment.dataUrl);
  return (
    <div className={`gpt-attachment${thumbnail ? " is-image" : ""}`} title={attachment.name}>
      {thumbnail && attachment.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={attachment.dataUrl} alt={attachment.name} />
      ) : (
        <><Icon path={ICON.file} size={13} /><span className="truncate">{attachment.name}</span></>
      )}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${attachment.name}`}><Icon path={ICON.close} size={9} /></button>
      )}
    </div>
  );
}

