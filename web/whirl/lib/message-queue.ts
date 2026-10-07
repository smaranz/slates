"use client";

import { useCallback, useMemo } from "react";
import { useMutation, useQuery } from "@whirl/backend/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@whirl/backend/convex/_generated/api";
import type { Id } from "@whirl/backend/convex/_generated/dataModel";

import type { AttachmentUpload } from "./attachments";
import { isCustomModelKey, type ThinkingLevel } from "./models";
import { ANALYTICS_EVENTS, captureEvent } from "./posthog";

/* Messages typed while a reply was still being written. They wait in the
   database, not in this tab (convex/messageQueue.ts): the deployment
   sends each one the moment the reply ahead of it settles, so the thread
   keeps going whether or not anyone is looking at it. This file is the
   subscription and the two writes; the transcript draws the rows. */

export type QueuedMessage = FunctionReturnType<
  typeof api.messageQueue.listForThread
>[number];

const NO_QUEUED: QueuedMessage[] = [];

/** The thread's waiting messages, oldest first. Empty while loading. */
export function useQueuedMessages(
  threadId: string | null,
  enabled: boolean,
): QueuedMessage[] {
  const rows = useQuery(
    api.messageQueue.listForThread,
    enabled && threadId ? { threadId: threadId as Id<"threads"> } : "skip",
  );
  return rows ?? NO_QUEUED;
}

export type QueueMessageArgs = {
  threadId: string;
  text: string;
  model: string;
  attachments: AttachmentUpload[];
  search: boolean;
  thinking: ThinkingLevel;
  integrations?: { serverId: string; name: string }[];
  skills?: { installId: string; name: string }[];
};

const WIRE_MODEL_KEYS = ["Auto", "Fast", "Basic", "Max", "Image"] as const;

/* Same folding a send does: catalog slugs verbatim, tier keys or Auto. */
function wireModel(model: string): string {
  if (isCustomModelKey(model)) return model;
  return WIRE_MODEL_KEYS.find((key) => key === model) ?? "Auto";
}

export function useQueueActions() {
  const enqueueBase = useMutation(api.messageQueue.enqueue);
  /* Optimistic, so the card lands under the streaming reply on the
     keypress. The placeholder carries a made-up id; the echo replaces it
     wholesale, and the card is keyed on content + position so React
     carries the node across the swap instead of remounting it. */
  const enqueue = useMemo(
    () =>
      enqueueBase.withOptimisticUpdate((store, args) => {
        const { threadId } = args;
        const current = store.getQuery(api.messageQueue.listForThread, {
          threadId,
        });
        if (!current) return;
        // Convex invokes optimistic updaters for mutations, outside render.
        // eslint-disable-next-line react-hooks/purity
        const now = Date.now();
        store.setQuery(api.messageQueue.listForThread, { threadId }, [
          ...current,
          {
            id: `optimistic:${now}` as Id<"queuedMessages">,
            content: args.content,
            createdAt: now,
            attachments: (args.attachments ?? []).map(
              ({ id, name, size, type }: { id: string; name: string; size: number; type: string }) => ({ id, name, size, type }),
            ),
            model: args.options?.model ?? null,
          },
        ]);
      }),
    [enqueueBase],
  );

  const removeBase = useMutation(api.messageQueue.remove);
  const remove = useMemo(
    () =>
      removeBase.withOptimisticUpdate((store, args) => {
        /* The query is keyed by thread and the mutation only knows the
           row, so every loaded queue gets the row filtered out — a
           removal touches exactly one of them. */
        for (const { args: queryArgs, value } of store.getAllQueries(
          api.messageQueue.listForThread,
        )) {
          if (!value?.some((row: { id: string }) => row.id === args.queuedId)) continue;
          store.setQuery(
            api.messageQueue.listForThread,
            queryArgs,
            value.filter((row: { id: string }) => row.id !== args.queuedId),
          );
        }
      }),
    [removeBase],
  );

  const queue = useCallback(
    async ({
      threadId,
      text,
      model,
      attachments,
      search,
      thinking,
      integrations,
      skills,
    }: QueueMessageArgs) => {
      const result = await enqueue({
        threadId: threadId as Id<"threads">,
        content: text,
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
      captureEvent(ANALYTICS_EVENTS.messageQueued, {
        model: wireModel(model),
        attachment_count: attachments.length,
        text_length: text.length,
        sent_now: result.sentNow,
      });
      return result;
    },
    [enqueue],
  );

  const dequeue = useCallback(
    async (queuedId: string) => {
      await remove({ queuedId: queuedId as Id<"queuedMessages"> });
      captureEvent(ANALYTICS_EVENTS.messageDequeued);
    },
    [remove],
  );

  return useMemo(() => ({ queue, dequeue }), [queue, dequeue]);
}
