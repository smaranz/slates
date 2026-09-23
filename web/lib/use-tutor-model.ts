"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  DEFAULT_THINKING,
  DEFAULT_TUTOR_MODEL,
  isThinkingLevel,
  migrateTutorModelId,
  type ThinkingLevel,
  type TutorModelId,
} from "./tutor-models";

const MODEL_KEY = "slates.tutorModel";
const THINKING_KEY = "slates.tutorThinking";

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // Keep a second tab in sync if the student switches models there.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getModelSnapshot(): TutorModelId {
  try {
    const saved = window.localStorage.getItem(MODEL_KEY);
    const migrated = migrateTutorModelId(saved);
    if (migrated) {
      // Rewrite old Grok 4.6 ids so the next load hits the live catalog directly.
      if (saved !== migrated) window.localStorage.setItem(MODEL_KEY, migrated);
      return migrated;
    }
  } catch {
    /* private mode / storage disabled */
  }
  return DEFAULT_TUTOR_MODEL;
}

/** The prerender has no storage, so it always shows the default. */
function getModelServerSnapshot(): TutorModelId {
  return DEFAULT_TUTOR_MODEL;
}

/** The tutor model the student picked last, remembered across sessions. */
export function useTutorModel() {
  const model = useSyncExternalStore(subscribe, getModelSnapshot, getModelServerSnapshot);

  const setModel = useCallback((id: TutorModelId) => {
    try {
      window.localStorage.setItem(MODEL_KEY, id);
    } catch {
      /* ignore — the choice just won't survive a reload */
    }
    listeners.forEach((fn) => fn());
  }, []);

  return [model, setModel] as const;
}

function getThinkingSnapshot(): ThinkingLevel {
  try {
    const saved = window.localStorage.getItem(THINKING_KEY);
    if (isThinkingLevel(saved)) return saved;
  } catch {
    /* private mode / storage disabled */
  }
  return DEFAULT_THINKING;
}

function getThinkingServerSnapshot(): ThinkingLevel {
  return DEFAULT_THINKING;
}

/**
 * The thinking level applied to whichever OpenAI, Claude, or OpenRouter model
 * is selected — one shared setting, since it's a provider option rather than
 * part of the model id (unlike Grok, which bakes its own into the id).
 */
export function useTutorThinking() {
  const thinking = useSyncExternalStore(subscribe, getThinkingSnapshot, getThinkingServerSnapshot);

  const setThinking = useCallback((level: ThinkingLevel) => {
    try {
      window.localStorage.setItem(THINKING_KEY, level);
    } catch {
      /* ignore — the choice just won't survive a reload */
    }
    listeners.forEach((fn) => fn());
  }, []);

  return [thinking, setThinking] as const;
}
