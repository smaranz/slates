"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
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
import ArtifactChip from "./ArtifactChip";
import ArtifactPanel from "./ArtifactPanel";
import DocumentCard from "./DocumentCard";
import GeneratedImageCard from "./GeneratedImageCard";
import GraphCard from "./GraphCard";
import ModelPicker from "./ModelPicker";
import LessonCard from "./LessonCard";
import OutputFiles from "./OutputFiles";
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
  const dictation = useDictation((heard) =>
    setDraft((cur) => (cur ? `${cur.replace(/\s+$/, "")} ${heard}` : heard))
  );
  /** The reply whose Copy button is showing its tick. */
  const [copiedId, setCopiedId] = useState<string | null>(null);
  /** Thumbs on a reply, kept for the session — a rating, not a filed report. */
  const [rated, setRated] = useState<Record<string, "up" | "down">>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Aborts the reply currently streaming, so the composer can stop it. */
  const abortRef = useRef<AbortController | null>(null);

  /**
   * The quiz or document currently open in the side panel — opened the way
   * Claude opens an artifact next to the conversation instead of burying it
   * in scrollback. `null` means the panel is closed; the chip in the
   * transcript is what opens it (or reopens it after a close).
   */
  const [openArtifact, setOpenArtifact] = useState<{ kind: "quiz" | "document"; messageId: string } | null>(null);
  const [artifactFullscreen, setArtifactFullscreen] = useState(false);
  // A different conversation has nothing to do with whatever was pinned open —
  // reset during render rather than in an effect, so the old artifact never
  // paints for a frame against the newly-opened chat.
  const [artifactChatId, setArtifactChatId] = useState(chats.activeId);
  if (artifactChatId !== chats.activeId) {
    setArtifactChatId(chats.activeId);
    setOpenArtifact(null);
    setArtifactFullscreen(false);
  }

  /**
   * Replies currently drawing an illustration. Generation takes seconds, not
   * the minutes a video render does, so unlike `lessonChatId` this doesn't
   * occupy the composer — the card just shows its own loading state until
   * the message picks up the finished image.
   */
  const [imagePendingIds, setImagePendingIds] = useState<Set<string>>(() => new Set());

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

  /*
   * The composer grows with what's in it and springs back when it's sent.
   * `rows={1}` alone gives a one-line box that scrolls internally, which hides
   * the top of anything longer than a sentence.
   */
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  /** Every course, every assignment, every submission and grade — see lib/tutor-context.ts. */
  const buildContext = useCallback(() => buildTutorContext(s), [s]);

  /** Runs a board action the tutor asked for, returning what changed (or null if it couldn't). */
  const applyAction = useCallback(
    (action: ReturnType<typeof parseTutorActions>["actions"][number]) => {
      // Neither a video nor an image is a board edit or resolves to an
      // assignment. Both are kicked off separately below, once the reply
      // they belong to is on screen.
      if (action.kind === "make_video" || action.kind === "generate_image") return null;
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

  /** Draws one illustration and pins it to the reply that asked for it. */
  const beginImage = useCallback(
    async (chatId: string, messageId: string, prompt: string) => {
      setImagePendingIds((prev) => new Set(prev).add(messageId));
      try {
        const res = await fetch("/api/image", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt }),
        });
        const body = (await res.json()) as { dataUrl?: string; error?: string };
        if (!res.ok || !body.dataUrl) throw new Error(body.error ?? "Couldn't draw that.");
        chats.updateMessages(chatId, (prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, image: { prompt, dataUrl: body.dataUrl! } } : m))
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't draw that.");
      } finally {
        setImagePendingIds((prev) => {
          if (!prev.has(messageId)) return prev;
          const next = new Set(prev);
          next.delete(messageId);
          return next;
        });
      }
    },
    [chats]
  );

  const send = useCallback(
    /**
     * `history` and `files` are only passed by Retry, which replays a turn
     * from a transcript it has just truncated. Reading them from state there
     * would read the pre-truncation thread — this render's `messages` is a
     * frame behind the store write that dropped the old answer.
     */
    async (raw?: string, history?: TutorChatMessage[], files?: Attachment[]) => {
      const text = (raw ?? draft).trim();
      const attachments = files ?? pending;
      const base = history ?? messages;
      if ((!text && attachments.length === 0) || thinking) return;

      /*
       * Everything below writes to this id rather than "the active chat".
       * Opening another conversation mid-reply is an obvious thing to do while
       * waiting, and the rest of the answer belongs where it was asked.
       */
      const chatId = chats.activeId || chats.startChat();

      const next: TutorChatMessage[] = [
        ...base,
        {
          id: `u${Date.now()}`,
          role: "user",
          text,
          attachments: attachments.length ? attachments : undefined,
        },
      ];
      const replyId = `a${Date.now()}`;
      // Files are matched by modification time against this mark, so a reply
      // can only ever show what appeared while it was actually running.
      const turnStartedAt = Date.now();
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

        // Opens the same way Claude surfaces a freshly-made artifact — on
        // screen already, not just a chip waiting to be noticed. A document
        // wins if a reply somehow produced both; only one panel shows at once.
        if (doc) setOpenArtifact({ kind: "document", messageId: replyId });
        else if (quiz) setOpenArtifact({ kind: "quiz", messageId: replyId });

        // Started after the reply lands rather than awaited inside it: a video
        // takes minutes, and the student should be reading the answer already.
        const video = actions.find((a) => a.kind === "make_video");
        if (video) void beginLesson(chatId, replyId, video.topic, video.images);

        /*
         * Whatever a skill wrote while this turn ran. Read from the directory
         * rather than from the reply: the tutor saying it made a document and
         * a document existing are different claims, and only one is checkable.
         */
        void fetch(`/api/tutor/files?since=${turnStartedAt}`, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : { files: [] }))
          .then((body: { files?: { name: string; size: number }[] }) => {
            if (!body.files?.length) return;
            chats.updateMessages(chatId, (prev) =>
              prev.map((m) => (m.id === replyId ? { ...m, files: body.files } : m))
            );
          })
          .catch(() => {});

        const drawing = actions.find((a) => a.kind === "generate_image");
        if (drawing) void beginImage(chatId, replyId, drawing.prompt);
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
    [
      applyAction,
      beginImage,
      beginLesson,
      buildContext,
      chats,
      draft,
      effort,
      messages,
      model,
      pending,
      s.studentName,
      thinking,
    ]
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

  /**
   * Take a turn back. The answer and the question both leave the transcript,
   * and the question is asked again from the history that preceded it — which
   * is what "regenerate" means everywhere it appears.
   */
  const retry = useCallback(
    (replyId: string) => {
      if (thinking || !chats.activeId) return;
      const at = messages.findIndex((m) => m.id === replyId);
      if (at < 0) return;
      let ask = at - 1;
      while (ask >= 0 && messages[ask].role !== "user") ask -= 1;
      if (ask < 0) return;

      const question = messages[ask];
      const history = messages.slice(0, ask);
      const chatId = chats.activeId;
      chats.updateMessages(chatId, () => history);
      void send(question.text, history, question.attachments ?? []);
    },
    [chats, messages, send, thinking]
  );

  /**
   * Rephrase a question. The turn is lifted back into the composer and the
   * thread rewinds to just before it, so the follow-ups that were answers to
   * the old wording don't linger under the new one.
   */
  const editAsk = useCallback(
    (messageId: string) => {
      if (thinking || !chats.activeId) return;
      const at = messages.findIndex((m) => m.id === messageId);
      if (at < 0) return;
      setDraft(messages[at].text);
      setPending(messages[at].attachments ?? []);
      chats.updateMessages(chats.activeId, () => messages.slice(0, at));
      composerRef.current?.focus();
    },
    [chats, messages, thinking]
  );

  /** Thumbs toggle rather than latch — a misclick shouldn't be permanent. */
  const rate = useCallback((id: string, verdict: "up" | "down") => {
    setRated((prev) => {
      const next = { ...prev };
      if (next[id] === verdict) delete next[id];
      else next[id] = verdict;
      return next;
    });
  }, []);

  /** Copy a reply, with a two-second tick on the button that did it. */
  const copyReply = useCallback((id: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopiedId(id);
        window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1600);
      },
      () => {}
    );
  }, []);

  const empty = messages.length === 0;

  const openMessage = openArtifact ? messages.find((m) => m.id === openArtifact.messageId) : undefined;
  const openQuiz = openArtifact?.kind === "quiz" ? openMessage?.quiz : undefined;
  const openDoc = openArtifact?.kind === "document" ? openMessage?.document : undefined;

  return (
    <div className="gpt" data-drawer={railOpen ? "open" : "closed"}>
      {/* The drawer is a sheet over the thread on a phone and a docked column
          on a laptop. Same markup either way — only the CSS differs, so the
          conversation list can't drift between the two shells. */}
      <div className="gpt-scrim" onClick={toggleRail} aria-hidden="true" />

      <ChatDrawer
        chats={chats.chats}
        activeId={chats.activeId}
        busyChatId={busyChatId}
        onClose={toggleRail}
        onNew={() => {
          chats.startChat();
          setError(null);
          setPending([]);
          setDraft("");
        }}
        onOpen={(id) => {
          chats.openChat(id);
          setError(null);
        }}
        onDelete={chats.deleteChat}
        onRename={chats.renameChat}
      />

      <div className="gpt-main">
        {/* Sidebar toggle, the model you're talking to, and a new chat —
            the three things ChatGPT keeps in its header, in that order. */}
        <header className="gpt-header">
          <button
            type="button"
            className="gpt-icon-btn"
            onClick={toggleRail}
            aria-label={railOpen ? "Hide conversations" : "Show conversations"}
            aria-expanded={railOpen}
          >
            <Icon path={ICON.sidebar} size={19} />
          </button>

          <ModelPicker
            value={model}
            onChange={handleModelChange}
            thinking={effort}
            onThinkingChange={setEffort}
            placement="down"
            variant="bare"
          />

          <span className="gpt-header-gap" />

          <button
            type="button"
            className="gpt-icon-btn"
            onClick={() => {
              chats.startChat();
              setError(null);
              setPending([]);
              setDraft("");
            }}
            aria-label="New chat"
            title="New chat"
          >
            <Icon path={ICON.compose} size={19} />
          </button>
        </header>

        <div className="gpt-thread" ref={scrollRef}>
          <div className={`gpt-column${empty ? " gpt-column--empty" : ""}`}>
            {empty && (
              <div className="gpt-greeting">
                <Image
                  src="/assets/slates-mark.png"
                  alt=""
                  width={30}
                  height={30}
                  className="gpt-greeting-mark"
                />
                <h1>What are you working on?</h1>
                <div className="gpt-starters">
                  {SUGGESTIONS.map((q) => (
                    <button key={q} type="button" className="gpt-starter" onClick={() => send(q)}>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => {
              /*
               * The assistant's message is created empty and filled as the
               * reply streams in, so for the first moment there is nothing to
               * draw. Rendering the row anyway left a stray gap above the
               * typing indicator, which already says the same thing.
               */
              const hasText = !!m.text || !!m.attachments?.length || !!m.actions?.length;
              const drawingImage = imagePendingIds.has(m.id);
              if (!hasText && !m.quiz && !m.lesson && !m.document && !m.graph && !m.image && !drawingImage) {
                return null;
              }

              // Actions belong to a finished reply. Offering Retry on half an
              // answer would throw away the half that had already arrived.
              const streaming = thinking && i === messages.length - 1;
              const rating = rated[m.id];

              if (m.role === "user") {
                return (
                  <div key={m.id} className="gpt-turn gpt-turn--user">
                    <div className="gpt-bubble">
                      {m.attachments && m.attachments.length > 0 && (
                        <div className="gpt-bubble-files">
                          {m.attachments.map((a) => (
                            <AttachmentChip key={a.id} attachment={a} />
                          ))}
                        </div>
                      )}
                      {m.text}
                    </div>
                    <div className="gpt-actions gpt-actions--user">
                      <ActionButton
                        label={copiedId === m.id ? "Copied" : "Copy"}
                        icon={copiedId === m.id ? ICON.check : ICON.copy}
                        onClick={() => copyReply(m.id, m.text)}
                      />
                      <ActionButton
                        label="Edit"
                        icon={ICON.pencil}
                        disabled={thinking}
                        onClick={() => editAsk(m.id)}
                      />
                    </div>
                  </div>
                );
              }

              return (
                /* No bubble on this side. The reply is the page — the way
                   ChatGPT stopped boxing the assistant once answers got long
                   enough that a box was just a border around a whole screen. */
                <div key={m.id} className="gpt-turn gpt-turn--assistant">
                  {hasText && (
                    <div className="gpt-reply">
                      <TutorMarkdown text={m.text} className="prose--chat" />
                      {m.actions && m.actions.length > 0 && (
                        <div className="gpt-applied">
                          {m.actions.map((label, k) => (
                            <div key={k} className="gpt-applied-row">
                              <Icon path={ICON.check} size={12} />
                              {label}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {m.quiz && (
                    <ArtifactChip
                      icon={ICON.assignments}
                      title={m.quiz.title || "Practice set"}
                      subtitle={`${m.quiz.questions.length} question${m.quiz.questions.length === 1 ? "" : "s"}`}
                      active={openArtifact?.kind === "quiz" && openArtifact.messageId === m.id}
                      onClick={() =>
                        setOpenArtifact((cur) =>
                          cur?.kind === "quiz" && cur.messageId === m.id ? null : { kind: "quiz", messageId: m.id }
                        )
                      }
                    />
                  )}

                  {m.files && m.files.length > 0 && <OutputFiles files={m.files} />}

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

                  {m.document && (
                    <ArtifactChip
                      icon={ICON.file}
                      title={m.document.title}
                      subtitle={`${m.document.body.trim().split(/\s+/).filter(Boolean).length} words`}
                      active={openArtifact?.kind === "document" && openArtifact.messageId === m.id}
                      onClick={() =>
                        setOpenArtifact((cur) =>
                          cur?.kind === "document" && cur.messageId === m.id
                            ? null
                            : { kind: "document", messageId: m.id }
                        )
                      }
                    />
                  )}

                  {m.graph && <GraphCard graph={m.graph} />}

                  {m.image && <GeneratedImageCard image={m.image} />}

                  {drawingImage && !m.image && (
                    <div className="gpt-inline-status">
                      <AITextLoading texts={["Drawing..."]} />
                    </div>
                  )}

                  {hasText && !streaming && (
                    <div className="gpt-actions">
                      <ActionButton
                        label={copiedId === m.id ? "Copied" : "Copy"}
                        icon={copiedId === m.id ? ICON.check : ICON.copy}
                        onClick={() => copyReply(m.id, m.text)}
                      />
                      <ActionButton
                        label="Good response"
                        icon={ICON.thumbUp}
                        active={rating === "up"}
                        onClick={() => rate(m.id, "up")}
                      />
                      <ActionButton
                        label="Bad response"
                        icon={ICON.thumbDown}
                        active={rating === "down"}
                        onClick={() => rate(m.id, "down")}
                      />
                      <ActionButton
                        label="Try again"
                        icon={ICON.retry}
                        disabled={thinking}
                        onClick={() => retry(m.id)}
                      />
                    </div>
                  )}
                </div>
              );
            })}

            {thinking && messages[messages.length - 1]?.text === "" && (
              <div className="gpt-turn gpt-turn--assistant">
                <div className="gpt-thinking">
                  <AITextLoading />
                </div>
              </div>
            )}

            {error && <div className="gpt-error">{error}</div>}
          </div>
        </div>

        <div className="gpt-composer-dock">
          <form
            className="gpt-composer"
            onSubmit={(e) => {
              e.preventDefault();
              if (!thinking) send();
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (canAttach && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
            }}
          >
            {pending.length > 0 && (
              <div className="gpt-composer-files">
                {pending.map((a) => (
                  <AttachmentChip key={a.id} attachment={a} onRemove={() => removePending(a.id)} />
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
                  send();
                }
              }}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files);
                if (canAttach && files.length) addFiles(files);
              }}
              rows={1}
              placeholder="Ask anything"
              aria-label="Ask your tutor"
              className="gpt-input"
            />

            <div className="gpt-composer-row">
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
                    className="gpt-round-btn"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Add photos or files"
                    disabled={reading}
                  >
                    <Icon path={ICON.plus} size={17} />
                  </button>
                </>
              )}

              <span className="gpt-composer-gap" />

              {/* Dictation, only where the browser actually has it. A mic that
                  does nothing is worse than no mic, and WKWebView has none. */}
              {dictation.available && (
                <button
                  type="button"
                  className={`gpt-round-btn${dictation.listening ? " is-live" : ""}`}
                  onClick={dictation.toggle}
                  aria-label={dictation.listening ? "Stop dictating" : "Dictate"}
                  aria-pressed={dictation.listening}
                >
                  <Icon path={dictation.listening ? ICON.waveform : ICON.mic} size={17} />
                </button>
              )}

              {/* One button in two states. While a reply streams it stops it —
                  a send button greyed out for the whole answer leaves no way
                  to take back a question you'd rather rephrase. */}
              <button
                type={thinking ? "button" : "submit"}
                className="gpt-send"
                onClick={thinking ? stop : undefined}
                aria-label={thinking ? "Stop" : "Send"}
                title={thinking ? "Stop generating" : "Send"}
                disabled={!thinking && !draft.trim() && pending.length === 0}
              >
                <Icon path={thinking ? ICON.stop : ICON.arrowUp} size={thinking ? 13 : 19} />
              </button>
            </div>
          </form>

          <p className="gpt-disclaimer">Slates can make mistakes. Check anything that matters.</p>
        </div>
      </div>

      {openQuiz && (
        <ArtifactPanel
          title={openQuiz.title || "Practice set"}
          icon={ICON.assignments}
          fullscreen={artifactFullscreen}
          onToggleFullscreen={() => setArtifactFullscreen((v) => !v)}
          onClose={() => {
            setOpenArtifact(null);
            setArtifactFullscreen(false);
          }}
        >
          <QuizCard
            quiz={openQuiz}
            busy={thinking}
            onSelect={(questionIndex, choice) => answerQuizChoice(openMessage!.id, questionIndex, choice)}
            onReveal={(questionIndex) => revealQuizSample(openMessage!.id, questionIndex)}
            onRequestFeedback={requestQuizFeedback}
          />
        </ArtifactPanel>
      )}

      {openDoc && (
        <ArtifactPanel
          title="Document"
          icon={ICON.file}
          fullscreen={artifactFullscreen}
          onToggleFullscreen={() => setArtifactFullscreen((v) => !v)}
          onClose={() => {
            setOpenArtifact(null);
            setArtifactFullscreen(false);
          }}
        >
          <DocumentCard document={openDoc} />
        </ArtifactPanel>
      )}
    </div>
  );
}

/**
 * Dictation, where the browser has it.
 *
 * ChatGPT puts a mic next to send, so this does too — but only when there is
 * something behind it. `webkitSpeechRecognition` is a Safari/Chrome feature
 * and is absent from the WKWebView the packaged app runs in, so on the phone
 * build the button simply never appears rather than appearing and doing
 * nothing, which is the worse of the two failures.
 */
interface SpeechLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult:
    | ((event: {
        /** Where the new results start — `results` is cumulative, not a delta. */
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

function speechCtor(): (new () => SpeechLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechLike;
    webkitSpeechRecognition?: new () => SpeechLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Never changes for the life of the page — there is nothing to subscribe to. */
function subscribeSpeech(): () => void {
  return () => {};
}
function speechAvailable(): boolean {
  return speechCtor() !== null;
}
function speechAvailableOnServer(): boolean {
  return false;
}

function useDictation(onText: (text: string) => void) {
  /*
   * Read through `useSyncExternalStore` rather than in an effect: the server
   * has no `window`, and setting this from an effect would render the button
   * once without the mic and once with it — a control that pops into the
   * composer a frame after the view opens.
   */
  const available = useSyncExternalStore(subscribeSpeech, speechAvailable, speechAvailableOnServer);
  const [listening, setListening] = useState(false);
  const engine = useRef<SpeechLike | null>(null);
  const sink = useRef(onText);

  // After commit, not during render: the callback closes over this render's
  // draft, and the recognizer is long-lived enough to outlive several.
  useEffect(() => {
    sink.current = onText;
  });

  useEffect(() => () => engine.current?.stop(), []);

  const toggle = useCallback(() => {
    if (engine.current) {
      engine.current.stop();
      return;
    }
    const Ctor = speechCtor();
    if (!Ctor) return;

    const rec = new Ctor();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (event) => {
      // Only what arrived since the last callback: `results` holds the whole
      // session, so replaying it from zero would retype every sentence.
      let heard = "";
      for (let i = event.resultIndex ?? 0; i < event.results.length; i += 1) {
        heard += event.results[i][0].transcript;
      }
      const trimmed = heard.trim();
      if (trimmed) sink.current(trimmed);
    };
    const finish = () => {
      engine.current = null;
      setListening(false);
    };
    rec.onend = finish;
    rec.onerror = finish;

    try {
      rec.start();
      engine.current = rec;
      setListening(true);
    } catch {
      // Already running, or permission refused at the OS level.
      finish();
    }
  }, []);

  return { available, listening, toggle };
}

/** A ghost icon button with its label as a tooltip — the transcript's action bar. */
function ActionButton({
  label,
  icon,
  onClick,
  active,
  disabled,
}: {
  label: string;
  icon: string | string[];
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="gpt-action"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
    >
      <Icon path={icon} size={15} />
    </button>
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

/** The headings a conversation list is filed under, newest band first. */
function band(at: number): string {
  const days = Math.round(
    (new Date().setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000
  );
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days <= 7) return "Previous 7 days";
  if (days <= 30) return "Previous 30 days";
  return "Older";
}

/**
 * Every saved conversation, and the way into a new one.
 *
 * A sheet over the thread on a phone and a docked column on a laptop, filed
 * under Today / Yesterday / the last week — which is how you actually look for
 * a conversation you half remember having.
 */
function ChatDrawer({
  chats,
  activeId,
  busyChatId,
  onClose,
  onNew,
  onOpen,
  onDelete,
  onRename,
}: {
  chats: TutorChat[];
  activeId: string;
  busyChatId: string | null;
  onClose: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");

  const commitRename = () => {
    if (editing) onRename(editing, nameDraft);
    setEditing(null);
  };

  const needle = query.trim().toLowerCase();
  const matches = needle
    ? chats.filter(
        (c) =>
          (c.title || "New chat").toLowerCase().includes(needle) ||
          c.messages.some((m) => m.text.toLowerCase().includes(needle))
      )
    : chats;

  // Already newest-first from the store, so the bands come out in order too.
  const groups: { label: string; items: TutorChat[] }[] = [];
  for (const chat of matches) {
    const label = band(chat.updatedAt);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(chat);
    else groups.push({ label, items: [chat] });
  }

  return (
    <aside className="gpt-drawer" aria-label="Conversations">
      <div className="gpt-drawer-head">
        <button type="button" className="gpt-icon-btn" onClick={onClose} aria-label="Hide conversations">
          <Icon path={ICON.sidebar} size={19} />
        </button>
        <span className="gpt-header-gap" />
        <button type="button" className="gpt-icon-btn" onClick={onNew} aria-label="New chat" title="New chat">
          <Icon path={ICON.compose} size={19} />
        </button>
      </div>

      <div className="gpt-search">
        <Icon path={ICON.magnifier} size={15} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search chats"
          aria-label="Search chats"
          className="bare-field"
        />
      </div>

      <button type="button" className="gpt-drawer-new" onClick={onNew}>
        <span className="gpt-drawer-new-icon">
          <Icon path={ICON.compose} size={15} />
        </span>
        New chat
      </button>

      <div className="gpt-drawer-list">
        {chats.length === 0 && (
          <p className="gpt-drawer-empty">Nothing yet. Whatever you ask below is kept here.</p>
        )}
        {chats.length > 0 && matches.length === 0 && (
          <p className="gpt-drawer-empty">No chat matches “{query.trim()}”.</p>
        )}

        {groups.map((group) => (
          <div key={group.label} className="gpt-drawer-group">
            <div className="gpt-drawer-band">{group.label}</div>
            {group.items.map((chat) => {
              const active = chat.id === activeId;
              if (editing === chat.id) {
                return (
                  <input
                    key={chat.id}
                    autoFocus
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") setEditing(null);
                    }}
                    aria-label="Rename chat"
                    className="gpt-drawer-rename"
                  />
                );
              }
              return (
                <div key={chat.id} className="gpt-drawer-row" data-active={active ? "1" : undefined}>
                  <button
                    type="button"
                    onClick={() => onOpen(chat.id)}
                    onDoubleClick={() => {
                      setEditing(chat.id);
                      setNameDraft(chat.title || "New chat");
                    }}
                    title={chat.title || "New chat"}
                    className="gpt-drawer-open"
                  >
                    <span className="truncate">{chat.title || "New chat"}</span>
                    <span className="gpt-drawer-when">
                      {busyChatId === chat.id ? "replying…" : whenLabel(chat.updatedAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(chat.id)}
                    aria-label={`Delete ${chat.title || "chat"}`}
                    title="Delete"
                    className="gpt-drawer-delete"
                  >
                    <Icon path={ICON.trash} size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </aside>
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
