"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAction } from "@whirl/backend/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@whirl/backend/convex/_generated/api";

import { errorText } from "./integrations-data";

/* Client bindings for the Memory settings tab. Supermemory lives behind an
   HTTP API rather than a Convex table, so there's nothing reactive to
   subscribe to: these hooks fetch once when the tab opens and refetch after
   a write. Edits and removals land locally first so the list never stalls
   behind a round trip — a failure puts the old row back and rethrows, and
   the calling card turns that into a toast. */

/* Mirrors the backend's MAX_MEMORY_CONTENT (convex/supermemoryManage.ts). */
export const MAX_MEMORY_CONTENT = 1_000;

export type Memory = FunctionReturnType<
  typeof api.userMemory.listMemories
>["memories"][number];

export type MemorySource = FunctionReturnType<
  typeof api.userMemory.listSources
>["sources"][number];

/** The user's memories, plus every way to change them. `memories` is
 *  undefined until the first load answers. */
export function useMemories(enabled: boolean) {
  const listMemories = useAction(api.userMemory.listMemories);
  const addMemory = useAction(api.userMemory.addMemory);
  const editMemory = useAction(api.userMemory.editMemory);
  const forgetMemory = useAction(api.userMemory.forgetMemory);

  const [memories, setMemories] = useState<Memory[] | undefined>(undefined);
  /* What Supermemory says it holds. Equal to `memories.length` unless the
     user is past the page cap, in which case the card owns up to it. */
  const [totalItems, setTotalItems] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const result = await listMemories({});
      setMemories(result.memories);
      setTotalItems(result.totalItems);
      setError(null);
    } catch (caught) {
      setMemories([]);
      setError(errorText(caught, "Couldn't load your memories."));
    }
  }, [listMemories]);

  useEffect(() => {
    if (!enabled || loadedRef.current) return;
    loadedRef.current = true;
    void refresh();
  }, [enabled, refresh]);

  const add = useCallback(
    async (content: string, isStatic: boolean) => {
      const created = await addMemory({ content, isStatic });
      // Supermemory answers with the row it wrote; if it ever doesn't, fall
      // back to a refetch rather than showing a list missing the new memory.
      if (created) {
        setMemories((prev) => [created, ...(prev ?? [])]);
        setTotalItems((count) => count + 1);
      } else {
        await refresh();
      }
    },
    [addMemory, refresh],
  );

  const edit = useCallback(
    async (id: string, content: string) => {
      const previous = memories;
      setMemories((prev) =>
        prev?.map((row) => (row.id === id ? { ...row, memory: content } : row)),
      );
      try {
        // An edit is a new version with a new id, so adopt what came back —
        // keeping our own `isStatic`, which the version payload omits.
        const updated = await editMemory({ id, content });
        if (updated) {
          setMemories((prev) =>
            prev?.map((row) =>
              row.id === id
                ? { ...row, ...updated, isStatic: row.isStatic }
                : row,
            ),
          );
        }
      } catch (caught) {
        setMemories(previous);
        throw caught;
      }
    },
    [editMemory, memories],
  );

  const forget = useCallback(
    async (id: string) => {
      const previous = memories;
      const previousTotal = totalItems;
      setMemories((prev) => prev?.filter((row) => row.id !== id));
      setTotalItems((count) => Math.max(0, count - 1));
      try {
        await forgetMemory({ id });
      } catch (caught) {
        setMemories(previous);
        setTotalItems(previousTotal);
        throw caught;
      }
    },
    [forgetMemory, memories, totalItems],
  );

  /** Empty the list without a round trip — for after a full wipe. */
  const clear = useCallback(() => {
    setMemories([]);
    setTotalItems(0);
  }, []);

  return { memories, totalItems, error, refresh, add, edit, forget, clear };
}

export type MemorySourcesPage = {
  sources: MemorySource[];
  page: number;
  totalPages: number;
  totalItems: number;
};

/** One page at a time of the chats Whirl has fed into memory. */
export function useMemorySources(enabled: boolean) {
  const listSources = useAction(api.userMemory.listSources);
  const deleteSource = useAction(api.userMemory.deleteSource);

  const [data, setData] = useState<MemorySourcesPage | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const load = useCallback(
    async (page: number) => {
      setLoading(true);
      try {
        setData(await listSources({ page }));
        setError(null);
      } catch (caught) {
        setError(errorText(caught, "Couldn't load your synced chats."));
        setData((prev) => prev ?? { sources: [], page: 1, totalPages: 0, totalItems: 0 });
      } finally {
        setLoading(false);
      }
    },
    [listSources],
  );

  useEffect(() => {
    if (!enabled || loadedRef.current) return;
    loadedRef.current = true;
    void load(1);
  }, [enabled, load]);

  const remove = useCallback(
    async (id: string) => {
      const previous = data;
      setData((prev) =>
        prev
          ? {
              ...prev,
              sources: prev.sources.filter((source) => source.id !== id),
              totalItems: Math.max(0, prev.totalItems - 1),
            }
          : prev,
      );
      try {
        await deleteSource({ id });
      } catch (caught) {
        setData(previous);
        throw caught;
      }
    },
    [data, deleteSource],
  );

  const clear = useCallback(
    () => setData({ sources: [], page: 1, totalPages: 0, totalItems: 0 }),
    [],
  );

  return { data, loading, error, load, remove, clear };
}
