"use client";

import { useSyncExternalStore } from "react";

/* Tiny module-level toast store (mirrors the main app's data/toasts.ts).
   Deletes are "pending" here for the undo window: the thread is hidden
   from useThreads immediately, and the real (hard) Convex delete only
   runs when the timer commits. Undo cancels the timer — the server never
   hears about it. */

export type Toast = {
  id: number;
  message: string;
  action?: { label: string; onAction: () => void };
  kind?: "delete" | "update";
};

const UNDO_WINDOW_MS = 5000;

let nextId = 1;
let toasts: Toast[] = [];
const pending = new Map<
  string,
  { timer: ReturnType<typeof setTimeout>; toastId: number }
>();
let pendingIds: ReadonlySet<string> = new Set();

const listeners = new Set<() => void>();
const EMPTY_TOASTS: Toast[] = [];
const EMPTY_IDS: ReadonlySet<string> = new Set();

function emit() {
  pendingIds = new Set(pending.keys());
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    subscribe,
    () => toasts,
    () => EMPTY_TOASTS,
  );
}

/* Ids (thread ids, etc.) currently hidden while their delete toast ticks. */
export function usePendingDeleteIds(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribe,
    () => pendingIds,
    () => EMPTY_IDS,
  );
}

/* Fire-and-forget a mutation, surfacing failures as a toast. */
export function runMutation(promise: Promise<unknown>) {
  void promise.catch(() => showToast("Something went wrong. Try again?"));
}

export function dismissToast(toastId: number) {
  toasts = toasts.filter((toast) => toast.id !== toastId);
  emit();
}

export function showToast(message: string, durationMs = UNDO_WINDOW_MS) {
  const id = nextId++;
  toasts = [...toasts, { id, message }];
  emit();
  setTimeout(() => dismissToast(id), durationMs);
}

let updateToastId: number | null = null;
export function showUpdateToast(reload: () => void) {
  if (updateToastId !== null) return;
  const id = nextId++;
  updateToastId = id;
  toasts = [
    ...toasts,
    {
      id,
      message: "A new version is available",
      kind: "update",
      action: { label: "Refresh", onAction: reload },
    },
  ];
  emit();
}

/* The deployment feed can briefly lag a freshly loaded client. Clearing the
   update toast when the versions converge makes that hand-off self-healing,
   and resetting the id allows a later real deployment to prompt again. */
export function dismissUpdateToast() {
  if (updateToastId === null) return;
  const id = updateToastId;
  updateToastId = null;
  dismissToast(id);
}

/* Hide `id` now, show an undoable toast, and hard-commit after the window
   passes untouched. Re-requesting the same id restarts its window. */
export function requestDelete({
  id,
  message,
  commit,
  errorMessage = "Couldn't delete that. Try again.",
}: {
  id: string;
  message: string;
  commit: () => Promise<unknown>;
  errorMessage?: string;
}) {
  const existing = pending.get(id);
  if (existing) {
    clearTimeout(existing.timer);
    toasts = toasts.filter((toast) => toast.id !== existing.toastId);
    pending.delete(id);
  }

  const toastId = nextId++;
  const timer = setTimeout(() => {
    /* The undo affordance can leave now, but the deletion tombstone cannot.
       Keep the row filtered until the mutation settles so stale query data
       never gets one render in which to put it back. */
    dismissToast(toastId);
    void Promise.resolve()
      .then(commit)
      .then(
        () => {
          pending.delete(id);
          emit();
        },
        () => {
          pending.delete(id);
          showToast(errorMessage);
        },
      );
  }, UNDO_WINDOW_MS);
  pending.set(id, { timer, toastId });

  toasts = [
    ...toasts,
    {
      id: toastId,
      message,
      kind: "delete",
      action: { label: "Undo", onAction: () => undoDelete(id) },
    },
  ];
  emit();
}

export function undoDelete(id: string) {
  const entry = pending.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(id);
  dismissToast(entry.toastId);
}
