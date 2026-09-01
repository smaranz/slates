"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";

import { readAttachment, toTutorMessageParts, type Attachment } from "@/lib/attachments";
import { useStore } from "@/lib/store";
import { describeTutorAction, parseTutorActions, stripTutorActions } from "@/lib/tutor-actions";
import {
  useTutorChats,
  useTutorRail,
  type TutorChat,
  type TutorChatMessage,
} from "@/lib/tutor-chats";
import { buildTutorContext } from "@/lib/tutor-context";
import { parseTutorDocument, stripTutorDocument } from "@/lib/tutor-documents";
import { parseTutorGraph, stripTutorGraph } from "@/lib/tutor-graph";
import { tutorModelSupportsAttachments, type TutorModelId } from "@/lib/tutor-models";
import { parseTutorQuiz, stripTutorQuiz, type QuizFRQuestion } from "@/lib/tutor-quiz";
import { useTutorModel, useTutorThinking } from "@/lib/use-tutor-model";
import AITextLoading from "./AITextLoading";
import DocumentCard from "./DocumentCard";
import GraphCard from "./GraphCard";
import ModelPicker from "./ModelPicker";
import LessonCard from "./LessonCard";
import QuizCard from "./QuizCard";
import TutorMarkdown from "./TutorMarkdown";
import { Icon, ICON } from "./ui";

const ACCEPTED_FILE_TYPES =
  "image/*,.pdf,.txt,.md,.markdown,.csv,.json,.log,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.cs,.html,.css,.xml,.yml,.yaml";

const SUGGESTIONS = [
  "What should I do first tonight?",
  "Explain series convergence tests",
  "How do I raise my Calc grade?",
];

/** Shared so "no chat open" doesn't hand every render a brand-new array. */
const NO_MESSAGES: TutorChatMessage[] = [];

export default function TutorView() {
  const s = useStore();
  const chats = useTutorChats();
  const messages = chats.active?.messages ?? NO_MESSAGES;
  const [draft, setDraft] = useState("");
  /**
   * The chat a reply is streaming into, not a boolean: a reply takes seconds,
   * and switching conversations while one arrives must not show the other
   * thread as busy or let a stopped-looking chat swallow the typing dots.
   */
  const [busyChatId, setBusyChatId] = useState<string | null>(null);
  /**
   * The chat whose video is still being built. Asking for a video occupies the
   * tutor for the whole build rather than firing it off and carrying on — it's
   * the answer to what was asked, not a background errand.
   */
  const [lessonChatId, setLessonChatId] = useState<string | null>(null);
  /** The lesson being built, so Stop can call it off server-side. */
  const lessonRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useTutorModel();
  const [effort, setEffort] = useTutorThinking();
  const [pending, setPending] = useState<Attachment[]>([]);
  const [reading, setReading] = useState(false);
  const [railOpen, toggleRail] = useTutorRail();
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Aborts the reply currently streaming, so the composer can stop it. */
  const abortRef = useRef<AbortController | null>(null);

  // Either kind of work occupies the composer, and both are stoppable.
  const occupied = busyChatId ?? lessonChatId;
  const thinking = occupied !== null && occupied === chats.activeId;

  const canAttach = tutorModelSupportsAttachments(model);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    setReading(true);
    setError(null);
    try {
      const read = await Promise.all(Array.from(files).map(readAttachment));
      setPending((prev) => [...prev, ...read]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that file.");
    } finally {
      setReading(false);
    }
  }, []);

  const removePending = useCallback((id: string) => {
    setPending((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleModelChange = useCallback(
    (id: TutorModelId) => {
      setModel(id);
      // Dropping to a model that takes no attachments clears anything queued.
      if (!tutorModelSupportsAttachments(id)) setPending([]);
    },
    [setModel]
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, thinking]);

  /** Every course, every assignment, every submission and grade — see lib/tutor-context.ts. */
  const buildContext = useCallback(() => buildTutorContext(s), [s]);

  /** Runs a board action the tutor asked for, returning what changed (or null if it couldn't). */
  const applyAction = useCallback(
    (action: ReturnType<typeof parseTutorActions>["actions"][number]) => {
      // A video isn't a board edit and resolves to no assignment. It's kicked
      // off separately below, once the reply it belongs to is on screen.
      if (action.kind === "make_video") return null;
      const a = s.assignmentById(action.id);
      if (!a) return null;
      switch (action.kind) {
        case "mark_done":
          s.setStatus(action.id, "done");
          break;
        case "mark_active":
          s.setStatus(action.id, "active");
          break;
        case "mark_todo":
          s.setStatus(action.id, "todo");
          break;
        case "move_bucket":
          s.moveTo(action.id, action.bucket);
          break;
        case "toggle_timer":
          void s.toggleTimer(action.id);
          break;
      }
      return describeTutorAction(action, a.title);
    },
    [s]
  );

  /**
   * Cut the current reply short.
   *
   * Whatever has already streamed stays on screen — it's usually the useful
   * part, and that's why you stopped it. Nothing the half-finished reply asked
   * for is acted on: board actions and quizzes are parsed only from a reply
   * that finished, so a tag caught mid-sentence can't fire.
   */
  const stop = useCallback(() => {
    abortRef.current?.abort();
    // A render is six Chrome workers; stopping has to reach the server, not
    // just stop the page from watching.
    const lesson = lessonRef.current;
    if (lesson) {
      void fetch(`/api/lesson?id=${encodeURIComponent(lesson)}`, { method: "DELETE" }).catch(() => {});
    }
  }, []);

  /**
   * Hand a requested video to the pipeline and pin it to the reply that asked
   * for it. Only the id is stored on the message — the render takes minutes
   * and reports its own progress, so the card below picks it up from there.
   */
  const beginLesson = useCallback(
    async (chatId: string, messageId: string, topic: string, images: boolean) => {
      try {
        const res = await fetch("/api/lesson", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ topic, images, context: buildContext() }),
        });
        const body = (await res.json()) as { id?: string; error?: string };
        if (!res.ok || !body.id) throw new Error(body.error ?? "Couldn't start that video.");
        lessonRef.current = body.id;
        setLessonChatId(chatId);
        chats.updateMessages(chatId, (prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, lesson: { id: body.id!, topic } } : m))
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't start that video.");
      }
    },
    [buildContext, chats]
  );

  const send = useCallback(
    async (raw?: string) => {
      const text = (raw ?? draft).trim();
      const attachments = pending;
      if ((!text && attachments.length === 0) || thinking) return;

      /*
       * Everything below writes to this id rather than "the active chat".
       * Opening another conversation mid-reply is an obvious thing to do while
       * waiting, and the rest of the answer belongs where it was asked.
       */
      const chatId = chats.activeId || chats.startChat();

      const next: TutorChatMessage[] = [
        ...messages,
        {
          id: `u${Date.now()}`,
          role: "user",
          text,
          attachments: attachments.length ? attachments : undefined,
        },
      ];
      const replyId = `a${Date.now()}`;
      const controller = new AbortController();
      abortRef.current = controller;
      chats.updateMessages(chatId, () => [...next, { id: replyId, role: "assistant", text: "" }]);
      setDraft("");
      setPending([]);
      setBusyChatId(chatId);
      setError(null);

      try {
        const res = await fetch("/api/tutor", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: next.map((m) => ({
              role: m.role,
              content:
                m.role === "user" ? toTutorMessageParts(m.text, m.attachments) : m.text,
            })),
            context: buildContext(),
            studentName: s.studentName || undefined,
            model,
            thinking: effort,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error(`Tutor unavailable (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          // Action, quiz, document, and graph tags are stripped as they stream in so the student never sees the raw syntax.
          const shown = stripTutorGraph(stripTutorDocument(stripTutorQuiz(stripTutorActions(acc))));
          chats.updateMessages(chatId, (prev) =>
            prev.map((m) => (m.id === replyId ? { ...m, text: shown } : m))
          );
        }

        if (!acc.trim()) throw new Error("Empty response from tutor.");

        const { clean: withoutQuiz, quiz } = parseTutorQuiz(acc);
        const { clean: withoutDoc, document: doc } = parseTutorDocument(withoutQuiz);
        const { clean: withoutGraph, graph } = parseTutorGraph(withoutDoc);
        const { clean, actions } = parseTutorActions(withoutGraph);
        const applied = actions.map(applyAction).filter((a): a is string => a !== null);
        chats.updateMessages(chatId, (prev) =>
          prev.map((m) =>
            m.id === replyId
              ? {
                  ...m,
                  text: clean,
                  actions: applied,
                  quiz: quiz ?? undefined,
                  document: doc ?? undefined,
                  graph: graph ?? undefined,
                }
              : m
          )
        );

        // Started after the reply lands rather than awaited inside it: a video
        // takes minutes, and the student should be reading the answer already.
        const video = actions.find((a) => a.kind === "make_video");
        if (video) void beginLesson(chatId, replyId, video.topic, video.images);
      } catch (e) {
        // Stopping is something the student did on purpose, not a failure.
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          setError(e instanceof Error ? e.message : "Something went wrong.");
        }
        // Keep whatever arrived; drop the bubble only if nothing did.
        chats.updateMessages(chatId, (prev) => prev.filter((m) => m.id !== replyId || m.text));
      } finally {
        abortRef.current = null;
        setBusyChatId(null);
      }
    },
    [applyAction, beginLesson, buildContext, chats, draft, effort, messages, model, pending, s.studentName, thinking]
  );

  /** Locks in a multiple-choice pick — persisted on the message, like everything else in the thread. */
  const answerQuizChoice = useCallback(
    (messageId: string, questionIndex: number, choice: number) => {
      if (!chats.activeId) return;
      chats.updateMessages(chats.activeId, (prev) =>
        prev.map((m) => {
          if (m.id !== messageId || !m.quiz) return m;
          const questions = m.quiz.questions.map((q, i) =>
            i === questionIndex && q.type === "mcq" ? { ...q, selected: choice } : q
          );
          return { ...m, quiz: { ...m.quiz, questions } };
        })
      );
    },
    [chats]
  );

  const revealQuizSample = useCallback(
    (messageId: string, questionIndex: number) => {
      if (!chats.activeId) return;
      chats.updateMessages(chats.activeId, (prev) =>
        prev.map((m) => {
          if (m.id !== messageId || !m.quiz) return m;
          const questions = m.quiz.questions.map((q, i) =>
            i === questionIndex && q.type === "frq" ? { ...q, revealed: true } : q
          );
          return { ...m, quiz: { ...m.quiz, questions } };
        })
      );
    },
    [chats]
  );

  /** Sending an FRQ answer for feedback is just another chat turn — the tutor already has full context. */
  const requestQuizFeedback = useCallback(
    (question: QuizFRQuestion, answer: string) => {
      void send(`Grade my answer to this practice question:\n\n"${question.prompt}"\n\nMy answer: ${answer}`);
    },
    [send]
  );

  const empty = messages.length === 0;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <ChatRail
        chats={chats.chats}
        activeId={chats.activeId}
        busyChatId={busyChatId}
        open={railOpen}
        onToggle={toggleRail}
        onNew={() => {
          chats.startChat();
          setError(null);
          setPending([]);
        }}
        onOpen={(id) => {
          chats.openChat(id);
          setError(null);
        }}
        onDelete={chats.deleteChat}
        onRename={chats.renameChat}
      />

      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "0 24px 8px",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 1040,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            justifyContent: "flex-start",
            minHeight: "100%",
          }}
        >
          {empty && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
                margin: "auto 0",
                textAlign: "center",
              }}
            >
              <Image
                src="/assets/slates-mark.png"
                alt=""
                width={34}
                height={34}
                style={{ display: "block", objectFit: "contain", opacity: 0.9 }}
              />
              <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em" }}>
                What are you working on?
              </div>
              <p style={{ margin: 0, maxWidth: 420, fontSize: 14, lineHeight: 1.5, color: "var(--muted)" }}>
                Ask about any assignment, a concept you&apos;re stuck on, or how to spend tonight.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 6 }}>
                {SUGGESTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => send(q)}
                    style={{
                      border: "1px solid var(--line)",
                      borderRadius: 9999,
                      background: "transparent",
                      padding: "8px 14px",
                      font: "inherit",
                      fontSize: 13,
                      color: "var(--text-2)",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => {
            /*
             * The assistant's message is created empty and filled as the reply
             * streams in, so for the first moment there is nothing to draw.
             * Rendering the bubble anyway left a stray rounded box hanging
             * above the typing indicator, which already says the same thing.
             */
            const hasBubble = !!m.text || !!m.attachments?.length || !!m.actions?.length;
            if (!hasBubble && !m.quiz && !m.lesson && !m.document && !m.graph) return null;

            return (
            <div
              key={m.id}
              style={{ display: "flex", width: "100%", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  maxWidth: m.role === "user" ? "75%" : "min(92%, 640px)",
                  alignItems: m.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                {hasBubble && (
                <div
                  style={
                    m.role === "user"
                      ? {
                          borderRadius: 24,
                          background: "var(--raised)",
                          padding: "10px 16px",
                          fontSize: 15,
                          lineHeight: 1.5,
                          color: "var(--text)",
                          boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.06), 0 1px 2px oklch(0 0 0 / 0.2)",
                          whiteSpace: "pre-wrap",
                        }
                      : {
                          borderRadius: 24,
                          border: "1px solid var(--line)",
                          background: "var(--surface)",
                          padding: "10px 16px",
                          fontSize: 15,
                          lineHeight: 1.55,
                          color: "var(--text)",
                          boxShadow: "var(--shadow-card)",
                          whiteSpace: "pre-wrap",
                        }
                  }
                >
                  {m.attachments && m.attachments.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 6,
                        marginBottom: m.text ? 8 : 0,
                      }}
                    >
                      {m.attachments.map((a) => (
                        <AttachmentChip key={a.id} attachment={a} />
                      ))}
                    </div>
                  )}
                  {m.role === "assistant" ? <TutorMarkdown text={m.text} /> : m.text}
                  {m.actions && m.actions.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: m.text ? 10 : 0 }}>
                      {m.actions.map((label, i) => (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            fontSize: 12,
                            color: "var(--good)",
                          }}
                        >
                          <Icon path={ICON.check} size={12} />
                          {label}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                )}

                {m.quiz && (
                  <QuizCard
                    quiz={m.quiz}
                    busy={thinking}
                    onSelect={(questionIndex, choice) => answerQuizChoice(m.id, questionIndex, choice)}
                    onReveal={(questionIndex) => revealQuizSample(m.id, questionIndex)}
                    onRequestFeedback={requestQuizFeedback}
                  />
                )}

                {m.lesson && (
                  <LessonCard
                    id={m.lesson.id}
                    topic={m.lesson.topic}
                    onSettled={() => {
                      if (lessonRef.current === m.lesson!.id) lessonRef.current = null;
                      setLessonChatId((c) => (c === chats.activeId ? null : c));
                    }}
                  />
                )}

                {m.document && <DocumentCard document={m.document} />}

                {m.graph && <GraphCard graph={m.graph} />}
              </div>
            </div>
            );
          })}

          {thinking && messages[messages.length - 1]?.text === "" && (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  height: 36,
                  borderRadius: 9999,
                  border: "1px solid var(--line)",
                  background: "var(--surface)",
                  padding: "0 16px",
                }}
              >
                <AITextLoading />
              </div>
            </div>
          )}

          {error && (
            <div style={{ fontSize: 12, color: "var(--warn)", textAlign: "center" }}>{error}</div>
          )}
        </div>
      </div>

      <div style={{ padding: "8px 24px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <div
          style={{
            width: "100%",
            maxWidth: 1040,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            borderRadius: 26,
            border: "1px solid var(--line)",
            background: "var(--sunken)",
            boxShadow: "var(--shadow-sunken)",
            padding: "8px 8px 8px 10px",
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (canAttach && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
          }}
        >
          {pending.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "2px 2px 0" }}>
              {pending.map((a) => (
                <AttachmentChip key={a.id} attachment={a} onRemove={() => removePending(a.id)} />
              ))}
            </div>
          )}

          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (canAttach && files.length) addFiles(files);
            }}
            rows={1}
            placeholder="Ask your tutor"
            aria-label="Ask your tutor"
            className="bare-field bare-field--chat"
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {canAttach && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ACCEPTED_FILE_TYPES}
                  onChange={(e) => {
                    if (e.target.files?.length) addFiles(e.target.files);
                    e.target.value = "";
                  }}
                  style={{ display: "none" }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Add photos or files"
                  disabled={reading}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 30,
                    height: 30,
                    flexShrink: 0,
                    borderRadius: 9999,
                    border: "1px solid var(--line)",
                    background: "transparent",
                    color: "var(--text-2)",
                    cursor: "pointer",
                    opacity: reading ? 0.5 : 1,
                  }}
                >
                  <Icon path={ICON.plus} size={15} />
                </button>
              </>
            )}
            <ModelPicker
              value={model}
              onChange={handleModelChange}
              thinking={effort}
              onThinkingChange={setEffort}
            />
            <span style={{ flex: 1 }} />
            {/* One button in two states. While a reply streams it stops it —
                a send button greyed out for the whole answer leaves no way to
                take back a question you'd rather rephrase. */}
            <button
              type="button"
              onClick={() => (thinking ? stop() : send())}
              aria-label={thinking ? "Stop" : "Send"}
              title={thinking ? "Stop generating" : "Send"}
              disabled={!thinking && !draft.trim() && pending.length === 0}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 36,
                height: 36,
                flexShrink: 0,
                border: 0,
                borderRadius: 9999,
                cursor: "pointer",
                backgroundImage:
                  "linear-gradient(180deg, oklch(0.42 0 0) 0%, oklch(0.37 0 0) 100%)",
                color: "var(--text)",
                boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.08), 0 1px 2px oklch(0 0 0 / 0.2)",
                opacity: !thinking && !draft.trim() && pending.length === 0 ? 0.4 : 1,
                pointerEvents: !thinking && !draft.trim() && pending.length === 0 ? "none" : "auto",
              }}
            >
              <Icon path={thinking ? ICON.stop : [ICON.send, ICON.send2]} size={thinking ? 13 : 18} />
            </button>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

/** "Today", "Yesterday", then the date — enough to find a conversation again. */
function whenLabel(at: number): string {
  const then = new Date(at);
  const today = new Date();
  const days = Math.round(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() -
      new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime()) /
      86_400_000
  );
  if (days <= 0) return then.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (days < 7) return then.toLocaleDateString(undefined, { weekday: "long" });
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Every conversation, and the way into a new one.
 *
 * Collapses to a narrow strip rather than disappearing: the tutor is mostly
 * used full-width on a laptop, but a way back to what you asked yesterday
 * shouldn't be behind a control you have to remember exists.
 */
function ChatRail({
  chats,
  activeId,
  busyChatId,
  open,
  onToggle,
  onNew,
  onOpen,
  onDelete,
  onRename,
}: {
  chats: TutorChat[];
  activeId: string;
  busyChatId: string | null;
  open: boolean;
  onToggle: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");

  const commitRename = () => {
    if (editing) onRename(editing, nameDraft);
    setEditing(null);
  };

  const iconButton = (label: string, path: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="icon-btn"
      style={{ width: 30, height: 30 }}
    >
      <Icon path={path} size={15} />
    </button>
  );

  if (!open) {
    return (
      <div
        style={{
          width: 52,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          padding: "2px 0 20px",
          borderRight: "1px solid var(--line)",
        }}
      >
        {iconButton("Show conversations", ICON.sidebar, onToggle)}
        {iconButton("New chat", ICON.plus, onNew)}
      </div>
    );
  }

  return (
    <div
      style={{
        width: 248,
        flexShrink: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid var(--line)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 8px 8px 10px" }}>
        <span className="section-label" style={{ flex: 1 }}>
          Chats
        </span>
        {iconButton("New chat", ICON.plus, onNew)}
        {iconButton("Hide conversations", ICON.sidebar, onToggle)}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "0 8px 20px" }}>
        {chats.length === 0 && (
          <p style={{ margin: "4px 6px", fontSize: 12, lineHeight: 1.5, color: "var(--muted)" }}>
            Nothing yet. Whatever you ask below is kept here.
          </p>
        )}

        {chats.map((chat) => {
          const active = chat.id === activeId;
          return (
            <div
              key={chat.id}
              onMouseEnter={() => setHovered(chat.id)}
              onMouseLeave={() => setHovered((id) => (id === chat.id ? null : id))}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 2,
                borderRadius: "var(--radius-xs)",
                background: active ? "var(--raised)" : "transparent",
                paddingRight: 2,
              }}
            >
              {editing === chat.id ? (
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setEditing(null);
                  }}
                  aria-label="Rename chat"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    border: 0,
                    borderRadius: "var(--radius-xs)",
                    background: "var(--sunken)",
                    padding: "8px 10px",
                    font: "inherit",
                    fontSize: 13,
                    color: "var(--text)",
                    outline: "1px solid var(--ring)",
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onOpen(chat.id)}
                  onDoubleClick={() => {
                    setEditing(chat.id);
                    setNameDraft(chat.title || "New chat");
                  }}
                  title={chat.title || "New chat"}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 2,
                    border: 0,
                    background: "transparent",
                    padding: "7px 8px 7px 10px",
                    font: "inherit",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span
                    className="truncate"
                    style={{
                      display: "block",
                      width: "100%",
                      fontSize: 13,
                      color: active ? "var(--text)" : "var(--text-2)",
                    }}
                  >
                    {chat.title || "New chat"}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--faint)" }}>
                    {busyChatId === chat.id ? "replying…" : whenLabel(chat.updatedAt)}
                  </span>
                </button>
              )}

              {/* Only on the row you're pointing at — a delete button on every
                  row turns a list of conversations into a list of hazards. */}
              {editing !== chat.id && (hovered === chat.id || active) && (
                <button
                  type="button"
                  onClick={() => onDelete(chat.id)}
                  aria-label={`Delete ${chat.title || "chat"}`}
                  title="Delete"
                  className="icon-btn"
                  style={{ width: 26, height: 26, flexShrink: 0 }}
                >
                  <Icon path={ICON.trash} size={13} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove?: () => void;
}) {
  /*
   * A reloaded conversation keeps the picture's name and not its bytes, so
   * there is no thumbnail left to draw. It shows as a named chip instead of a
   * broken image — the message that referred to it still makes sense.
   */
  const thumbnail = attachment.kind === "image" && !!attachment.dataUrl;

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 6,
        maxWidth: 180,
        borderRadius: thumbnail ? 10 : 9999,
        border: "1px solid var(--line)",
        background: "var(--surface)",
        overflow: "hidden",
        ...(thumbnail ? { width: 44, height: 44 } : { padding: "5px 10px 5px 8px" }),
      }}
      title={attachment.kind === "image" && !thumbnail ? `${attachment.name} — no longer loaded` : attachment.name}
    >
      {thumbnail && attachment.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={attachment.dataUrl}
          alt={attachment.name}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        <>
          <Icon path={ICON.file} size={13} style={{ color: "var(--muted)", flexShrink: 0 }} />
          <span
            style={{
              fontSize: 12,
              color: "var(--text-2)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {attachment.name}
          </span>
        </>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${attachment.name}`}
          style={{
            position: "absolute",
            top: thumbnail ? 2 : "50%",
            right: thumbnail ? 2 : 4,
            transform: thumbnail ? undefined : "translateY(-50%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 16,
            height: 16,
            flexShrink: 0,
            border: 0,
            borderRadius: 9999,
            background: "oklch(0 0 0 / 0.55)",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          <Icon path={ICON.close} size={9} />
        </button>
      )}
    </div>
  );
}
