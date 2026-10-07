"use client";

import { Component, memo, useCallback, useRef, type ReactNode } from "react";
import { IconAlertTriangleFilled, IconLoader2 } from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";

import { computeIsGenerating, type ChatMessage } from "@whirl/lib/messages";
import { EASE_OUT } from "@whirl/lib/motion";
import { MASK_TEXT } from "@whirl/lib/replay-guard";
import { useSendGlide } from "@whirl/lib/use-send-glide";
import { cn } from "@whirl/lib/utils";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@whirl/components/ui/message-scroller";
import { AssistantMessage } from "./assistant-message";
import { CompactionDivider } from "./compaction-divider";
import { UserMessage } from "./user-message";

/* The transcript: a message-scroller that opens at the live edge, pins
   itself there while replies stream, and anchors each fresh user turn to
   the top with a peek of what came before. Purely presentational — the
   live face (chat-view.tsx) feeds it Convex messages, the debug page
   feeds it fixtures.

   The tall bottom padding keeps the last turn clear of the translucent
   composer floating over this pane. It reads --dock-clearance (published
   by chat-view's dock observer) so a tall composer face — the question
   form — reserves real room instead of covering the transcript; the
   11rem floor keeps standalone uses (share viewer, debug) unchanged. */

const PREVIOUS_TURN_PEEK_PX = 72;
const EDGE_THRESHOLD_PX = 128;

export function ThreadView({
  messages,
  onRetryMessage,
  onEditMessage,
  onBranchMessage,
  onRollbackMessage,
  defaultScrollPosition = "end",
  contentClassName,
}: {
  /** `undefined` while the thread is still loading — draws the spinner. */
  messages: ChatMessage[] | undefined;
  onRetryMessage?: (message: ChatMessage) => void;
  /** Save an edited user prompt (and regenerate the reply after it). */
  onEditMessage?: (message: ChatMessage, content: string) => void;
  /** Branch the thread at an assistant reply into a fresh thread. */
  onBranchMessage?: (message: ChatMessage) => void;
  /** Delete everything after an assistant reply. */
  onRollbackMessage?: (message: ChatMessage) => void;
  /** Where the scroller opens: the live edge (default) or the top —
   *  a shared conversation reads from the beginning. */
  defaultScrollPosition?: "start" | "end";
  /** Extra classes for the transcript column — the app thread passes a
   *  taller top pad so the first message clears the floating toolbar;
   *  the share viewer's in-flow header needs none. */
  contentClassName?: string;
}) {
  /* Rollback is a checkpoint action — pointless on the last message, and
     off the table entirely while a reply is still writing itself. */
  const generating = computeIsGenerating(messages);
  /* A fresh send's anchor jump becomes a glide (lib/use-send-glide.ts). */
  const viewportRef = useRef<HTMLDivElement>(null);
  useSendGlide(messages, viewportRef);
  return (
    /* Censored in session replay, at the one place every transcript passes
       through: the chat face, the share viewer and the debug page all mount
       this. Layout survives, the words do not — see lib/replay-guard.ts. */
    <div className={cn("h-full min-h-0", MASK_TEXT)}>
      <AnimatePresence mode="wait" initial={false}>
        {messages === undefined ? (
          <motion.div
            key="thread-loading"
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.14, ease: EASE_OUT }}
            className="flex h-full items-center justify-center"
          >
            <IconLoader2
              size={20}
              className="animate-spin text-muted-foreground"
            />
          </motion.div>
        ) : (
          /* No blur on the way in: this wrapper holds the entire transcript,
             and a filter left on it (even blur(0)) would keep the scroller
             off the compositor for the rest of the thread — every scroll
             frame re-rasterizing the whole history through a filter pass.
             The fade and the rise read the same anyway. */
          <motion.div
            key="thread-content"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              opacity: { duration: 0.22, ease: EASE_OUT },
              y: { type: "spring", stiffness: 520, damping: 38 },
            }}
            className="h-full min-h-0"
          >
            {/* autoScroll only while a reply is writing itself: with it
                always on, the scroller re-latched onto the live edge the
                moment the reader sat near the bottom — overriding the
                claimScrollIntent handoff — and the next resize (opening a
                tool-use stack) scrollToEnd'ed mid-animation: a visible
                flicker. At rest the view stays exactly where it is. */}
            <MessageScrollerProvider
              autoScroll={generating}
              defaultScrollPosition={defaultScrollPosition}
              scrollEdgeThreshold={EDGE_THRESHOLD_PX}
              scrollPreviousItemPeek={PREVIOUS_TURN_PEEK_PX}
            >
              <MessageScroller>
                <MessageScrollerViewport
                  ref={viewportRef}
                  className="px-3 md:px-6"
                >
                  <MessageScrollerContent
                    className={cn(
                      "mx-auto w-full max-w-2xl pt-8 pb-[max(11rem,calc(var(--dock-clearance,0px)+0.75rem))]",
                      contentClassName,
                    )}
                  >
                    {messages.map((message, index) => (
                      <MessageRow
                        key={`${message.id}:${message.streamId ?? ""}`}
                        message={message}
                        canRollback={
                          index < messages.length - 1 && !generating
                        }
                        onRetryMessage={onRetryMessage}
                        onEditMessage={onEditMessage}
                        onBranchMessage={onBranchMessage}
                        onRollbackMessage={onRollbackMessage}
                      />
                    ))}
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton className="bottom-32" />
              </MessageScroller>
            </MessageScrollerProvider>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* One turn in the transcript, memoized.

   Every reactive update — a phase landing, a tool finishing — used to
   re-render every message in the thread, so the cost of one tool step grew
   with the length of the conversation. lib/messages.ts now carries
   unchanged messages across snapshots by reference, which is what lets this
   memo bite: a settled turn from an hour ago skips its whole subtree while
   the tail reply streams.

   The handlers stay message-taking props (rather than closures built per
   row upstream) for the same reason — a fresh closure per render would make
   the memo miss every time. Callers hand down stable identities. */
const MessageRow = memo(function MessageRow({
  message,
  canRollback,
  onRetryMessage,
  onEditMessage,
  onBranchMessage,
  onRollbackMessage,
}: {
  message: ChatMessage;
  /** Rollback is a checkpoint action: pointless on the last message, and
   *  off the table entirely while a reply is still writing itself. */
  canRollback: boolean;
  onRetryMessage?: (message: ChatMessage) => void;
  onEditMessage?: (message: ChatMessage, content: string) => void;
  onBranchMessage?: (message: ChatMessage) => void;
  onRollbackMessage?: (message: ChatMessage) => void;
}) {
  const handleEdit = useCallback(
    (content: string) => onEditMessage?.(message, content),
    [onEditMessage, message],
  );
  const handleRetry = useCallback(
    () => onRetryMessage?.(message),
    [onRetryMessage, message],
  );
  const handleBranch = useCallback(
    () => onBranchMessage?.(message),
    [onBranchMessage, message],
  );
  const handleRollback = useCallback(
    () => onRollbackMessage?.(message),
    [onRollbackMessage, message],
  );

  return (
    <MessageScrollerItem
      messageId={message.id}
      scrollAnchor={message.role === "user"}
    >
      {message.role === "user" ? (
        <UserMessage
          message={message}
          onEdit={onEditMessage ? handleEdit : undefined}
        />
      ) : (
        <AssistantMessage
          message={message}
          onRetry={onRetryMessage ? handleRetry : undefined}
          onBranch={onBranchMessage ? handleBranch : undefined}
          onRollback={
            onRollbackMessage && canRollback ? handleRollback : undefined
          }
        />
      )}
      {message.compactedAt && (
        <CompactionDivider compactedAt={message.compactedAt} />
      )}
    </MessageScrollerItem>
  );
});

/* Convex queries throw into the render on failure ("Thread not found",
   network death) — this catches that for the thread face and offers a
   plain way back instead of a white screen. */
export class ThreadErrorBoundary extends Component<
  { children: ReactNode; onBackHome: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6">
        <div className="flex items-center gap-2 text-muted-foreground">
          <IconAlertTriangleFilled size={18} />
          <span className="text-[15px]/5 font-medium">
            This thread couldn&apos;t be loaded.
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => this.setState({ failed: false })}
            className="cursor-pointer rounded-full bg-primary px-3.5 py-2 text-[13px]/4 font-medium text-primary-foreground transition-[background-color,scale] duration-150 hover:bg-(--primary-hover) active:scale-[0.96]"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => {
              this.setState({ failed: false });
              this.props.onBackHome();
            }}
            className="cursor-pointer rounded-full px-3.5 py-2 text-[13px]/4 font-medium text-muted-foreground transition-colors duration-150 hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.06]"
          >
            Back home
          </button>
        </div>
      </div>
    );
  }
}
