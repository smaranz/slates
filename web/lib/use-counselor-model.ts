"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  DEFAULT_COUNSELOR_MODEL,
  isCounselorModel,
  normalizeCounselorThinking,
  type CounselorModelId,
} from "./counselor/models";
import { DEFAULT_THINKING, type ThinkingLevel } from "./tutor-models";

const MODEL_KEY = "slates.counselorModel";
const THINKING_KEY = "slates.counselorThinking";
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function modelSnapshot(): CounselorModelId {
  try {
    const value = window.localStorage.getItem(MODEL_KEY);
    if (isCounselorModel(value)) return value;
  } catch {}
  return DEFAULT_COUNSELOR_MODEL;
}

function thinkingSnapshot(): ThinkingLevel {
  try {
    return normalizeCounselorThinking(window.localStorage.getItem(THINKING_KEY));
  } catch {}
  return DEFAULT_THINKING;
}

export function useCounselorModel() {
  const model = useSyncExternalStore(subscribe, modelSnapshot, () => DEFAULT_COUNSELOR_MODEL);
  const setModel = useCallback((next: CounselorModelId) => {
    try { window.localStorage.setItem(MODEL_KEY, next); } catch {}
    listeners.forEach((listener) => listener());
  }, []);
  return [model, setModel] as const;
}

export function useCounselorThinking() {
  const thinking = useSyncExternalStore(subscribe, thinkingSnapshot, () => DEFAULT_THINKING);
  const setThinking = useCallback((next: ThinkingLevel) => {
    try { window.localStorage.setItem(THINKING_KEY, next); } catch {}
    listeners.forEach((listener) => listener());
  }, []);
  return [thinking, setThinking] as const;
}
