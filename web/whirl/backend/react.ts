"use client";

/* The slice of `convex/react` Whirl's components use, served by Slates.

   Whirl was written against Convex: reactive queries, mutations with
   optimistic updates, actions. Slates keeps the same contract over its own
   Next server — calls go to /api/whirl, and /api/whirl/stream names the
   topics that changed so live queries refetch. Ported components import
   this module where they imported convex/react, and otherwise don't change. */

import { ConvexError } from "convex/values";
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";

import { functionName } from "./convex/_generated/api";
import { ALL, topicsFor } from "./topics";

type Args = Record<string, unknown>;
type Kind = "query" | "mutation" | "action";

/* ── transport ─────────────────────────────────────────────────────────── */

async function call(kind: Kind, name: string, args: unknown): Promise<unknown> {
  const response = await fetch("/api/whirl", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, name, args: args ?? {} }),
  });
  const body = (await response.json().catch(() => null)) as
    | { value?: unknown; error?: { message: string; data?: unknown } }
    | null;
  if (!body) throw new Error(`Slates didn't answer ${name} (${response.status}).`);
  if (body.error) {
    if (body.error.data !== undefined) throw new ConvexError(body.error.data as never);
    throw new Error(body.error.message);
  }
  return body.value;
}

/* ── the query cache ───────────────────────────────────────────────────── */

interface Layer {
  id: number;
  value: unknown;
  settled: boolean;
}

interface Entry {
  key: string;
  name: string;
  args: Args;
  topics: string[];
  data: unknown;
  hasData: boolean;
  error: Error | null;
  layers: Layer[];
  listeners: Set<() => void>;
  inflight: boolean;
  stale: boolean;
  evictTimer: ReturnType<typeof setTimeout> | null;
  /** Bumped on every change so snapshots compare cheaply. */
  version: number;
  snapshot: { version: number; value: unknown } | null;
}

const entries = new Map<string, Entry>();
/** Unwatched results linger this long, so a warm-up prefetch is still there when the view mounts. */
const EVICT_MS = 30_000;

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(record[k])}`)
    .join(",")}}`;
}

function keyOf(name: string, args: unknown): string {
  return `${name}|${stable(args ?? {})}`;
}

function entryFor(name: string, args: Args): Entry {
  const key = keyOf(name, args);
  let entry = entries.get(key);
  if (!entry) {
    entry = {
      key,
      name,
      args,
      topics: topicsFor(name, args),
      data: undefined,
      hasData: false,
      error: null,
      layers: [],
      listeners: new Set(),
      inflight: false,
      stale: false,
      evictTimer: null,
      version: 0,
      snapshot: null,
    };
    entries.set(key, entry);
    scheduleEvict(entry);
  }
  return entry;
}

function scheduleEvict(entry: Entry) {
  if (entry.evictTimer) clearTimeout(entry.evictTimer);
  entry.evictTimer = setTimeout(() => {
    if (entry.listeners.size === 0 && entry.layers.length === 0) entries.delete(entry.key);
  }, EVICT_MS);
}

function notify(entry: Entry) {
  entry.version++;
  for (const listener of entry.listeners) listener();
}

function current(entry: Entry): unknown {
  const top = entry.layers[entry.layers.length - 1];
  return top ? top.value : entry.data;
}

async function refetch(entry: Entry): Promise<void> {
  if (entry.inflight) {
    entry.stale = true;
    return;
  }
  entry.inflight = true;
  entry.stale = false;
  // Layers whose mutation already finished are retired by the answer to a
  // fetch that started after it: by then the server has the write.
  const retire = new Set(entry.layers.filter((l) => l.settled).map((l) => l.id));
  try {
    entry.data = await call("query", entry.name, entry.args);
    entry.hasData = true;
    entry.error = null;
  } catch (error) {
    entry.error = error instanceof Error ? error : new Error(String(error));
    console.error(`[whirl] ${entry.name} failed:`, entry.error.message);
  } finally {
    entry.inflight = false;
    if (retire.size) entry.layers = entry.layers.filter((l) => !retire.has(l.id));
    notify(entry);
    if (entry.stale || entry.layers.some((l) => l.settled)) void refetch(entry);
  }
}

function fetchOnce(entry: Entry): Promise<unknown> {
  if (entry.hasData) return Promise.resolve(current(entry));
  return new Promise((resolve, reject) => {
    const listener = () => {
      if (!entry.hasData && !entry.error) return;
      entry.listeners.delete(listener);
      scheduleEvict(entry);
      if (entry.error && !entry.hasData) reject(entry.error);
      else resolve(current(entry));
    };
    entry.listeners.add(listener);
    if (!entry.inflight) void refetch(entry);
  });
}

/* ── change feed ───────────────────────────────────────────────────────── */

let source: EventSource | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let watchers = 0;

function invalidate(topics: string[]) {
  const everything = topics.includes(ALL);
  for (const entry of entries.values()) {
    if (entry.listeners.size === 0) continue;
    if (everything || entry.topics.some((t) => topics.includes(t))) void refetch(entry);
  }
}

function connect() {
  if (source || typeof window === "undefined") return;
  source = new EventSource("/api/whirl/stream");
  let opened = false;
  source.onopen = () => {
    // Anything could have changed while the feed was down.
    if (opened) invalidate([ALL]);
    opened = true;
  };
  source.onmessage = (message) => {
    try {
      const data = JSON.parse(message.data) as { topics?: string[] };
      if (data.topics?.length) invalidate(data.topics);
    } catch {
      /* a heartbeat, or garbage — either way nothing to do */
    }
  };
  source.onerror = () => {
    source?.close();
    source = null;
    if (watchers > 0) retry = setTimeout(connect, 2000);
  };
}

function watch() {
  watchers++;
  connect();
  return () => {
    watchers--;
    if (watchers === 0) {
      if (retry) clearTimeout(retry);
      source?.close();
      source = null;
    }
  };
}

/* ── optimistic store ──────────────────────────────────────────────────── */

export interface OptimisticLocalStore {
  getQuery(ref: unknown, args?: Args): any; // eslint-disable-line @typescript-eslint/no-explicit-any
  setQuery(ref: unknown, args: Args, value: unknown): void;
  getAllQueries(ref: unknown): { args: Args; value: any }[]; // eslint-disable-line @typescript-eslint/no-explicit-any
}

let layerIds = 0;

function optimisticStore(layerId: number, touched: Set<Entry>): OptimisticLocalStore {
  return {
    getQuery(ref, args = {}) {
      const entry = entries.get(keyOf(functionName(ref), args));
      return entry ? current(entry) : undefined;
    },
    setQuery(ref, args, value) {
      const entry = entryFor(functionName(ref), args);
      const mine = entry.layers.find((l) => l.id === layerId);
      if (mine) mine.value = value;
      else entry.layers.push({ id: layerId, value, settled: false });
      touched.add(entry);
      notify(entry);
    },
    getAllQueries(ref) {
      const name = functionName(ref);
      return [...entries.values()].filter((e) => e.name === name).map((e) => ({ args: e.args, value: current(e) }));
    },
  };
}

type Updater = (store: OptimisticLocalStore, args: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any

async function runMutation(name: string, args: unknown, updater: Updater | null): Promise<unknown> {
  const touched = new Set<Entry>();
  const layerId = ++layerIds;
  if (updater) updater(optimisticStore(layerId, touched), args ?? {});
  try {
    const value = await call("mutation", name, args);
    for (const entry of touched) {
      const layer = entry.layers.find((l) => l.id === layerId);
      if (layer) layer.settled = true;
      void refetch(entry);
    }
    return value;
  } catch (error) {
    for (const entry of touched) {
      entry.layers = entry.layers.filter((l) => l.id !== layerId);
      notify(entry);
    }
    throw error;
  }
}

/* ── hooks ─────────────────────────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useQuery(ref: unknown, args?: Args | "skip"): any {
  const name = functionName(ref);
  const skip = args === "skip";
  const key = skip ? null : keyOf(name, args);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const entry = useMemo(() => (skip ? null : entryFor(name, (args ?? {}) as Args)), [key]);

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!entry) return () => {};
      entry.listeners.add(onChange);
      const unwatch = watch();
      if (!entry.hasData && !entry.inflight) void refetch(entry);
      return () => {
        entry.listeners.delete(onChange);
        unwatch();
        scheduleEvict(entry);
      };
    },
    [entry],
  );

  const getSnapshot = useCallback(() => (entry ? current(entry) : undefined), [entry]);
  return useSyncExternalStore(subscribe, getSnapshot, () => undefined);
}

type QuerySpec = { query: unknown; args: Args };

/** One shared "nothing yet" — a fresh object per call would loop the server render. */
const EMPTY_RESULTS: Record<string, unknown> = {};
const emptyResults = () => EMPTY_RESULTS;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useQueries(specs: Record<string, QuerySpec>): Record<string, any> {
  const keys = Object.keys(specs);
  const signature = keys.map((k) => keyOf(functionName(specs[k]!.query), specs[k]!.args)).join("\n");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const list = useMemo(() => keys.map((k) => [k, entryFor(functionName(specs[k]!.query), specs[k]!.args)] as const), [signature]);
  const cache = useRef<{ version: string; value: Record<string, unknown> } | null>(null);

  const subscribe = useCallback(
    (onChange: () => void) => {
      const unwatch = watch();
      for (const [, entry] of list) {
        entry.listeners.add(onChange);
        if (!entry.hasData && !entry.inflight) void refetch(entry);
      }
      return () => {
        for (const [, entry] of list) {
          entry.listeners.delete(onChange);
          scheduleEvict(entry);
        }
        unwatch();
      };
    },
    [list],
  );

  const getSnapshot = useCallback(() => {
    const version = list.map(([, e]) => e.version).join(",");
    if (cache.current?.version === version) return cache.current.value;
    const value: Record<string, unknown> = {};
    for (const [k, e] of list) value[k] = e.error && !e.hasData ? e.error : current(e);
    cache.current = { version, value };
    return value;
  }, [list]);

  return useSyncExternalStore(subscribe, getSnapshot, emptyResults);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mutation = ((args?: any) => Promise<any>) & { withOptimisticUpdate(updater: Updater): Mutation };

function makeMutation(name: string, updater: Updater | null): Mutation {
  const run = ((args?: unknown) => runMutation(name, args, updater)) as Mutation;
  run.withOptimisticUpdate = (next: Updater) => makeMutation(name, next);
  return run;
}

export function useMutation(ref: unknown): Mutation {
  const name = functionName(ref);
  return useMemo(() => makeMutation(name, null), [name]);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useAction(ref: unknown): (args?: any) => Promise<any> {
  const name = functionName(ref);
  return useMemo(() => (args?: unknown) => call("action", name, args), [name]);
}

export interface WhirlClient {
  query(ref: unknown, args?: Args): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  mutation(ref: unknown, args?: Args): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  action(ref: unknown, args?: Args): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const client: WhirlClient = {
  query: (ref, args = {}) => fetchOnce(entryFor(functionName(ref), args)),
  mutation: (ref, args) => runMutation(functionName(ref), args, null),
  action: (ref, args) => call("action", functionName(ref), args),
};

/** What Whirl typed as Convex's client. */
export type ConvexReactClient = WhirlClient;

export function useConvex(): WhirlClient {
  return client;
}

/** There is one person on a Slates host, and they're already in. */
export function useConvexAuth() {
  return { isLoading: false, isAuthenticated: true } as const;
}
