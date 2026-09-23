"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";

import {
  filesFromDataTransfer,
  readAttachment,
  takePasteFiles,
  toTutorMessageParts,
  type Attachment,
} from "@/lib/attachments";
import { useCounselor } from "@/lib/counselor/store";
import { useStore } from "@/lib/store";
import { describeTutorAction, parseTutorActions, stripTutorActions } from "@/lib/tutor-actions";
import {
  useTutorChats,
  useTutorRail,
  peekTutorMessages,
  type TutorChat,
  type TutorChatMessage,
  type TutorStep,
  type TutorWork,
} from "@/lib/tutor-chats";
import {
  buildMentionFocus,
  mentionCandidates,
  searchMentions,
  type MaterialHint,
  type Mention,
} from "@/lib/tutor-mentions";
import { buildTutorContext } from "@/lib/tutor-context";
import { parseTutorDocument, stripTutorDocument } from "@/lib/tutor-documents";
import { parseTutorGraph, stripTutorGraph } from "@/lib/tutor-graph";
import { tutorModelSupportsAttachments, type TutorModelId } from "@/lib/tutor-models";
import { parseTutorQuiz, stripTutorQuiz, type QuizFRQuestion } from "@/lib/tutor-quiz";
import { buildTutorStarters } from "@/lib/tutor-starters";
import { useDictation } from "@/lib/dictation";
import { createEventParser, tidyReasoning } from "@/lib/tutor-stream";
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
import MathText from "./MathText";
import QuizCard from "./QuizCard";
import TutorMarkdown from "./TutorMarkdown";
import MentionMenu from "./MentionMenu";
import { Icon, ICON, Spinner } from "./ui";

const ACCEPTED_FILE_TYPES =
  "image/*,.png,.jpg,.jpeg,.gif,.webp,.heic,.heif,.pdf,.txt,.md,.markdown,.csv,.json,.log,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.cs,.html,.css,.xml,.yml,.yaml";

/** Shared so "no chat open" doesn't hand every render a brand-new array. */
const NO_MESSAGES: TutorChatMessage[] = [];

export default function TutorView() {
  const s = useStore();
  const chats = useTutorChats();
  const messages = chats.active?.messages ?? NO_MESSAGES;
  const [draft, setDraft] = useState("");
  /**
   * Replies currently streaming, keyed per reply so one chat's answer doesn't
   * lock every other chat. Each reply knows its chat so the drawer can still
   * say "replying…" on the right conversation.
   */
  const [streamingReplyIds, setStreamingReplyIds] = useState<Set<string>>(() => new Set());
  const replyChatRef = useRef(new Map<string, string>());
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

  /*
   * `@` mentions.
   *
   * `query` is null when the menu is shut. It opens on an `@` that starts a
   * word and closes on a space, an escape, or a pick — the same rules every
   * mention box has, because anything else fights muscle memory.
   */
  const counselor = useCounselor();
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [materialHints, setMaterialHints] = useState<MaterialHint[]>([]);
  const [loadingMaterials, setLoadingMaterials] = useState(false);
  const materialsAsked = useRef(false);

  const candidates = useMemo(
    () => mentionCandidates(s, counselor.essays, materialHints),
    [s, counselor.essays, materialHints]
  );

  const mentionMatches = useMemo(
    () => (mentionQuery === null ? [] : searchMentions(candidates, mentionQuery)),
    [candidates, mentionQuery]
  );

  /*
   * A query with no space stays open even with nothing to show, because you
   * are mid-word and the next keystroke may match. Once it contains a space
   * and still matches nothing, it was never a mention — it was someone
   * writing an email address or a sentence — so the menu gets out of the way.
   */
  const mentionOpen =
    mentionQuery !== null && (mentionMatches.length > 0 || !mentionQuery.includes(" "));

  /*
   * Materials aren't in the board snapshot — they're a fetch per course — so
   * they're pulled in the first time the menu opens and kept for the session.
   * Doing it on mount would be a burst of requests for a feature most turns
   * never touch.
   */
  useEffect(() => {
    if (mentionQuery === null || materialsAsked.current) return;
    materialsAsked.current = true;
    const courses = s.snapshot.courses;
    if (!courses.length) return;

    void (async () => {
      setLoadingMaterials(true);
      const found: MaterialHint[] = [];
      for (const course of courses) {
        try {
          const res = await fetch(`/api/materials?course=${encodeURIComponent(course.id)}`, {
            cache: "no-store",
          });
          if (!res.ok) continue;
          const body = (await res.json()) as { items?: { kind: string; title: string; url: string }[] };
          for (const item of body.items ?? []) {
            if (item.kind === "folder" || !item.title) continue;
            found.push({ courseId: course.id, title: item.title, url: item.url, kind: item.kind });
          }
        } catch {
          // A course whose materials won't load just isn't mentionable.
        }
      }
      setMaterialHints(found);
      setLoadingMaterials(false);
    })();
  }, [mentionQuery, s.snapshot.courses]);

  /**
   * What has been typed since the `@` the caret is sitting after.
   *
   * Spaces are allowed, which they have to be: "LOTF Campaign poster" is a
   * real assignment title and stopping the query at the first space meant it
   * could never be found by name. The cap keeps a stray `@` mid-sentence from
   * treating the rest of the paragraph as a search, and a query with a space
   * that matches nothing closes the menu — see `mentionOpen`.
   */
  const readMentionQuery = useCallback((el: HTMLTextAreaElement): string | null => {
    const upToCaret = el.value.slice(0, el.selectionStart ?? 0);
    const match = /(?:^|\s)@([^@\n]{0,48})$/.exec(upToCaret);
    return match ? match[1] : null;
  }, []);

  const closeMentions = useCallback(() => {
    setMentionQuery(null);
    setMentionIndex(0);
  }, []);

  /** Swaps the half-typed `@query` for the real label and records the mention. */
  const pickMention = useCallback(
    (mention: Mention) => {
      const el = composerRef.current;
      setMentions((prev) =>
        prev.some((m) => m.kind === mention.kind && m.id === mention.id) ? prev : [...prev, mention]
      );
      closeMentions();

      if (!el) return;
      const caret = el.selectionStart ?? el.value.length;
      const before = el.value.slice(0, caret);
      const start = before.lastIndexOf("@");
      if (start === -1) return;
      const token = `@${mention.label} `;
      const next = before.slice(0, start) + token + el.value.slice(caret);
      setDraft(next);
      // Put the caret after the token on the next frame, once React has
      // written the new value — otherwise it snaps back to the end.
      const at = start + token.length;
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(at, at);
      });
    },
    [closeMentions]
  );

  const removeMention = useCallback((mention: Mention) => {
    setMentions((prev) => prev.filter((m) => !(m.kind === mention.kind && m.id === mention.id)));
  }, []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** One AbortController per in-flight reply — different chats can each have one. */
  const liveRef = useRef(new Map<string, { controller: AbortController; chatId: string }>());

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

  const busyChatIds = useMemo(() => {
    const ids = new Set<string>();
    for (const replyId of streamingReplyIds) {
      const chatId = replyChatRef.current.get(replyId);
      if (chatId) ids.add(chatId);
    }
    return ids;
  }, [streamingReplyIds]);

  const activeStreaming = busyChatIds.has(chats.activeId);
  const lessonBusy = lessonChatId !== null && lessonChatId === chats.activeId;
  /** Streaming dots / work panel on the open chat — not a composer lock. */
  const thinking = activeStreaming || lessonBusy;
  /** One turn at a time per chat; a video render owns the composer too — it is the answer. */
  const composerLocked = activeStreaming || lessonBusy;

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

  /*
   * The thread follows the reply only for someone already watching the end of
   * it.
   *
   * It used to pin to the bottom on every store write, which was survivable
   * while a write meant "more text arrived" and became unusable once the work
   * panel started writing on every reasoning chunk too: scrolling up during a
   * reply was undone within a frame, so the view fought the scroll wheel. If
   * you have deliberately moved away from the bottom, you get to stay there.
   */
  const stick = useRef(true);
  /** Where this component last put the scroller, to tell its own scrolling apart from yours. */
  const placedAt = useRef(0);

  /*
   * Whether you have moved away is decided here, at effect time, and not in
   * the scroll handler below.
   *
   * A scroll event is dispatched asynchronously and coalesced to one per
   * frame, so during a reply that writes every few milliseconds the handler
   * always lost the race: you scrolled up, the next chunk arrived and pinned
   * the view back down, and the single scroll event that finally fired
   * reported the bottom — leaving the flag set and the wheel apparently
   * broken. Reading the position here instead is synchronous, and happens
   * before anything has had a chance to undo it.
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    if (Math.abs(el.scrollTop - placedAt.current) > 2) {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    }
    if (!stick.current) return;

    el.scrollTo({ top: el.scrollHeight });
    placedAt.current = el.scrollTop;
  }, [messages, thinking]);

  // Still needed for the other direction: scrolling back to the bottom while
  // nothing is arriving, which produces no effect run to notice it.
  const onThreadScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
      stick.current = true;
      placedAt.current = el.scrollTop;
    }
  }, []);

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

  /**
   * Empty-state chips, rebuilt from the live board. Status and column
   * overrides are in the callbacks, so finishing something tonight swaps the
   * chip without a refresh.
   */
  const starters = useMemo(
    () =>
      buildTutorStarters({
        courses: s.snapshot.courses,
        assignments: s.snapshot.assignments,
        statusOf: s.statusOf,
        bucketOf: s.bucketOf,
        onBoard: s.onBoard,
      }),
    [s.snapshot, s.statusOf, s.bucketOf, s.onBoard]
  );

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
   *
   * Stops every turn still streaming into the open chat (and any video render).
   */
  const stop = useCallback(() => {
    const chatId = chats.activeId;
    for (const [replyId, live] of liveRef.current) {
      if (live.chatId !== chatId) continue;
      live.controller.abort();
      liveRef.current.delete(replyId);
    }
    // A render is six Chrome workers; stopping has to reach the server, not
    // just stop the page from watching.
    const lesson = lessonRef.current;
    if (lesson) {
      void fetch(`/api/lesson?id=${encodeURIComponent(lesson)}`, { method: "DELETE" }).catch(() => {});
    }
  }, [chats.activeId]);

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
    async (
      raw?: string,
      history?: TutorChatMessage[],
      files?: Attachment[],
      pointedAt?: Mention[]
    ) => {
      const text = (raw ?? draft).trim();
      const attachments = files ?? pending;
      const pointed = pointedAt ?? mentions;
      if (!text && attachments.length === 0) return;

      if (lessonBusy || activeStreaming) return;

      // Asking is a deliberate move to the end of the thread, whatever you
      // had scrolled back to read.
      stick.current = true;
      placedAt.current = scrollRef.current?.scrollTop ?? 0;

      /*
       * Everything below writes to this id rather than "the active chat".
       * Opening another conversation mid-reply is an obvious thing to do while
       * waiting, and the rest of the answer belongs where it was asked.
       */
      const chatId = chats.activeId || chats.startChat();
      // Read the live thread from the store rather than this render's copy, so
      // a turn that finished a moment ago is already in it.
      const base = history ?? peekTutorMessages(chatId);

      const next: TutorChatMessage[] = [
        ...base,
        {
          id: `u${Date.now()}`,
          role: "user",
          text,
          attachments: attachments.length ? attachments : undefined,
          mentions: pointed.length ? pointed : undefined,
        },
      ];
      const replyId = `a${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      // Files are matched by modification time against this mark, so a reply
      // can only ever show what appeared while it was actually running.
      const turnStartedAt = Date.now();
      const controller = new AbortController();
      chats.updateMessages(chatId, () => [...next, { id: replyId, role: "assistant", text: "" }]);
      setDraft("");
      setPending([]);
      setMentions([]);
      closeMentions();
      replyChatRef.current.set(replyId, chatId);
      setStreamingReplyIds((prev) => new Set(prev).add(replyId));
      setError(null);

      liveRef.current.set(replyId, { controller, chatId });

      const clearLive = () => {
        liveRef.current.delete(replyId);
        replyChatRef.current.delete(replyId);
        setStreamingReplyIds((prev) => {
          if (!prev.has(replyId)) return prev;
          const nextIds = new Set(prev);
          nextIds.delete(replyId);
          return nextIds;
        });
      };

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
            focus: buildMentionFocus(s, counselor.essays, pointed) || undefined,
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
        const parse = createEventParser();
        let acc = "";
        let reasoning = "";
        let steps: TutorStep[] = [];
        let streamError: string | null = null;
        const startedAt = new Map<string, number>();
        const turnBegan = Date.now();

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          let touchedText = false;
          for (const event of parse(decoder.decode(value, { stream: true }))) {
            switch (event.t) {
              case "delta":
                acc += event.v;
                touchedText = true;
                break;
              case "reasoning":
                reasoning += event.v;
                break;
              case "tool":
                startedAt.set(event.label, Date.now());
                steps = [...steps, { label: event.label, state: "run" }];
                break;
              case "tool_done": {
                const began = startedAt.get(event.label);
                const secs = began ? (Date.now() - began) / 1000 : undefined;
                // Close the first still-running step with this label, so a
                // tool called twice doesn't have both entries resolve at once.
                let hit = false;
                steps = steps.map((step) => {
                  if (hit || step.label !== event.label || step.state !== "run") return step;
                  hit = true;
                  return { ...step, state: event.ok ? "ok" : "fail", secs };
                });
                break;
              }
              case "error":
                streamError = event.v;
                break;
              case "step":
              case "done":
                break;
            }
          }

          // Action, quiz, document, and graph tags are stripped as they stream in so the student never sees the raw syntax.
          const shown = touchedText
            ? stripTutorGraph(stripTutorDocument(stripTutorQuiz(stripTutorActions(acc))))
            : null;
          chats.updateMessages(chatId, (prev) =>
            prev.map((m) =>
              m.id === replyId
                ? {
                    ...m,
                    ...(shown === null ? {} : { text: shown }),
                    work: { reasoning: tidyReasoning(reasoning), steps },
                  }
                : m
            )
          );
        }

        // Anything still spinning when the stream ends did finish — the model
        // moved on, it just never said so.
        steps = steps.map((step) => (step.state === "run" ? { ...step, state: "ok" as const } : step));

        if (!acc.trim()) throw new Error(streamError ?? "Empty response from tutor.");

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
                  work:
                    reasoning || steps.length
                      ? {
                          reasoning: tidyReasoning(reasoning),
                          steps,
                          secs: (Date.now() - turnBegan) / 1000,
                          done: true,
                        }
                      : undefined,
                }
              : m
          )
        );

        // Opens the same way Claude surfaces a freshly-made artifact — on
        // screen already, not just a chip waiting to be noticed. A document
        // wins if a reply somehow produced both; only one panel shows at once.
        // Only auto-open when this chat is still the one being watched.
        if (chats.activeId === chatId) {
          if (doc) setOpenArtifact({ kind: "document", messageId: replyId });
          else if (quiz) setOpenArtifact({ kind: "quiz", messageId: replyId });
        }

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
        clearLive();
      } catch (e) {
        // Stopping is something the student did on purpose, not a failure.
        const aborted = e instanceof DOMException && e.name === "AbortError";
        if (!aborted) setError(e instanceof Error ? e.message : "Something went wrong.");
        clearLive();
        // Keep whatever arrived; drop the bubble only if nothing did.
        chats.updateMessages(chatId, (prev) => prev.filter((m) => m.id !== replyId || m.text));
      } finally {
        if (liveRef.current.has(replyId)) clearLive();
      }
    },
    [
      activeStreaming,
      applyAction,
      beginImage,
      beginLesson,
      buildContext,
      closeMentions,
      counselor.essays,
      mentions,
      s,
      chats,
      draft,
      effort,
      lessonBusy,
      model,
      pending,
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
      if (composerLocked || !chats.activeId) return;
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
    [chats, composerLocked, messages, send]
  );

  /**
   * Rephrase a question. The turn is lifted back into the composer and the
   * thread rewinds to just before it, so the follow-ups that were answers to
   * the old wording don't linger under the new one.
   */
  const editAsk = useCallback(
    (messageId: string) => {
      if (composerLocked || !chats.activeId) return;
      const at = messages.findIndex((m) => m.id === messageId);
      if (at < 0) return;
      setDraft(messages[at].text);
      setPending(messages[at].attachments ?? []);
      chats.updateMessages(chats.activeId, () => messages.slice(0, at));
      composerRef.current?.focus();
    },
    [chats, composerLocked, messages]
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
        busyChatIds={busyChatIds}
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

        <div className="gpt-thread" ref={scrollRef} onScroll={onThreadScroll}>
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
                  {starters.map((q) => (
                    <button
                      key={q.label}
                      type="button"
                      className="gpt-starter"
                      onClick={() => send(q.ask)}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m) => {
              // Actions belong to a finished reply. Offering Retry on half an
              // answer would throw away the half that had already arrived.
              const streaming = streamingReplyIds.has(m.id);

              /*
               * The assistant's message is created empty and filled as the
               * reply streams in. It still gets a row from the first frame,
               * because the work panel's head is what stands in for the old
               * typing indicator; a message with nothing in it and nothing
               * coming is the only one skipped.
               */
              const hasText =
                !!m.text || !!m.attachments?.length || !!m.mentions?.length || !!m.actions?.length;
              const drawingImage = imagePendingIds.has(m.id);
              const working =
                streaming || Boolean(m.work && (m.work.reasoning || m.work.steps.length > 0));
              if (
                !hasText && !working && !m.quiz && !m.lesson && !m.document && !m.graph && !m.image && !drawingImage
              ) {
                return null;
              }

              const rating = rated[m.id];

              if (m.role === "user") {
                return (
                  <div key={m.id} className="gpt-turn gpt-turn--user">
                    <div className="gpt-bubble">
                      {((m.attachments?.length ?? 0) > 0 || (m.mentions?.length ?? 0) > 0) && (
                        <div className="gpt-bubble-files">
                          {/* Kept on the turn so scrolling back shows what the
                              question was actually about, not just its words. */}
                          {m.mentions?.map((mention) => (
                            <span
                              key={`${mention.kind}:${mention.id}`}
                              className={`mention-chip is-${mention.kind} is-static`}
                              style={
                                mention.color
                                  ? ({ "--chip": mention.color } as React.CSSProperties)
                                  : undefined
                              }
                              title={mention.detail}
                            >
                              <span className="truncate">{mention.label}</span>
                            </span>
                          ))}
                          {m.attachments?.map((a) => (
                            <AttachmentChip key={a.id} attachment={a} />
                          ))}
                        </div>
                      )}
                      {m.text ? <MathText text={m.text} /> : null}
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
                        disabled={composerLocked}
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
                  {working && (
                    /* Shown from the first frame of the reply, before any
                       reasoning or tool call has arrived — it is what tells
                       you the tutor heard you. */
                    <TutorWorkPanel work={m.work ?? EMPTY_WORK} live={streaming} />
                  )}
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
                        disabled={composerLocked}
                        onClick={() => retry(m.id)}
                      />
                    </div>
                  )}
                </div>
              );
            })}

            {error && <div className="gpt-error">{error}</div>}
          </div>
        </div>

        <div className="gpt-composer-dock">
          <form
            className="gpt-composer"
            onSubmit={(e) => {
              e.preventDefault();
              if (!composerLocked) void send();
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const files = filesFromDataTransfer(e.dataTransfer);
              if (canAttach && files.length) addFiles(files);
            }}
          >
            {mentionOpen && (
              <MentionMenu
                items={mentionMatches}
                active={mentionIndex}
                loading={loadingMaterials}
                grouped={mentionQuery === ""}
                onPick={pickMention}
                onHover={setMentionIndex}
              />
            )}

            {(pending.length > 0 || mentions.length > 0) && (
              <div className="gpt-composer-files">
                {mentions.map((m) => (
                  <button
                    key={`${m.kind}:${m.id}`}
                    type="button"
                    className={`mention-chip is-${m.kind}`}
                    style={m.color ? ({ "--chip": m.color } as React.CSSProperties) : undefined}
                    onClick={() => removeMention(m)}
                    title={`${m.label}${m.detail ? ` — ${m.detail}` : ""} · click to remove`}
                  >
                    <span className="truncate">{m.label}</span>
                    <Icon path={ICON.close} size={9} />
                  </button>
                ))}
                {pending.map((a) => (
                  <AttachmentChip key={a.id} attachment={a} onRemove={() => removePending(a.id)} />
                ))}
              </div>
            )}

            <textarea
              ref={composerRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                const next = readMentionQuery(e.target);
                setMentionQuery(next);
                if (next !== mentionQuery) setMentionIndex(0);
              }}
              onClick={(e) => setMentionQuery(readMentionQuery(e.currentTarget))}
              onBlur={closeMentions}
              onKeyDown={(e) => {
                /*
                 * While the menu is open it owns the arrows, tab and enter —
                 * enter has to pick the highlighted item rather than send a
                 * half-typed "@lab" as the question.
                 */
                if (mentionOpen && mentionMatches.length) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setMentionIndex((i) => (i + 1) % mentionMatches.length);
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
                    return;
                  }
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    pickMention(mentionMatches[mentionIndex] ?? mentionMatches[0]);
                    return;
                  }
                }
                if (e.key === "Escape" && mentionOpen) {
                  e.preventDefault();
                  closeMentions();
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (!composerLocked) void send();
                }
              }}
              onPaste={(e) => {
                if (canAttach) takePasteFiles(e, (files) => void addFiles(files));
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

              {/* Dictation. The text arrives a moment after you stop, so the
                  button holds a spinner through that gap rather than looking
                  like the recording was thrown away. */}
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

              {/* One button in two states. While a reply streams it stops it —
                  a send button greyed out for the whole answer leaves no way
                  to take back a question you'd rather rephrase. */}
              <button
                type={composerLocked ? "button" : "submit"}
                className="gpt-send"
                onClick={composerLocked ? stop : undefined}
                aria-label={composerLocked ? "Stop" : "Send"}
                title={composerLocked ? "Stop generating" : "Send"}
                disabled={!composerLocked && !draft.trim() && pending.length === 0}
              >
                <Icon path={composerLocked ? ICON.stop : ICON.arrowUp} size={composerLocked ? 13 : 19} />
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
            busy={composerLocked}
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
  busyChatIds,
  onClose,
  onNew,
  onOpen,
  onDelete,
  onRename,
}: {
  chats: TutorChat[];
  activeId: string;
  busyChatIds: ReadonlySet<string>;
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
                      {busyChatIds.has(chat.id) ? "replying…" : whenLabel(chat.updatedAt)}
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

/**
 * What the tutor did before it answered.
 *
 * Collapsed to one line by default and expandable, because the two states are
 * asked for at different moments: while it works you want to know that
 * something is happening and roughly what, and afterwards you occasionally
 * want to know how it got there. Neither is worth a wall of text in the way
 * of the answer.
 *
 * Reasoning is only shown for models that actually expose it — most don't, and
 * an empty "Thinking" section on every reply would train you to ignore it.
 */
/** Stand-in for a reply that has not reported anything yet. */
const EMPTY_WORK: TutorWork = { reasoning: "", steps: [] };

function TutorWorkPanel({ work, live }: { work: TutorWork; live: boolean }) {
  /*
   * Closed until you ask for it, working or not.
   *
   * Opening itself mid-reply put a block of the model's private deliberation
   * exactly where the answer was about to appear, and then moved the answer
   * down as the reasoning grew. The one-line summary is enough to see that
   * something is happening and what.
   */
  const [open, setOpen] = useState(false);

  // Nothing to open until the model has exposed something. Most of a short
  // reply on a model with no reasoning summary is spent in this state.
  const hasDetail = work.steps.length > 0 || Boolean(work.reasoning);

  const running = work.steps.filter((s) => s.state === "run");

  const summary = live
    ? (running[0]?.label ?? (work.reasoning ? "Thinking" : "Working"))
    : work.steps.length > 0
      ? `Used ${work.steps.length} ${work.steps.length === 1 ? "tool" : "tools"}`
      : "Thought about it";

  return (
    <div className={`tutor-work${open && hasDetail ? " is-open" : ""}`}>
      <button
        type="button"
        className="tutor-work-head"
        onClick={() => setOpen((v) => !v)}
        disabled={!hasDetail}
      >
        {live ? <Spinner size={11} /> : <Icon path={ICON.check} size={11} />}
        <span className="tutor-work-summary">{summary}</span>
        {!live && work.secs != null && <span className="tutor-work-time">{work.secs.toFixed(1)}s</span>}
        {hasDetail && (
          <Icon
            path={ICON.chevronDown}
            size={11}
            style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .18s" }}
          />
        )}
      </button>

      {open && hasDetail && (
        <div className="tutor-work-body">
          {work.steps.map((step, i) => (
            <div key={`${step.label}-${i}`} className={`tutor-step is-${step.state}`}>
              <span className="tutor-step-dot" />
              <span className="truncate" style={{ flex: 1 }}>
                {step.label}
              </span>
              {/* A provider-executed tool "returns" the instant it is called,
                  so anything this fast is an artefact of how it was reported
                  rather than how long it took. */}
              {step.secs != null && step.secs >= 0.5 && (
                <span className="tutor-step-secs">{step.secs.toFixed(1)}s</span>
              )}
            </div>
          ))}

          {/* Only models that expose reasoning have any, so this section is
              absent rather than empty on the ones that don't. */}
          {work.reasoning && (
            <div className="tutor-reasoning">
              <span className="section-label" style={{ fontSize: 10 }}>
                Its reasoning
              </span>
              <p>{work.reasoning}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
