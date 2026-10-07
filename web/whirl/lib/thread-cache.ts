"use client";

import { useEffect, useLayoutEffect, useState } from "react";

import type { FolderSummary } from "./folders";
import { writeCacheWhenIdle } from "./idle-storage";
import type { ThreadSummary } from "./threads";

/* Last-known thread list per user (mirrors plan-cache.ts): enough shape to
   paint real, navigable rows on reload — the live query replaces them
   silently once Convex answers, and new threads are told apart from
   cached ones so only they animate in. */

export type CachedThread = {
  id: string;
  title: string;
  pinnedAt: number | null;
  folderId: string | null;
  updatedAt: number;
  branchedFromThreadId?: string | null;
  /** Who the conversation is with, so a cached row still wears its agent. */
  target?: ThreadSummary["target"];
  inbox?: boolean;
};

export type CachedFolder = { id: string; name: string };

export type ThreadListSnapshot = {
  threads: CachedThread[];
  folders: CachedFolder[];
};

const cacheKey = (userId: string) => `thread-list:${userId}`;

/**
 * Dress a cached row back up as a live ThreadSummary so the real ThreadRow
 * can render it (ids are real — navigation and actions just work). Volatile
 * fields get quiet defaults — no title shimmer — until the live query
 * takes over.
 */
export function cachedThreadToSummary(cached: CachedThread): ThreadSummary {
  return {
    id: cached.id,
    title: cached.title,
    titleStatus: "ready",
    createdAt: cached.updatedAt,
    updatedAt: cached.updatedAt,
    pinnedAt: cached.pinnedAt,
    model: null,
    compactionStatus: "idle",
    compactionBoundary: null,
    compactionUpdatedAt: null,
    compactionMarkers: [],
    shareId: null,
    folderId: cached.folderId,
    branchedFromThreadId: cached.branchedFromThreadId ?? null,
    locked: false,
    lockedTitle: null,
    target: cached.target ?? null,
    inbox: cached.inbox ?? false,
  } as unknown as ThreadSummary;
}

/** Same dressing for folders (the rows only render id + name). */
export function cachedFolderToSummary(cached: CachedFolder): FolderSummary {
  return {
    id: cached.id,
    name: cached.name,
    order: 0,
    createdAt: 0,
    updatedAt: 0,
  } as FolderSummary;
}

/* Clerk resolves the user asynchronously — without a pointer to the last
   signed-in user, the first paints could only show a generic skeleton and
   then jump to the real silhouette once auth lands. */
const LAST_USER_KEY = "thread-list:last-user";

export function readThreadListSnapshot(
  userId: string,
): ThreadListSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(cacheKey(userId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray((parsed as ThreadListSnapshot).threads) ||
      !Array.isArray((parsed as ThreadListSnapshot).folders)
    ) {
      return null;
    }
    return parsed as ThreadListSnapshot;
  } catch {
    return null;
  }
}

/* Reads the snapshot once per user (post-mount, so SSR and hydration
   agree) and keeps it fresh whenever live data lands. `resolved` flips
   true (pre-paint) once storage has been consulted, so the list can tell
   "no cache yet" from "no cache at all". */
export function useThreadListSnapshot(
  userId: string | undefined,
  threads: ThreadSummary[] | undefined,
  folders: FolderSummary[] | undefined,
): { snapshot: ThreadListSnapshot | null; resolved: boolean } {
  const [cached, setCached] = useState<ThreadListSnapshot | null>(null);
  const [resolved, setResolved] = useState(false);

  /* Before auth resolves: hydrate from the last signed-in user's snapshot,
     pre-paint, so the rows are real from the very first frame. */
  useLayoutEffect(() => {
    try {
      const lastUser = window.localStorage.getItem(LAST_USER_KEY);
      if (lastUser) setCached(readThreadListSnapshot(lastUser));
    } catch {
      /* Storage may be unavailable; the skeleton just falls back. */
    }
    setResolved(true);
  }, []);

  /* Once the real user is known, prefer their snapshot (covers switching
     accounts) — but never reset to null while Clerk is still resolving. */
  useEffect(() => {
    if (userId) setCached(readThreadListSnapshot(userId));
  }, [userId]);

  /* Written on an idle beat and only when it actually differs — the listing
     hands back a fresh array on every push, and serializing a long history
     into storage on each one is a stutter you can feel while a reply
     streams (lib/idle-storage.ts). */
  useEffect(() => {
    if (!userId || !threads || !folders) return;
    writeCacheWhenIdle(cacheKey(userId), () => ({
      threads: threads.map((thread) => ({
        id: thread.id,
        title: thread.title,
        pinnedAt: thread.pinnedAt,
        folderId: thread.folderId,
        updatedAt: thread.updatedAt,
        branchedFromThreadId: thread.branchedFromThreadId,
        target: thread.target,
        inbox: thread.inbox,
      })),
      folders: folders.map((folder) => ({ id: folder.id, name: folder.name })),
    }));
  }, [userId, threads, folders]);

  /* The pointer to "whose list is cached" is a single short string and it
     only moves when the account does. */
  useEffect(() => {
    if (!userId) return;
    try {
      if (window.localStorage.getItem(LAST_USER_KEY) !== userId) {
        window.localStorage.setItem(LAST_USER_KEY, userId);
      }
    } catch {
      /* Storage may be unavailable; the skeleton just falls back. */
    }
  }, [userId]);

  return { snapshot: cached, resolved };
}
