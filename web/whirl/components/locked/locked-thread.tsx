"use client";

import { memo, useCallback, useEffect } from "react";
import { useMutation } from "@whirl/backend/react";
import { api } from "@whirl/backend/convex/_generated/api";
import type { Id } from "@whirl/backend/convex/_generated/dataModel";

import { ThreadView } from "@whirl/components/thread/thread-view";
import { useIsThreadOpen } from "@whirl/lib/locked/keyring";
import {
  useLockedMessageActions,
  useLockedTranscript,
} from "@whirl/lib/locked/use-locked-thread";
import type { ChatMessage } from "@whirl/lib/messages";
import { NO_CAPTURE } from "@whirl/lib/replay-guard";
import { showToast } from "@whirl/lib/toasts";
import { cn } from "@whirl/lib/utils";
import { LockedGate } from "./locked-gate";

/* The transcript for a locked thread. The plaintext counterpart to
   chat-view's LiveThread, and the same shape: a subscription that can throw
   lives in here so the error boundary above it catches, and the memo keeps
   the composer's own re-renders off the history.

   The differences are the whole feature. Bodies arrive sealed and are
   opened in this tab; the reply in flight isn't in the database at all;
   and with no key, there is simply nothing to draw.

   Branching is absent, not disabled — a branch would land in a thread with
   no lock of its own. The backend refuses it too. */

export const LockedThread = memo(function LockedThread({
  threadId,
  onMessages,
}: {
  threadId: string;
  /** Reports upward so the composer can wear its Stop button, exactly as
   *  LiveThread does. */
  onMessages: (threadId: string, messages: ChatMessage[] | undefined) => void;
}) {
  const isOpen = useIsThreadOpen(threadId);
  const messages = useLockedTranscript(threadId);
  const actions = useLockedMessageActions();
  /* Rollback only ever deletes rows, so it reads nothing and works on
     ciphertext exactly as it does on prose — a locked thread keeps its
     checkpoint menu. */
  const rollback = useMutation(api.threads.rollbackToMessage);

  useEffect(() => {
    onMessages(threadId, isOpen ? messages : []);
  }, [threadId, messages, isOpen, onMessages]);

  const handleRetry = useCallback(
    (message: ChatMessage) => {
      void actions
        .retry(threadId, message, messages ?? [])
        .catch((error: unknown) =>
          showToast(
            error instanceof Error ? error.message : "Whirl cannot retry.",
          ),
        );
    },
    [actions, threadId, messages],
  );

  const handleEdit = useCallback(
    (message: ChatMessage, content: string) => {
      void actions
        .edit(threadId, message.id, content, messages ?? [])
        .catch((error: unknown) =>
          showToast(
            error instanceof Error
              ? error.message
              : "Whirl cannot save the change.",
          ),
        );
    },
    [actions, threadId, messages],
  );

  const handleRollback = useCallback(
    (message: ChatMessage) => {
      void rollback({
        threadId: threadId as Id<"threads">,
        messageId: message.id as Id<"messages">,
      }).catch(() =>
        showToast("Whirl cannot delete the messages. Try again."),
      );
    },
    [rollback, threadId],
  );

  if (!isOpen) return <LockedGate threadId={threadId} />;

  return (
    /* Masked as well as unrecorded: `useSuppressReplay` in the chat face is
       what actually stops the recorder, and this is the backstop for the
       frame where something starts it anyway. */
    <div className={cn("h-full min-h-0", NO_CAPTURE)}>
      <ThreadView
        messages={messages}
        contentClassName="pt-14"
        onRetryMessage={handleRetry}
        onEditMessage={handleEdit}
        onRollbackMessage={handleRollback}
      />
    </div>
  );
});
