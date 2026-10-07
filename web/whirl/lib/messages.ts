"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { useMutation, useQuery } from "@whirl/backend/react";
import { currentNewChatTarget } from "@whirl/lib/agents";
import type { ApprovalAction, ApprovalStatus } from "@/lib/agent/types";
import type { Learned } from "@/lib/learning/types";
import { api } from "@whirl/backend/convex/_generated/api";
import type { Id } from "@whirl/backend/convex/_generated/dataModel";

import { stopAssistantStream } from "./assistant-stream";
import type { AttachmentUpload } from "./attachments";
import type { ChartSpec } from "./chart-spec";
import {
  useCachedThreadMessages,
  writeThreadMessageCache,
} from "./message-cache";
import { reconcileMessageIdentities } from "./message-identity";
import { isCustomModelKey, type ThinkingLevel } from "./models";
import { reportFrontendPerformance } from "./performance";
import { ANALYTICS_EVENTS, captureEvent } from "./posthog";
import type { QuestionAnswer, QuestionSpec } from "./questions";

/* The chat data layer: sending, subscribing, stopping, retrying. The wire
   protocol (see convex/messages.ts): sendUserMessage writes the user row
   plus an empty assistant row and schedules the server-driven turn itself —
   this tab does nothing to keep generation alive (W-134). The reply streams
   in through the reactive getStreamBody query; final text lands on the
   message row when the turn completes, and phases (reasoning, tools) update
   reactively the whole way. */

export type MessageStatus =
  "thinking" | "searching" | "streaming" | "complete" | "stopped" | "error";

export type MessageAttachment = {
  id: string;
  name: string;
  size: number;
  type: string;
  url?: string;
  text?: string;
  skippedReason?: string;
};

export type WeatherHour = {
  time: string;
  temp: number;
  code: number;
  precipProb?: number;
};

export type WeatherDay = {
  date: string;
  code: number;
  max: number;
  min: number;
  precipProb?: number;
  sunrise?: string;
  sunset?: string;
};

export type SearchSource = {
  url: string;
  title: string;
  author?: string;
  publishedDate?: string;
};

export type CalcItem = {
  expression?: string;
  result?: string;
  expressionTex?: string;
  resultTex?: string;
  needsLatex?: boolean;
  error?: string;
  label?: string;
};

/* The backend's phase union is wide (convex/validators.ts); the thread
   view renders the common shape plus the typed payloads it has widgets
   for (weather cards, document/html artifacts) and ignores the rest. */
export type MessagePhase = {
  kind: string;
  pending?: boolean;
  error?: string;
  ok?: boolean;
  text?: string;
  durationMs?: number;
  query?: string;
  sources?: number;
  items?: SearchSource[] | CalcItem[];
  contentOffset?: number;
  server?: string;
  tool?: string;
  /** Store-configured MCP lifecycle copy, snapshotted by the backend. */
  action?: string;
  completed?: string;
  name?: string;
  matches?: number;
  expression?: string;
  result?: string;
  expressionTex?: string;
  resultTex?: string;
  needsLatex?: boolean;
  label?: string;
  /* Weather — the whole widget rides in the phase (no table behind it). */
  place?: string;
  approximate?: boolean;
  timezone?: string;
  tempUnit?: "C" | "F";
  windUnit?: "km/h" | "mph";
  temp?: number;
  apparentTemp?: number;
  humidity?: number;
  windSpeed?: number;
  code?: number;
  isDay?: boolean;
  hourly?: WeatherHour[];
  daily?: WeatherDay[];
  /* Charts (the createChart tool) — the whole spec rides in the phase, so
     the card can draw the moment the row lands (see lib/chart-spec.ts). */
  chart?: ChartSpec;
  /* Generated images (the paint tool) — storage URLs land on the phase
     once the worker finishes; `pending` covers the painting stretch. */
  prompt?: string;
  images?: string[];
  count?: number;
  /* Documents and HTML artifacts — pointers into their Convex tables;
     the cards read the live rows by id. */
  op?: "create" | "edit";
  documentId?: string;
  htmlId?: string;
  mode?: "inline" | "full";
  title?: string;
  editCount?: number;
  /* Question forms (askUserQuestion) — the asked steps, and the recorded
     answers once the user submits through the composer's form face. */
  questions?: QuestionSpec[];
  answers?: QuestionAnswer[];
  answered?: boolean;
  /* The agent layer (Slates): what an agent did mid-reply. `agentTool` is a
     shell command, file edit, browser step or Slates tool; the rest are
     cards — a draft waiting for approval, a file sent to the student's
     devices, a voice memo, a handoff to a teammate, a note it learned, or
     a notice from the host. */
  eventId?: string;
  detail?: string;
  status?: "running" | "done" | "error" | ApprovalStatus;
  approval?: ApprovalAction;
  file?: string;
  size?: number;
  note?: string;
  transcript?: string;
  from?: string;
  to?: string;
  tone?: "info" | "error";
  learned?: Learned[];
};

/** Who wrote a reply, in the agent layer. */
export type MessageAgent = { id: string; name: string; hue: number };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  /** Ciphertext when `sealed` — opened by the tab holding the thread's key
   *  (lib/locked/use-locked-thread.ts), never rendered as-is. */
  content: string;
  sealed?: boolean;
  createdAt: number;
  status?: MessageStatus;
  phases?: MessagePhase[];
  streamId?: string;
  model?: string;
  thinking?: boolean;
  search?: boolean;
  attachments?: MessageAttachment[];
  /* Reply bookkeeping for the "Show stats" chips — provider completion
     tokens (reasoning included), wall-clock generation time, and the USD
     usage charge. Absent on user rows and replies that never finished. */
  outputTokens?: number;
  durationMs?: number;
  usageCost?: number;
  /** Client-decorated marker persisted in the transcript cache. */
  compactedAt?: number;
  /** The agent that wrote this reply (group chats have several). */
  agent?: MessageAgent;
};

export type CompactionSnapshot = {
  compactionMarkers?: Array<{ messageId: string; createdAt: number }>;
  compactionBoundary?: string | null;
  compactionUpdatedAt?: number | null;
};

export function decorateCompactionMarkers(
  messages: ChatMessage[],
  snapshot?: CompactionSnapshot,
): ChatMessage[] {
  if (!snapshot) return messages;
  const markers = new Map<string, number>();
  for (const marker of snapshot.compactionMarkers ?? []) {
    markers.set(marker.messageId, marker.createdAt);
  }
  if (
    markers.size === 0 &&
    snapshot.compactionBoundary &&
    snapshot.compactionUpdatedAt
  ) {
    markers.set(snapshot.compactionBoundary, snapshot.compactionUpdatedAt);
  }
  if (markers.size === 0) return messages;
  return messages.map((message) => {
    const compactedAt = markers.get(message.id);
    return compactedAt ? { ...message, compactedAt } : message;
  });
}

export const TERMINAL_STATUSES: ReadonlySet<MessageStatus> = new Set([
  "complete",
  "stopped",
  "error",
]);

export function isTerminal(status: MessageStatus | undefined): boolean {
  return status === undefined || TERMINAL_STATUSES.has(status);
}

/* Error sentinels the backend smuggles through `content` on status:
   "error" (convex/inference/billing.ts). */
const GATE_SENTINEL_PREFIX = "__AUTUMN_GATE__:";
const OVERLOAD_SENTINEL = "__SERVER_OVERLOAD__";

export type MessageError =
  | { kind: "gate"; feature: string }
  | { kind: "overload" }
  | { kind: "generic"; detail?: string };

/* Isolate/system errors read like stack traces to a person. Map the known
   technical shapes to plain language; anything else stays verbatim —
   provider errors are often genuinely readable ("model is overloaded"). */
function friendlyErrorDetail(detail: string): string {
  if (/ran out of memory|memory usage|out of memory/i.test(detail)) {
    return "That message was too heavy to process — a large attachment is the usual cause. Try a smaller file, or send it on its own.";
  }
  if (/JavaScript execution|InternalServerError|stack trace/i.test(detail)) {
    return "The server hit a snag on that one. Try again?";
  }
  return detail;
}

export function parseMessageError(content: string): MessageError {
  if (content.startsWith(GATE_SENTINEL_PREFIX)) {
    return {
      kind: "gate",
      feature: content.slice(GATE_SENTINEL_PREFIX.length),
    };
  }
  if (content === OVERLOAD_SENTINEL) return { kind: "overload" };
  return {
    kind: "generic",
    detail: content ? friendlyErrorDetail(content) : undefined,
  };
}

/* ---- Pending sends -------------------------------------------------- */

/* The mutation returns real ids; until the reactive query echoes those
   rows back this bridge keeps the just-sent turn on screen. Module-level
   (mirrors lib/toasts.ts) so a settings round-trip can't drop it. */

type PendingSend = {
  threadId: string;
  user: ChatMessage;
  assistant: ChatMessage;
};

let pendingSends = new Map<string, PendingSend>();
const pendingListeners = new Set<() => void>();

function emitPending() {
  pendingSends = new Map(pendingSends);
  for (const listener of pendingListeners) listener();
}

function registerPendingSend(send: PendingSend) {
  pendingSends.set(send.threadId, send);
  emitPending();
}

/* Exported for the incognito exit path — a purged thread's echo never
   arrives, so its bridge entry has to be dropped by hand. */
export function clearPendingSend(threadId: string) {
  if (!pendingSends.has(threadId)) return;
  pendingSends.delete(threadId);
  emitPending();
}

const EMPTY_PENDING = new Map<string, PendingSend>();

function usePendingSend(threadId: string | undefined): PendingSend | undefined {
  const sends = useSyncExternalStore(
    (onStoreChange) => {
      pendingListeners.add(onStoreChange);
      return () => pendingListeners.delete(onStoreChange);
    },
    () => pendingSends,
    () => EMPTY_PENDING,
  );
  return threadId ? sends.get(threadId) : undefined;
}

/* ---- Subscriptions -------------------------------------------------- */

/* Server messages for a thread, with the just-sent pending turn merged in
   until the server echoes it. While the query is in flight, the cached
   transcript (lib/message-cache.ts) stands in — a revisited thread paints
   on the first frame — and a brand-new chat paints its pending turn.
   `undefined` only when there's truly nothing to show yet. */
export function useThreadMessages(
  threadId: string | undefined,
  enabled = true,
  /** Incognito transcripts pass false: an ephemeral chat must never be
   *  snapshotted into (or painted from) the localStorage cache. */
  cacheable = true,
  compaction?: CompactionSnapshot,
): ChatMessage[] | undefined {
  const raw = useQuery(
    api.messages.listForThread,
    threadId && enabled ? { threadId: threadId as Id<"threads"> } : "skip",
  ) as ChatMessage[] | undefined;
  const pending = usePendingSend(threadId);
  const cached = useCachedThreadMessages(cacheable ? threadId : undefined);

  /* Server caught up — drop the bridge (in an effect; render stays pure). */
  const echoed =
    raw !== undefined &&
    pending !== undefined &&
    raw.some((message) => message.id === pending.user.id) &&
    raw.some((message) => message.id === pending.assistant.id);
  useEffect(() => {
    if (echoed) clearPendingSend(pending.threadId);
  }, [echoed, pending?.threadId]);

  /* Write-through once the thread is settled — never mid-generation, so a
     half-streamed reply can't resurrect from the cache. */
  const decoratedRaw = useMemo(
    () => (raw ? decorateCompactionMarkers(raw, compaction) : raw),
    [raw, compaction],
  );
  useEffect(() => {
    if (
      !cacheable ||
      !threadId ||
      !decoratedRaw ||
      computeIsGenerating(decoratedRaw) ||
      /* A locked thread's rows are ciphertext and its transcript is opened
         in memory, so nothing would ever read this back — and a cache full
         of base64 is a cache that can only ever be painted by mistake. */
      decoratedRaw.some((message) => message.sealed)
    )
      return;
    writeThreadMessageCache(threadId, decoratedRaw);
  }, [cacheable, threadId, decoratedRaw]);

  const merged = useMemo(() => {
    if (decoratedRaw === undefined) {
      if (pending) return [pending.user, pending.assistant];
      if (cached) return decorateCompactionMarkers(cached, compaction);
      return undefined;
    }
    if (!pending) return decoratedRaw;
    const ids = new Set(decoratedRaw.map((message) => message.id));
    const next = [...decoratedRaw];
    if (!ids.has(pending.user.id)) next.push(pending.user);
    if (!ids.has(pending.assistant.id)) next.push(pending.assistant);
    return next;
  }, [decoratedRaw, pending, cached, compaction]);

  /* Carry unchanged rows across snapshots by reference (lib/message-identity)
     so the transcript's memoized rows can skip the history on every update.

     Reconciling needs the *previous* result, which is the one thing useMemo
     cannot hand itself — so the previous result is parked in a ref. The ref
     is written on commit and only read here, which means the baseline is
     always a transcript that actually reached the screen: a render React
     replays or throws away (StrictMode, Suspense, a cancelled transition)
     can no longer become the thing the next one is diffed against. The memo
     keeps the walk itself off every unrelated re-render.

     The read below is the one thing left that render does with a ref, and it
     is safe in the way the rule cares about: the worst a replayed render can
     do is diff against an older committed snapshot and reuse fewer
     references, which is slower, never wrong. Doing it in an effect instead
     would ship one unreconciled snapshot to the transcript on every stream
     tick — the whole thread re-rendering per token, which is the exact cost
     this function exists to avoid. */
  const committedRef = useRef<ChatMessage[] | undefined>(undefined);
  const stable = useMemo(
    () =>
      merged === undefined
        ? undefined
        : // eslint-disable-next-line react-hooks/refs -- see above.
          reconcileMessageIdentities(committedRef.current, merged),
    [merged],
  );
  useEffect(() => {
    committedRef.current = stable;
  }, [stable]);
  return stable;
}

export function computeIsGenerating(
  messages: ChatMessage[] | undefined,
): boolean {
  return Boolean(
    messages?.some(
      (message) => message.role === "assistant" && !isTerminal(message.status),
    ),
  );
}

/* ---- Actions -------------------------------------------------------- */

export type SendMessageArgs = {
  threadId?: string;
  text: string;
  /* Tier key or admin-catalog slug — both go over the wire as-is; the
     server resolves slugs against the catalog and quietly runs Auto if
     the model has since been removed. */
  model: string;
  attachments: AttachmentUpload[];
  search: boolean;
  thinking: ThinkingLevel;
  /* Ephemeral thread: the server flags it so listings, memory, search,
     and title generation all skip it, and it purges on exit. */
  incognito?: boolean;
  /* @mentions, already resolved to ids by the composer. The server
     verifies ownership and preloads: integration tools, skill text. */
  integrations?: { serverId: string; name: string }[];
  skills?: { installId: string; name: string }[];
};

const WIRE_MODEL_KEYS = ["Auto", "Fast", "Basic", "Max", "Image"] as const;

/* Catalog slugs ride verbatim; anything else must be a known tier key or
   it folds to Auto before it ever leaves the tab. */
function wireModel(model: string): string {
  if (isCustomModelKey(model)) return model;
  return WIRE_MODEL_KEYS.find((key) => key === model) ?? "Auto";
}

export function useMessageActions() {
  const sendUserMessage = useMutation(api.messages.sendUserMessage);
  const resetAssistantMessage = useMutation(api.messages.resetAssistantMessage);
  const prepareRetryFromUser = useMutation(
    api.messages.prepareAssistantRetryFromUser,
  );
  const branchThreadMutation = useMutation(api.threads.branchThread);

  /* `withOptimisticUpdate` builds a fresh mutation on every call, so these
     four have to be memoized or every action below (and every callback
     derived from them, all the way down to the memoized transcript rows)
     gets a new identity on every render. `useMutation` itself is already
     memoized on the client, so the base is a sound dependency. */
  const updateUserMessageBase = useMutation(api.messages.updateUserMessage);
  const updateUserMessage = useMemo(
    () =>
      updateUserMessageBase.withOptimisticUpdate((store, args) => {
        const threadId = args.threadId;
        const current = store.getQuery(api.messages.listForThread, {
          threadId,
        });
        if (!current) return;
        store.setQuery(
          api.messages.listForThread,
          { threadId },
          current.map((message: ChatMessage) =>
            message.id === args.messageId
              ? { ...message, content: args.content }
              : message,
          ) as typeof current,
        );
      }),
    [updateUserMessageBase],
  );

  const rollbackThreadBase = useMutation(api.threads.rollbackToMessage);
  const rollbackThreadMutation = useMemo(
    () =>
      rollbackThreadBase.withOptimisticUpdate((store, args) => {
        const threadId = args.threadId;
        const current = store.getQuery(api.messages.listForThread, {
          threadId,
        });
        if (!current) return;
        const checkpoint = current.findIndex(
          (message: ChatMessage) => message.id === args.messageId,
        );
        if (checkpoint === -1) return;
        store.setQuery(
          api.messages.listForThread,
          { threadId },
          current.slice(0, checkpoint + 1) as typeof current,
        );
      }),
    [rollbackThreadBase],
  );

  const updateAssistantMessageBase = useMutation(
    api.messages.updateAssistantMessage,
  );
  const updateAssistantMessage = useMemo(
    () =>
      updateAssistantMessageBase.withOptimisticUpdate((store, args) => {
        const threadId = args.threadId;
        const current = store.getQuery(api.messages.listForThread, {
          threadId,
        });
        if (!current) return;
        store.setQuery(
          api.messages.listForThread,
          { threadId },
          current.map((message: ChatMessage) =>
            message.id === args.messageId
              ? {
                  ...message,
                  ...(args.content !== undefined
                    ? { content: args.content }
                    : {}),
                  ...(args.status ? { status: args.status } : {}),
                }
              : message,
          ) as typeof current,
        );
      }),
    [updateAssistantMessageBase],
  );

  /* Optimistic so the thread card settles (and the composer's form face
     stands down) the instant Done is clicked, not a round trip later. */
  const answerQuestionPhaseBase = useMutation(api.messages.answerQuestionPhase);
  const answerQuestionPhase = useMemo(
    () =>
      answerQuestionPhaseBase.withOptimisticUpdate((store, args) => {
        const threadId = args.threadId;
        const current = store.getQuery(api.messages.listForThread, {
          threadId,
        });
        if (!current) return;
        store.setQuery(
          api.messages.listForThread,
          { threadId },
          current.map((message: ChatMessage) =>
            message.id === args.messageId
              ? {
                  ...message,
                  phases: message.phases?.map((phase) =>
                    phase.kind === "question" && !phase.answered
                      ? { ...phase, answers: args.answers, answered: true }
                      : phase,
                  ),
                }
              : message,
          ) as typeof current,
        );
      }),
    [answerQuestionPhaseBase],
  );

  /* Send and bridge the new turn — the backend drives the stream. Returns
     the (possibly freshly created) thread id so callers can navigate to it. */
  const send = useCallback(
    async ({
      threadId,
      text,
      model,
      attachments,
      search,
      thinking,
      incognito,
      integrations,
      skills,
    }: SendMessageArgs): Promise<string> => {
      const startedAt = performance.now();
      let result;
      try {
        result = await sendUserMessage({
          threadId: threadId ? (threadId as Id<"threads">) : undefined,
          // A new chat goes to whoever the composer's agent picker names.
          ...(threadId ? {} : { target: currentNewChatTarget() ?? undefined }),
          content: text,
          ...(incognito ? { incognito: true } : {}),
          ...(attachments.length > 0
            ? {
                attachments: attachments.map((file) => ({
                  id: file.id,
                  name: file.name,
                  size: file.size,
                  type: file.type,
                  storageId: file.storageId as Id<"_storage">,
                  ...(file.text !== undefined ? { text: file.text } : {}),
                  ...(file.skippedReason !== undefined
                    ? { skippedReason: file.skippedReason }
                    : {}),
                })),
              }
            : {}),
          ...(integrations && integrations.length > 0
            ? {
                integrations: integrations.map((mention) => ({
                  serverId: mention.serverId as Id<"mcpServers">,
                  name: mention.name,
                })),
              }
            : {}),
          ...(skills && skills.length > 0
            ? {
                skills: skills.map((mention) => ({
                  installId: mention.installId as Id<"skillInstalls">,
                  name: mention.name,
                })),
              }
            : {}),
          options: {
            thinking: thinking !== "none",
            search,
            model: wireModel(model),
          },
        });
      } catch (error) {
        const properties = {
          model: wireModel(model),
          new_thread: !threadId,
          attachment_count: attachments.length,
          search,
          thinking,
          incognito: Boolean(incognito),
        };
        captureEvent(ANALYTICS_EVENTS.messageSendFailed, properties);
        reportFrontendPerformance({
          operation: "message_create",
          outcome: "error",
          durationMs: performance.now() - startedAt,
          properties,
        });
        throw error;
      }

      const eventProperties = {
        model: wireModel(model),
        new_thread: !threadId,
        attachment_count: attachments.length,
        attachment_bytes: attachments.reduce(
          (total, attachment) => total + attachment.size,
          0,
        ),
        search,
        thinking,
        incognito: Boolean(incognito),
        text_length: text.length,
        integration_mention_count: integrations?.length ?? 0,
        skill_mention_count: skills?.length ?? 0,
      };
      captureEvent(ANALYTICS_EVENTS.messageSent, eventProperties);
      reportFrontendPerformance({
        operation: "message_create",
        outcome: "complete",
        durationMs: performance.now() - startedAt,
        properties: eventProperties,
      });

      const now = Date.now();
      registerPendingSend({
        threadId: result.threadId,
        user: {
          id: result.userMessageId,
          role: "user",
          content: text,
          createdAt: now,
          attachments: attachments.map((file) => ({
            id: file.id,
            name: file.name,
            size: file.size,
            type: file.type,
          })),
        },
        assistant: {
          id: result.assistantId,
          role: "assistant",
          content: "",
          createdAt: now + 1,
          status: thinking !== "none" ? "thinking" : "streaming",
          streamId: result.streamId,
          model: wireModel(model),
          thinking: thinking !== "none",
          search,
        },
      });
      return result.threadId;
    },
    [sendUserMessage],
  );

  /* Wipe an errored/stopped reply and run it again on a fresh stream. */
  const retryAssistant = useCallback(
    async (threadId: string, messageId: string) => {
      await resetAssistantMessage({
        threadId: threadId as Id<"threads">,
        messageId: messageId as Id<"messages">,
      });
      captureEvent(ANALYTICS_EVENTS.generationRetried);
    },
    [resetAssistantMessage],
  );

  /* Rewrite a sent prompt in place, then regenerate the reply that
     follows it — an edit is a resend from that point in the timeline. */
  const editUserMessage = useCallback(
    async (threadId: string, messageId: string, content: string) => {
      await updateUserMessage({
        threadId: threadId as Id<"threads">,
        messageId: messageId as Id<"messages">,
        content,
      });
      await prepareRetryFromUser({
        threadId: threadId as Id<"threads">,
        userMessageId: messageId as Id<"messages">,
      });
      captureEvent(ANALYTICS_EVENTS.messageEdited, {
        text_length: content.length,
      });
    },
    [updateUserMessage, prepareRetryFromUser],
  );

  /* Copy the conversation up to a checkpoint into a fresh thread (the
     original stays put). Returns the new thread id for navigation. */
  const branchFromMessage = useCallback(
    async (threadId: string, messageId: string): Promise<string> => {
      const result = await branchThreadMutation({
        threadId: threadId as Id<"threads">,
        messageId: messageId as Id<"messages">,
      });
      captureEvent(ANALYTICS_EVENTS.threadBranched);
      return result.threadId;
    },
    [branchThreadMutation],
  );

  /* Delete everything after the checkpoint — messages, streams, and the
     artifacts those turns authored. Optimistically trimmed on screen. */
  const rollbackToMessage = useCallback(
    async (threadId: string, messageId: string) => {
      await rollbackThreadMutation({
        threadId: threadId as Id<"threads">,
        messageId: messageId as Id<"messages">,
      });
      captureEvent(ANALYTICS_EVENTS.threadRolledBack);
    },
    [rollbackThreadMutation],
  );

  /* Mark the in-flight reply stopped and abort our end of the stream —
     whatever text already landed stays. */
  const stopAssistant = useCallback(
    (threadId: string, messages: ChatMessage[]) => {
      const active = [...messages]
        .reverse()
        .find(
          (message) =>
            message.role === "assistant" && !isTerminal(message.status),
        );
      if (!active) return;
      const frozenText = active.streamId
        ? stopAssistantStream(active.streamId)
        : active.content;
      captureEvent(ANALYTICS_EVENTS.generationStopped, {
        had_content: active.content.length > 0,
      });
      return updateAssistantMessage({
        threadId: threadId as Id<"threads">,
        messageId: active.id as Id<"messages">,
        content: frozenText,
        status: "stopped",
      });
    },
    [updateAssistantMessage],
  );

  /* Stamp the user's form answers onto the asking message's question
     phase — the follow-up message itself goes out through send(). */
  const answerQuestion = useCallback(
    async (threadId: string, messageId: string, answers: QuestionAnswer[]) => {
      await answerQuestionPhase({
        threadId: threadId as Id<"threads">,
        messageId: messageId as Id<"messages">,
        answers,
      });
    },
    [answerQuestionPhase],
  );

  return useMemo(
    () => ({
      send,
      retryAssistant,
      stopAssistant,
      editUserMessage,
      branchFromMessage,
      rollbackToMessage,
      answerQuestion,
    }),
    [
      send,
      retryAssistant,
      stopAssistant,
      editUserMessage,
      branchFromMessage,
      rollbackToMessage,
      answerQuestion,
    ],
  );
}
