import "server-only";

import type { HubMessage } from "./types";

/** In-process fan-out of live Agent updates to every open window. */

type Listener = (message: HubMessage) => void;

const state = globalThis as typeof globalThis & { __slatesAgentHub?: Set<Listener> };
const listeners = (state.__slatesAgentHub ??= new Set());

export function publish(message: HubMessage): void {
  for (const listener of listeners) {
    try {
      listener(message);
    } catch {
      // One broken stream shouldn't stop the others.
    }
  }
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
