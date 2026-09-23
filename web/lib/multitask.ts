"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Multitask — Cursor-shaped parallel turns for Slates.
 *
 * Matched to Cursor's Agents Window Multitask / `/multitask` behavior
 * (cursor.com/changelog/04-24-26, cursor.com/help/ai-features/multi-agent):
 * when the mode is on, a new request runs as a background task instead of
 * queuing behind (or locking) the current turn; independent tasks run side
 * by side; the composer stays free; a short-titled strip shows progress and
 * surfaces a finished result without forcing the user to sit on a spinner.
 */

const PREF_KEY = "slates.multitask";

export type MultitaskSurface = "tutor" | "counselor";
export type MultitaskStatus = "running" | "done" | "error" | "stopped";

export type MultitaskTask = {
  id: string;
  title: string;
  surface: MultitaskSurface;
  /** Tutor chat id or counselor thread id. */
  chatId: string;
  replyId: string;
  status: MultitaskStatus;
  startedAt: number;
  finishedAt?: number;
  error?: string;
};

const prefListeners = new Set<() => void>();
const taskListeners = new Set<() => void>();

let tasks: MultitaskTask[] = [];
/** Session override so the toggle still works when localStorage is blocked. */
let prefMemory: boolean | null = null;
const abortByTask = new Map<string, AbortController>();
/** Finished tasks stay visible briefly, then drop — like Cursor's completion ping. */
const dismissTimers = new Map<string, number>();

function notifyPref() {
  prefListeners.forEach((fn) => fn());
}

function notifyTasks() {
  taskListeners.forEach((fn) => fn());
}

function setTasks(next: MultitaskTask[]) {
  tasks = next;
  notifyTasks();
}

function readStoredPref(): boolean {
  try {
    return window.localStorage.getItem(PREF_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribePref(onChange: () => void) {
  prefListeners.add(onChange);
  const onStorage = () => {
    prefMemory = null;
    onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    prefListeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function getPrefSnapshot(): boolean {
  return prefMemory ?? readStoredPref();
}

function getPrefServerSnapshot(): boolean {
  return false;
}

/** Whether Multitask mode is on — remembered across sessions. */
export function useMultitaskEnabled() {
  const enabled = useSyncExternalStore(subscribePref, getPrefSnapshot, getPrefServerSnapshot);

  const setEnabled = useCallback((on: boolean) => {
    prefMemory = on;
    try {
      window.localStorage.setItem(PREF_KEY, on ? "1" : "0");
    } catch {
      /* keep the in-memory choice for this session */
    }
    notifyPref();
  }, []);

  const toggle = useCallback(() => {
    setEnabled(!getPrefSnapshot());
  }, [setEnabled]);

  return { enabled, setEnabled, toggle } as const;
}

function subscribeTasks(onChange: () => void) {
  taskListeners.add(onChange);
  return () => {
    taskListeners.delete(onChange);
  };
}

function getTasksSnapshot(): MultitaskTask[] {
  return tasks;
}

function getTasksServerSnapshot(): MultitaskTask[] {
  return EMPTY_TASKS;
}

const EMPTY_TASKS: MultitaskTask[] = [];

/** Live list of background turns for the Multitask strip. */
export function useMultitaskTasks(surface?: MultitaskSurface) {
  const all = useSyncExternalStore(subscribeTasks, getTasksSnapshot, getTasksServerSnapshot);
  if (!surface) return all;
  return all.filter((t) => t.surface === surface);
}

/** A few words from the prompt — Cursor shows short task titles, not the whole ask. */
export function titleFromPrompt(text: string, fallback = "Task"): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return fallback;
  const withoutCmd = cleaned.replace(/^\/multitask\b\s*/i, "").trim() || cleaned;
  const words = withoutCmd.split(" ").filter(Boolean).slice(0, 5);
  let title = words.join(" ");
  if (title.length > 40) {
    title = `${title.slice(0, 37).replace(/\s+\S*$/, "") || title.slice(0, 37)}…`;
  } else if (withoutCmd.split(" ").length > 5) {
    title = `${title}…`;
  }
  return title || fallback;
}

/**
 * If the student typed Cursor's `/multitask` command, turn the mode on and
 * strip it from the message so the model never sees the slash command.
 */
export function consumeMultitaskCommand(
  text: string,
  setEnabled: (on: boolean) => void
): { text: string; forced: boolean } {
  const match = /^\/multitask(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!match) return { text, forced: false };
  setEnabled(true);
  return { text: (match[1] ?? "").trim(), forced: true };
}

let taskSeq = 0;

export function startMultitaskTask(input: {
  title: string;
  surface: MultitaskSurface;
  chatId: string;
  replyId: string;
  controller: AbortController;
}): string {
  const id = `mt${Date.now()}-${++taskSeq}`;
  abortByTask.set(id, input.controller);
  const task: MultitaskTask = {
    id,
    title: input.title,
    surface: input.surface,
    chatId: input.chatId,
    replyId: input.replyId,
    status: "running",
    startedAt: Date.now(),
  };
  setTasks([task, ...tasks].slice(0, 24));
  return id;
}

export function finishMultitaskTask(
  id: string,
  status: Exclude<MultitaskStatus, "running">,
  error?: string
) {
  abortByTask.delete(id);
  const finishedAt = Date.now();
  setTasks(
    tasks.map((t) =>
      t.id === id
        ? { ...t, status, finishedAt, error: error || undefined }
        : t
    )
  );
  const existing = dismissTimers.get(id);
  if (existing) window.clearTimeout(existing);
  // Keep done/error chips around long enough to notice, then clear.
  const delay = status === "done" ? 12_000 : 18_000;
  dismissTimers.set(
    id,
    window.setTimeout(() => {
      dismissTimers.delete(id);
      dismissMultitaskTask(id);
    }, delay)
  );
}

export function dismissMultitaskTask(id: string) {
  const timer = dismissTimers.get(id);
  if (timer) {
    window.clearTimeout(timer);
    dismissTimers.delete(id);
  }
  abortByTask.delete(id);
  setTasks(tasks.filter((t) => t.id !== id));
}

/** Stop one background turn the way Cursor cancels a subagent. */
export function stopMultitaskTask(id: string) {
  const controller = abortByTask.get(id);
  if (controller) {
    controller.abort();
    abortByTask.delete(id);
  }
  finishMultitaskTask(id, "stopped");
}

export function abortControllersForChat(chatId: string) {
  for (const task of tasks) {
    if (task.chatId === chatId && task.status === "running") {
      stopMultitaskTask(task.id);
    }
  }
}

export function runningTaskCount(surface?: MultitaskSurface): number {
  return tasks.filter(
    (t) => t.status === "running" && (!surface || t.surface === surface)
  ).length;
}
