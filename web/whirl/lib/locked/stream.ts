"use client";

import { useSyncExternalStore } from "react";

/* The client half of a locked turn.

   A locked thread's plaintext only exists in this tab, so this tab is what
   runs the turn: it opens the transcript, POSTs it to Convex's
   /locked-stream HTTP action, paints the reply as it comes back, and seals
   the finished text before storing it. Nothing about the conversation is
   ever written down in the clear. See packages/backend/convex/lockedInference.ts
   for the other end.

   The live text is a module-level store rather than component state, for the
   same reason lib/toasts.ts is: a turn has to survive the composer
   re-rendering, the sidebar reconciling, and a hop to settings and back.
   It's keyed by the assistant message id, and every path out of a turn —
   finish, stop, error, unmount — drops its entry. */

export type LockedTurnState = {
  /** What has streamed so far, painted live. */
  text: string;
  /** Reasoning, when the thinking gate is on. Shown, never stored. */
  reasoning: string;
  /** The model has started producing text (vs. still thinking). */
  started: boolean;
};

const IDLE: LockedTurnState = { text: "", reasoning: "", started: false };

/** How long a turn may say nothing at all before this tab gives up on it.
 *  Generous: it has to cover a slow first token on a long prompt, and it is
 *  reset by every event, so it only ever fires on genuine silence. */
const SILENCE_TIMEOUT_MS = 90_000;

let turns = new Map<string, LockedTurnState>();
const listeners = new Set<() => void>();
/** One controller per live turn, so Stop can actually cut the connection. */
const controllers = new Map<string, AbortController>();

function emit() {
  turns = new Map(turns);
  for (const listener of listeners) listener();
}

const EMPTY: ReadonlyMap<string, LockedTurnState> = new Map();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Every locked turn currently painting. Empty (and stable) when none is,
 *  so a settled thread subscribes to something that never changes. */
export function useLockedTurns(): ReadonlyMap<string, LockedTurnState> {
  return useSyncExternalStore(
    subscribe,
    () => turns,
    () => EMPTY,
  );
}

/** The live text of one running turn, or null when it isn't ours to draw. */
export function useLockedTurn(
  assistantId: string | null | undefined,
): LockedTurnState | null {
  const all = useLockedTurns();
  return assistantId ? (all.get(assistantId) ?? null) : null;
}

function patch(assistantId: string, next: Partial<LockedTurnState>) {
  const current = turns.get(assistantId) ?? IDLE;
  turns.set(assistantId, { ...current, ...next });
  emit();
}

/** Drop a turn's live buffer. Called on every exit, including unmount. */
export function clearLockedTurn(assistantId: string) {
  const hadTurn = turns.delete(assistantId);
  controllers.delete(assistantId);
  if (hadTurn) emit();
}

/** Cut a running turn off at whatever it has painted, and hand that back so
 *  the caller can seal it as a reply that was stopped. */
export function stopLockedTurn(assistantId: string): string {
  controllers.get(assistantId)?.abort();
  controllers.delete(assistantId);
  return turns.get(assistantId)?.text ?? "";
}

export function isLockedTurnRunning(assistantId: string): boolean {
  return controllers.has(assistantId);
}

/* ---- the wire ------------------------------------------------------- */

type TurnEvent =
  | { t: "delta"; v: string }
  | { t: "reasoning"; v: string }
  | { t: "done"; outputTokens: number; durationMs: number }
  | { t: "error"; message: string };

export type LockedTurnResult = {
  text: string;
  outputTokens?: number;
  durationMs?: number;
  /** Set when the turn ended badly. Text that already arrived still counts —
   *  a cut-off reply is kept, not thrown away. */
  error?: string;
  stopped?: boolean;
};

/** Where Convex's HTTP actions live. `NEXT_PUBLIC_CONVEX_SITE_URL` is the
 *  deployment's own answer and is preferred; deriving it from the websocket
 *  origin is the fallback, and only holds while that origin is a stock
 *  `.convex.cloud` host. */
export function lockedStreamUrl(): string {
  const site = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (site) return `${site.replace(/\/$/, "")}/locked-stream`;

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl?.endsWith(".convex.cloud")) {
    throw new Error("Whirl cannot connect to the server.");
  }
  return `${convexUrl.replace(/\.convex\.cloud$/, ".convex.site")}/locked-stream`;
}

export type LockedTurnRequest = {
  threadId: string;
  assistantId: string;
  model: string;
  thinking: boolean;
  /** The opened transcript, oldest first, ending with the new prompt. */
  messages: {
    role: "user" | "assistant";
    content: string;
    /** Data URLs. A locked thread never uploads a file to our storage, so
     *  images ride inline, straight through to the provider. */
    images?: string[];
  }[];
  /** A Clerk token for the Convex audience — the HTTP action has no session
   *  of its own to read. */
  token: string;
};

/**
 * Run one locked turn, painting into the live store as it goes. Resolves
 * once the reply has finished, been stopped, or failed — the caller seals
 * whatever came back and writes it to the message row.
 */
export async function runLockedTurn(
  request: LockedTurnRequest,
): Promise<LockedTurnResult> {
  const { assistantId } = request;
  const controller = new AbortController();
  controllers.set(assistantId, controller);
  patch(assistantId, { text: "", reasoning: "", started: false });

  let outputTokens: number | undefined;
  let durationMs: number | undefined;
  let error: string | undefined;

  /* A locked turn is driven from this tab, so a connection that opens and
     then says nothing has nobody else to notice it — the reply would sit on
     "Thinking…" until the user gave up, with no error and nothing to retry.
     The clock restarts on every event, so a long reply is never cut off;
     only a silent one is. */
  let silent: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const heard = () => {
    clearTimeout(silent);
    silent = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, SILENCE_TIMEOUT_MS);
  };
  heard();

  try {
    const response = await fetch(lockedStreamUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${request.token}`,
      },
      body: JSON.stringify({
        threadId: request.threadId,
        assistantId: request.assistantId,
        model: request.model,
        thinking: request.thinking,
        messages: request.messages,
      }),
      signal: controller.signal,
    });

    if (!response.body) {
      throw new Error("The server sent no reply. Try again.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    /* `done` and `error` are terminal: the turn is over the moment one
       lands, and the server still has billing to settle before it closes
       its end. Waiting for the close would hold the reply unsealed for an
       Autumn round trip it has no reason to wait on. */
    let finished = false;

    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      /* Parse on newlines only: a chunk boundary lands mid-object often
         enough that anything else would drop tokens. */
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const raw = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!raw) continue;

        let event: TurnEvent;
        try {
          event = JSON.parse(raw) as TurnEvent;
        } catch {
          continue;
        }

        heard();
        switch (event.t) {
          case "delta":
            patch(assistantId, {
              text: (turns.get(assistantId)?.text ?? "") + event.v,
              started: true,
            });
            break;
          case "reasoning":
            patch(assistantId, {
              reasoning: (turns.get(assistantId)?.reasoning ?? "") + event.v,
            });
            break;
          case "done":
            outputTokens = event.outputTokens;
            durationMs = event.durationMs;
            finished = true;
            break;
          case "error":
            error = event.message;
            finished = true;
            break;
        }
      }
    }

    // Let go of our end. The turn's own promise on the server carries on to
    // the books whether or not we're still listening.
    void reader.cancel().catch(() => {});
  } catch (cause) {
    const aborted = cause instanceof DOMException && cause.name === "AbortError";
    if (timedOut) {
      error = "The model stopped responding. Try again.";
    } else if (!aborted) {
      // Any other abort is the user pressing Stop, not a failure — the text
      // already painted is the reply, and the caller seals it as stopped.
      error =
        cause instanceof Error
          ? cause.message
          : "Whirl cannot generate this reply. Try again.";
    }
  } finally {
    clearTimeout(silent);
  }

  const stopped = controller.signal.aborted && !timedOut;
  const text = turns.get(assistantId)?.text ?? "";
  controllers.delete(assistantId);
  return {
    text,
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(error ? { error } : {}),
    ...(stopped ? { stopped: true } : {}),
  };
}
