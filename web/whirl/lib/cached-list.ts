"use client";

import { useEffect, useState } from "react";

import { writeCacheWhenIdle } from "./idle-storage";

/* Cache-then-live for a list: null until either the cache or the live rows
   arrive, cached rows until Convex answers, live rows (mirrored back into
   the cache) after. The cache read waits a frame so SSR and hydration
   never touch storage — mirrors lib/model-access.ts. Shared by the
   integrations and skills stores. */
export function useCachedList<T>(key: string, live: T[] | undefined): T[] | null {
  const [cached, setCached] = useState<T[] | null>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return;
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) setCached(parsed as T[]);
      } catch {
        // unreadable cache — first paint just waits for the live rows
      }
    });
    return () => cancelAnimationFrame(id);
  }, [key]);

  /* Idle and de-duplicated: a live query hands back a new array on every
     push, and most of those pushes carry the same rows. */
  useEffect(() => {
    if (!live) return;
    writeCacheWhenIdle(key, () => live);
  }, [key, live]);

  return live ?? cached;
}
