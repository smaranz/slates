"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@whirl/backend/auth";
import { useMutation, useQuery } from "@whirl/backend/react";
import { api } from "@whirl/backend/convex/_generated/api";
import type { Id } from "@whirl/backend/convex/_generated/dataModel";

import { isTerminal, type ChatMessage } from "../messages";
import { ANALYTICS_EVENTS, captureEvent } from "../posthog";
import { isSealed, open, seal } from "./crypto";
import {
  readKey,
  readPlaintext,
  rememberPlaintext,
  useIsThreadOpen,
} from "./keyring";
import {
  clearLockedTurn,
  runLockedTurn,
  stopLockedTurn,
  useLockedTurns,
  type LockedTurnRequest,
} from "./stream";
import { lockedSendRejection, useLockedModelPolicy } from "./locked-models";
import { titleFromPrompt } from "./thread-lock";

/* Reading and writing a locked thread from the tab that holds its key.

   Two things make this different from the ordinary transcript:

     - Every body arrives sealed and has to be opened before it can be
       rendered. Openings are cached by ciphertext, so a Convex push that
       changes one row doesn't re-decrypt the other ninety-nine.
     - A reply in flight isn't in the database at all — it's in this tab's
       stream buffer (lib/locked/stream.ts), and gets merged onto its
       message row on the way past. */

const UNREADABLE = "_Whirl cannot decrypt this message._";

/**
 * The thread's messages, opened. `undefined` until the first pass finishes,
 * so nothing paints ciphertext for a frame.
 *
 * Rows keep their object identity whenever their opened text is unchanged —
 * the transcript's memoized rows depend on it, and a locked thread would
 * otherwise re-render its whole history on every push.
 */
export function useOpenedMessages(
  threadId: string | null,
  enabled: boolean,
): ChatMessage[] | undefined {
  const raw = useQuery(
    api.messages.listForThread,
    threadId && enabled ? { threadId: threadId as Id<"threads"> } : "skip",
  ) as ChatMessage[] | undefined;

  const [messages, setMessages] = useState<ChatMessage[] | undefined>(undefined);
  /* The last committed result, so an unchanged row can be handed back by
     reference instead of rebuilt. Written on commit, read in the async pass. */
  const previous = useRef<ChatMessage[] | undefined>(undefined);
  useEffect(() => {
    previous.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!threadId || !raw) {
      setMessages(undefined);
      return;
    }
    const key = readKey(threadId);
    if (!key) {
      setMessages(undefined);
      return;
    }

    let live = true;
    void (async () => {
      const byId = new Map(
        (previous.current ?? []).map((message) => [message.id, message]),
      );
      const next = await Promise.all(
        raw.map(async (message) => {
          let content = message.content;
          if (isSealed(content)) {
            const cached = readPlaintext(content);
            if (cached !== undefined) {
              content = cached;
            } else {
              try {
                const body = await open(key, content);
                rememberPlaintext(message.content, body);
                content = body;
              } catch {
                content = UNREADABLE;
              }
            }
          }
          const before = byId.get(message.id);
          if (before && before.content === content) return before;
          return { ...message, content };
        }),
      );
      if (live) setMessages(next);
    })();

    return () => {
      live = false;
    };
  }, [threadId, raw]);

  return messages;
}

/**
 * The transcript with the in-flight reply painted onto it.
 *
 * A locked reply exists nowhere but this tab until it finishes, so the row
 * the database has is empty and the text — and the reasoning, when the
 * thinking gate is on — is merged on here. The reasoning rides as an
 * ordinary pending `thought` phase, which is what the transcript already
 * knows how to draw; unlike every other thread's, it's never written down.
 */
export function useLockedTranscript(
  threadId: string | null,
): ChatMessage[] | undefined {
  const isOpen = useIsThreadOpen(threadId);
  const stored = useOpenedMessages(threadId, isOpen);
  const turns = useLockedTurns();

  return useMemo(() => {
    if (!stored || turns.size === 0) return stored;
    let touched = false;
    const merged = stored.map((message) => {
      const turn = turns.get(message.id);
      if (!turn || isTerminal(message.status)) return message;
      touched = true;
      return {
        ...message,
        content: turn.text,
        ...(turn.reasoning
          ? {
              phases: [
                {
                  kind: "thought",
                  text: turn.reasoning,
                  contentOffset: 0,
                  // Settles the moment text starts arriving, same as the
                  // server-driven path's reasoning-end.
                  pending: !turn.started,
                },
              ] satisfies ChatMessage["phases"],
            }
          : {}),
      };
    });
    return touched ? merged : stored;
  }, [stored, turns]);
}

/* ---- sending -------------------------------------------------------- */

/** What the model is handed for one turn. The reply in flight is an empty
 *  row until it lands, so blank messages drop out rather than reaching the
 *  provider as a turn with nothing in it. */
function toWireMessages(messages: ChatMessage[]): LockedTurnRequest["messages"] {
  return messages
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

export type LockedSendArgs = {
  threadId: string;
  text: string;
  model: string;
  thinking: boolean;
  /** Data URLs for images picked this turn — never uploaded, never stored. */
  images?: string[];
  /** The transcript as it stands, already opened. */
  history: ChatMessage[];
};

export function useLockedMessageActions() {
  const { getToken } = useAuth();
  /* Retrying or editing reuses the model the row was written with, and that
     model may have lost its zero-retention endpoints since. Checked here so
     every path into a locked turn refuses the same way, not just the first
     send. */
  const policy = useLockedModelPolicy(true);
  const sendLockedMessage = useMutation(api.lockedThreads.sendLockedMessage);
  const finishLockedTurn = useMutation(api.lockedThreads.finishLockedTurn);
  const resetLockedTurn = useMutation(api.lockedThreads.resetLockedTurn);
  const editLockedMessage = useMutation(api.lockedThreads.editLockedMessage);

  /* Runs a turn end to end: stream it, seal what came back, store that.
     Shared by send, retry and edit, which differ only in how the assistant
     row came to exist.

     It never rejects. Whatever goes wrong — an expired session, a dead
     connection, a provider that hangs up — the row it was given gets a
     terminal status before this returns, because the alternative is a reply
     that shimmers until the watchdog cron notices three minutes later. */
  const drive = useCallback(
    async ({
      threadId,
      assistantId,
      key,
      model,
      thinking,
      messages,
      images,
    }: {
      threadId: string;
      assistantId: string;
      key: CryptoKey;
      model: string;
      thinking: boolean;
      messages: ChatMessage[];
      images?: string[];
    }) => {
      const rejection = lockedSendRejection(model, policy);
      let text = "";
      let failure: string | undefined = rejection ?? undefined;
      let stopped = false;
      let outputTokens: number | undefined;
      let durationMs: number | undefined;

      try {
        if (rejection) throw new Error(rejection);
        const token = await getToken({ template: "convex" });
        if (!token) throw new Error("Your session stopped. Sign in again.");

        const wire = toWireMessages(messages);
        const last = wire[wire.length - 1];
        if (last && images && images.length > 0) {
          wire[wire.length - 1] = { ...last, images };
        }

        const result = await runLockedTurn({
          threadId,
          assistantId,
          model,
          thinking,
          messages: wire,
          token,
        });
        text = result.text;
        failure = result.error;
        stopped = result.stopped === true;
        outputTokens = result.outputTokens;
        durationMs = result.durationMs;
      } catch (cause) {
        failure =
          cause instanceof Error
            ? cause.message
            : "Whirl cannot generate this reply. Try again.";
      }

      const hasText = text.trim().length > 0;
      // A reply that produced nothing at all is an error, whatever went
      // wrong; one that was cut off keeps its text and says it stopped.
      const status =
        failure && !hasText
          ? "error"
          : failure || stopped
            ? "stopped"
            : "complete";

      try {
        await finishLockedTurn({
          threadId: threadId as Id<"threads">,
          assistantId: assistantId as Id<"messages">,
          content: hasText ? await seal(key, text) : "",
          status,
          ...(status === "error"
            ? { errorMessage: failure ?? "This reply did not complete." }
            : {}),
          ...(outputTokens !== undefined ? { outputTokens } : {}),
          ...(durationMs !== undefined ? { durationMs } : {}),
        });
      } catch {
        /* Even the settle failed — the watchdog is the backstop for exactly
           this, and it'll reap the row within a few minutes. */
      }
      clearLockedTurn(assistantId);

      if (failure) {
        captureEvent(ANALYTICS_EVENTS.lockedTurnFailed, { had_text: hasText });
      }
      return { text, error: failure, stopped };
    },
    [getToken, finishLockedTurn, policy],
  );

  const send = useCallback(
    async ({
      threadId,
      text,
      model,
      thinking,
      images,
      history,
    }: LockedSendArgs) => {
      const key = readKey(threadId);
      if (!key) throw new Error("This chat is locked. Unlock it first.");

      const isFirst = history.length === 0;
      const { assistantId } = await sendLockedMessage({
        threadId: threadId as Id<"threads">,
        content: await seal(key, text),
        model,
        thinking,
        ...(isFirst
          ? { lockedTitle: await seal(key, titleFromPrompt(text)) }
          : {}),
      });

      captureEvent(ANALYTICS_EVENTS.lockedTurnSent, {
        model,
        thinking,
        image_count: images?.length ?? 0,
        text_length: text.length,
      });

      const outgoing: ChatMessage = {
        id: `pending:${assistantId}`,
        role: "user",
        content: text,
        createdAt: Date.now(),
      };
      /* Deliberately not awaited: what unblocks the composer is the message
         having left, not the reply having landed. Holding this promise open
         for the length of a turn would keep the send button spinning and
         the attachment tray full until the model finished. `drive` settles
         the row whatever happens, so nothing needs catching out here. */
      void drive({
        threadId,
        assistantId,
        key,
        model,
        thinking,
        messages: [...history, outgoing],
        ...(images && images.length > 0 ? { images } : {}),
      });
    },
    [sendLockedMessage, drive],
  );

  /** Run a settled reply again on the same row. */
  const retry = useCallback(
    async (threadId: string, message: ChatMessage, history: ChatMessage[]) => {
      const key = readKey(threadId);
      if (!key) throw new Error("This chat is locked. Unlock it first.");
      await resetLockedTurn({
        threadId: threadId as Id<"threads">,
        assistantId: message.id as Id<"messages">,
      });
      await drive({
        threadId,
        assistantId: message.id,
        key,
        /* Whatever the row was written with. A row with no model recorded
           is refused by the check in `drive` rather than guessed at. */
        model: message.model ?? "",
        thinking: message.thinking ?? false,
        // Everything up to (not including) the reply being regenerated.
        messages: history.slice(
          0,
          history.findIndex((row) => row.id === message.id),
        ),
      });
    },
    [resetLockedTurn, drive],
  );

  /** Rewrite a prompt and regenerate the reply that followed it. */
  const edit = useCallback(
    async (
      threadId: string,
      messageId: string,
      content: string,
      history: ChatMessage[],
    ) => {
      const key = readKey(threadId);
      if (!key) throw new Error("This chat is locked. Unlock it first.");
      await editLockedMessage({
        threadId: threadId as Id<"threads">,
        messageId: messageId as Id<"messages">,
        content: await seal(key, content),
      });

      const index = history.findIndex((row) => row.id === messageId);
      const reply = history
        .slice(index + 1)
        .find((row) => row.role === "assistant");
      if (!reply) return;

      const rewritten = history.map((row) =>
        row.id === messageId ? { ...row, content } : row,
      );
      await resetLockedTurn({
        threadId: threadId as Id<"threads">,
        assistantId: reply.id as Id<"messages">,
      });
      await drive({
        threadId,
        assistantId: reply.id,
        key,
        model: reply.model ?? "",
        thinking: reply.thinking ?? false,
        messages: rewritten.slice(0, index + 1),
      });
    },
    [editLockedMessage, resetLockedTurn, drive],
  );

  /** Cut the running reply off. The turn's own promise settles the row with
   *  whatever had painted, so there's nothing to write here. */
  const stop = useCallback((messages: ChatMessage[]) => {
    const live = [...messages]
      .reverse()
      .find(
        (message) => message.role === "assistant" && !isTerminal(message.status),
      );
    if (!live) return;
    stopLockedTurn(live.id);
    captureEvent(ANALYTICS_EVENTS.generationStopped, {
      had_content: live.content.length > 0,
    });
  }, []);

  return useMemo(
    () => ({ send, retry, edit, stop }),
    [send, retry, edit, stop],
  );
}
