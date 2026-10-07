import "server-only";

import { busyChats } from "@/lib/agent/engine";
import { subscribe as onAgentHub } from "@/lib/agent/hub";
import { ALL, threadTopic } from "@whirl/backend/topics";

/**
 * Tells open Agent windows what changed.
 *
 * Every write the Whirl functions make, and every event the agents post,
 * names the topics it touched; /api/whirl/stream forwards them and each
 * live query on the page refetches if one is its own. Bursts are coalesced
 * so a streaming reply costs a handful of refetches a second, not one per
 * token.
 */

type Listener = (topics: string[]) => void;

interface Bus {
  listeners: Set<Listener>;
  pending: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
  bridged: boolean;
  /** Chats that were busy at the last state change, so going idle is announced too. */
  busy: Set<string>;
}

const g = globalThis as typeof globalThis & { __slatesWhirlBus?: Bus };
const bus: Bus = (g.__slatesWhirlBus ??= { listeners: new Set(), pending: new Set(), timer: null, bridged: false, busy: new Set() });

const COALESCE_MS = 60;

export function touch(...topics: string[]): void {
  for (const topic of topics) bus.pending.add(topic);
  if (bus.timer) return;
  bus.timer = setTimeout(() => {
    bus.timer = null;
    const batch = [...bus.pending];
    bus.pending.clear();
    for (const listener of bus.listeners) listener(batch);
  }, COALESCE_MS);
}

export function touchThread(chatId: string): void {
  touch(threadTopic(chatId), "threads");
}

export function listen(listener: Listener): () => void {
  bridge();
  bus.listeners.add(listener);
  return () => bus.listeners.delete(listener);
}

/** The agents' own live feed, translated into topics. */
function bridge(): void {
  if (bus.bridged) return;
  bus.bridged = true;
  onAgentHub((message) => {
    if (message.kind === "event") {
      touchThread(message.chatId);
    } else if (message.kind === "state") {
      const now = new Set(busyChats().keys());
      for (const chatId of new Set([...now, ...bus.busy])) touchThread(chatId);
      bus.busy = now;
      touch("slates");
    } else {
      touch(ALL);
    }
  });
}
