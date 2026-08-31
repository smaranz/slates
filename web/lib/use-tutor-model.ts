"use client";

import { useCallback, useSyncExternalStore } from "react";

import { DEFAULT_TUTOR_MODEL, isTutorModel, type TutorModelId } from "./tutor-models";

const KEY = "slates.tutorModel";

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

function getSnapshot(): TutorModelId {
  try {
    const saved = window.localStorage.getItem(KEY);
    if (isTutorModel(saved)) return saved;
  } catch {
    /* private mode / storage disabled */
  }
  return DEFAULT_TUTOR_MODEL;
}

/** The prerender has no storage, so it always shows the default. */
function getServerSnapshot(): TutorModelId {
  return DEFAULT_TUTOR_MODEL;
}

/** The tutor model the student picked last, remembered across sessions. */
export function useTutorModel() {
  const model = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setModel = useCallback((id: TutorModelId) => {
    try {
      window.localStorage.setItem(KEY, id);
    } catch {
      /* ignore — the choice just won't survive a reload */
    }
    listeners.forEach((fn) => fn());
  }, []);

  return [model, setModel] as const;
}
