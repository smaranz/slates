"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConvex, useMutation, useQuery } from "@whirl/backend/react";
import { api } from "@whirl/backend/convex/_generated/api";
import type { Id } from "@whirl/backend/convex/_generated/dataModel";

import type { ChatMessage } from "../messages";
import { clearThreadMessageCache } from "../message-cache";
import { ANALYTICS_EVENTS, captureEvent } from "../posthog";
import {
  createLock,
  isSealed,
  open as openEnvelope,
  openLockWithPassword,
  openLockWithRecoveryCode,
  rewrapWithPassword,
  seal,
  type LockEnvelope,
} from "./crypto";
import { forgetLocked, rememberLocked } from "./locked-ids";
import {
  forgetKey,
  holdKey,
  readKey,
  readPlaintext,
  rememberPlaintext,
  useOpenThreadIds,
} from "./keyring";

/* The data layer for locked threads: minting a lock, opening one, and
   turning sealed rows into readable ones and back.

   Everything that touches plaintext happens here, in the tab. The mutations
   below only ever hand the server ciphertext. */

/** What a locked thread is called anywhere without its key. Matches the
 *  server's own placeholder (convex/lockedThreads.ts) — the sidebar draws
 *  this over a cached title from before the lock. */
export const LOCKED_THREAD_TITLE = "Locked chat";

/** What the server holds for a thread, once the dialog asks for it. */
export type ThreadLock = { lock: LockEnvelope; lockedTitle: string | null };

/** The lock envelope for one thread — `undefined` while loading, `null`
 *  when the thread isn't locked. Only ask when a dialog is actually up:
 *  it's a subscription per open thread. */
export function useThreadLock(
  threadId: string | null | undefined,
  enabled = true,
): ThreadLock | null | undefined {
  return useQuery(
    api.lockedThreads.lockFor,
    threadId && enabled ? { threadId: threadId as Id<"threads"> } : "skip",
  ) as ThreadLock | null | undefined;
}

/** Open a message body if it's sealed. Rows we wrote ourselves — an
 *  interrupted-turn notice, a gate rejection — ride in the clear and come
 *  back untouched. A body that won't open says so in place of itself,
 *  rather than rendering as base64 or blanking the thread. */
async function openBody(key: CryptoKey, message: ChatMessage): Promise<string> {
  if (!isSealed(message.content)) return message.content;
  try {
    return await openEnvelope(key, message.content);
  } catch {
    return "_Whirl cannot decrypt this message._";
  }
}

/** A whole transcript, opened. Rows keep their identity where the text
 *  didn't change, so the thread view's memoized rows still hold. */
export async function openTranscript(
  key: CryptoKey,
  messages: ChatMessage[],
): Promise<ChatMessage[]> {
  return Promise.all(
    messages.map(async (message) => {
      const content = await openBody(key, message);
      return content === message.content ? message : { ...message, content };
    }),
  );
}

/** The real title behind a locked thread's placeholder, or null while this
 *  tab has no key for it (or hasn't opened it yet). Every sidebar paint asks,
 *  so the answer comes out of the keyring's opened-text store first — which
 *  also means it's dropped the moment the thread re-locks. */
export function useOpenedTitle(
  threadId: string,
  lockedTitle: string | null | undefined,
  opened: boolean,
): string | null {
  const cached = lockedTitle ? (readPlaintext(lockedTitle) ?? null) : null;
  const [title, setTitle] = useState(cached);

  /* Render-phase reset, the sanctioned derived-state pattern: switching to a
     different thread must not paint the previous one's name for a frame. */
  const [seen, setSeen] = useState(lockedTitle ?? null);
  if (seen !== (lockedTitle ?? null)) {
    setSeen(lockedTitle ?? null);
    setTitle(cached);
  }

  useEffect(() => {
    if (!opened || !lockedTitle || readPlaintext(lockedTitle) !== undefined) {
      return;
    }
    const key = readKey(threadId);
    if (!key) return;
    let live = true;
    void openEnvelope(key, lockedTitle)
      .then((name) => {
        rememberPlaintext(lockedTitle, name);
        if (live) setTitle(name);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [threadId, lockedTitle, opened]);

  return opened ? title : null;
}

/** The parts of a thread row `useOpenedTitles` reads. */
type Titled = {
  id: string;
  title: string;
  locked: boolean;
  lockedTitle: string | null;
};

const NO_TITLES: ReadonlyMap<string, string> = new Map();

/**
 * Real titles for every locked thread this tab currently holds a key for,
 * by thread id. The whole-list counterpart to `useOpenedTitle`, for the
 * places that need to look across threads rather than draw one — search
 * being the one that matters: an unlocked chat showing its real name in the
 * sidebar and then being unfindable by that name in ⌘K is the app
 * contradicting itself.
 *
 * Threads without a key aren't in the map, which is the correct answer
 * rather than a gap: with no key there is genuinely nothing to know.
 */
export function useOpenedTitles(
  threads: Titled[] | undefined,
): ReadonlyMap<string, string> {
  const openIds = useOpenThreadIds();
  const [titles, setTitles] = useState<ReadonlyMap<string, string>>(NO_TITLES);

  /* Which locked threads are open, as one string — so the effect re-runs
     when a thread is unlocked, renamed or locked back up, and on nothing
     else. Without it this would re-run on every push the listing makes. */
  const shape = (threads ?? [])
    .filter((thread) => thread.locked && openIds.has(thread.id))
    .map((thread) => `${thread.id}:${thread.lockedTitle ?? ""}`)
    .join("|");

  useEffect(() => {
    const open = (threads ?? []).filter(
      (thread) => thread.locked && thread.lockedTitle && openIds.has(thread.id),
    );
    if (open.length === 0) {
      setTitles((current) => (current.size === 0 ? current : NO_TITLES));
      return;
    }

    let live = true;
    void (async () => {
      const next = new Map<string, string>();
      for (const thread of open) {
        const envelope = thread.lockedTitle;
        if (!envelope) continue;
        const cached = readPlaintext(envelope);
        if (cached !== undefined) {
          next.set(thread.id, cached);
          continue;
        }
        const key = readKey(thread.id);
        if (!key) continue;
        try {
          const name = await openEnvelope(key, envelope);
          rememberPlaintext(envelope, name);
          next.set(thread.id, name);
        } catch {
          // A title that won't open just keeps its placeholder.
        }
      }
      if (live) setTitles(next);
    })();

    return () => {
      live = false;
    };
    // `shape` stands in for the parts of `threads` this reads; see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);

  return titles;
}

/** A first name for a fresh locked thread, taken from its opening prompt —
 *  there's no title model in a locked chat, and there can't be. */
export function titleFromPrompt(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  if (!cleaned) return LOCKED_THREAD_TITLE;
  return cleaned.length > 48 ? `${cleaned.slice(0, 47).trimEnd()}…` : cleaned;
}

export function useLockActions() {
  const convex = useConvex();
  const lockThread = useMutation(api.lockedThreads.lockThread);
  const createLockedThread = useMutation(api.lockedThreads.createLockedThread);
  const removeLock = useMutation(api.lockedThreads.removeLock);
  const setLockEnvelope = useMutation(api.lockedThreads.setLockEnvelope);
  const setLockedTitle = useMutation(api.lockedThreads.setLockedTitle);

  /** Mint a lock and put it on a thread, sealing everything already in it.
   *  Returns the recovery key — the only time it exists. */
  const lock = useCallback(
    async (threadId: string, password: string) => {
      const minted = await createLock(password);
      const messages = (await convex.query(api.messages.listForThread, {
        threadId: threadId as Id<"threads">,
      })) as ChatMessage[];
      const title = await readThreadTitle(convex, threadId);

      const bodies = await Promise.all(
        messages.map(async (message) => ({
          messageId: message.id as Id<"messages">,
          content: await seal(minted.contentKey, message.content),
        })),
      );

      await lockThread({
        threadId: threadId as Id<"threads">,
        lock: minted.envelope,
        lockedTitle: await seal(minted.contentKey, title),
        bodies,
      });
      holdKey(threadId, minted.contentKey);
      /* The transcript cache still holds this conversation as it was a
         moment ago, readable. It goes now, along with the note that says
         this thread paints its locked face first from here on. */
      clearThreadMessageCache(threadId);
      rememberLocked(threadId);
      captureEvent(ANALYTICS_EVENTS.threadLocked, {
        message_count: messages.length,
        converted: true,
      });
      return minted.recoveryCode;
    },
    [convex, lockThread],
  );

  /** Mint a lock and a thread to put it on, for `/lock` from home. */
  const lockNewThread = useCallback(
    async (password: string) => {
      const minted = await createLock(password);
      const { threadId } = await createLockedThread({
        lock: minted.envelope,
        lockedTitle: await seal(minted.contentKey, LOCKED_THREAD_TITLE),
      });
      holdKey(threadId, minted.contentKey);
      rememberLocked(threadId);
      captureEvent(ANALYTICS_EVENTS.threadLocked, {
        message_count: 0,
        converted: false,
      });
      return { threadId: threadId as string, recoveryCode: minted.recoveryCode };
    },
    [createLockedThread],
  );

  /** Open a thread for this session. Throws WrongKeyError on a bad
   *  password, which is the one failure the dialog renders in place. */
  const unlockWithPassword = useCallback(
    async (threadId: string, envelope: LockEnvelope, password: string) => {
      const key = await openLockWithPassword(envelope, password);
      holdKey(threadId, key);
      captureEvent(ANALYTICS_EVENTS.threadUnlocked, { via: "password" });
    },
    [],
  );

  const unlockWithRecoveryCode = useCallback(
    async (threadId: string, envelope: LockEnvelope, code: string) => {
      const key = await openLockWithRecoveryCode(envelope, code);
      holdKey(threadId, key);
      captureEvent(ANALYTICS_EVENTS.threadUnlocked, { via: "recovery_key" });
    },
    [],
  );

  /** Change the password on an already-open thread. The content key doesn't
   *  move, so nothing is re-sealed and the printed recovery key still works. */
  const changePassword = useCallback(
    async (threadId: string, envelope: LockEnvelope, password: string) => {
      const key = readKey(threadId);
      if (!key) throw new Error("Unlock this chat first.");
      await setLockEnvelope({
        threadId: threadId as Id<"threads">,
        lock: await rewrapWithPassword(envelope, key, password),
      });
      captureEvent(ANALYTICS_EVENTS.threadLockPasswordChanged);
    },
    [setLockEnvelope],
  );

  /** Take the lock off, writing every body back as plain text. */
  const unlock = useCallback(
    async (threadId: string) => {
      const key = readKey(threadId);
      if (!key) throw new Error("Unlock this chat first.");
      const [messages, lockRow] = await Promise.all([
        convex.query(api.messages.listForThread, {
          threadId: threadId as Id<"threads">,
        }) as Promise<ChatMessage[]>,
        convex.query(api.lockedThreads.lockFor, {
          threadId: threadId as Id<"threads">,
        }),
      ]);
      const bodies = await Promise.all(
        messages.map(async (message) => ({
          messageId: message.id as Id<"messages">,
          content: await openBody(key, message),
        })),
      );
      const title = lockRow?.lockedTitle
        ? await openEnvelope(key, lockRow.lockedTitle).catch(
            () => "Unlocked chat",
          )
        : "Unlocked chat";

      await removeLock({ threadId: threadId as Id<"threads">, title, bodies });
      forgetKey(threadId);
      forgetLocked(threadId);
      captureEvent(ANALYTICS_EVENTS.threadLockRemoved, {
        message_count: messages.length,
      });
    },
    [convex, removeLock],
  );

  /** Rename an open locked thread. */
  const rename = useCallback(
    async (threadId: string, title: string) => {
      const key = readKey(threadId);
      if (!key) throw new Error("Unlock this chat first.");
      await setLockedTitle({
        threadId: threadId as Id<"threads">,
        lockedTitle: await seal(key, title),
      });
    },
    [setLockedTitle],
  );

  return useMemo(
    () => ({
      lock,
      lockNewThread,
      unlockWithPassword,
      unlockWithRecoveryCode,
      changePassword,
      unlock,
      rename,
      relock: forgetKey,
    }),
    [
      lock,
      lockNewThread,
      unlockWithPassword,
      unlockWithRecoveryCode,
      changePassword,
      unlock,
      rename,
    ],
  );
}

/** The thread's current (plain) title, for sealing on the way into a lock. */
async function readThreadTitle(
  convex: ReturnType<typeof useConvex>,
  threadId: string,
): Promise<string> {
  const threads = await convex.query(api.threads.listForCurrentUser, {});
  return (
    threads.find((thread: { id: string; title: string }) => thread.id === threadId)?.title ??
    LOCKED_THREAD_TITLE
  );
}
