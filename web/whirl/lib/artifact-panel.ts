"use client";

import { useSyncExternalStore } from "react";

/* Which artifact (document or full HTML page) the side panel is showing,
   plus its desktop fullscreen state, as a tiny module-level store (mirrors
   lib/toasts.ts) — the cards that open it and the panel that renders it
   live in different corners of the thread face. */

export type ArtifactPanelTarget =
  { kind: "document"; documentId: string } | { kind: "html"; htmlId: string };

type PanelState = {
  target: ArtifactPanelTarget | null;
  /** Desktop only: the panel fills the content area and the chat hides.
   *  Reset whenever the panel closes. */
  fullscreen: boolean;
};

let state: PanelState = { target: null, fullscreen: false };
const listeners = new Set<() => void>();

/* Artifacts that already auto-opened once (or were opened deliberately) —
   a fresh create pops the panel so the user watches it being written, but
   only the first time; closing it mid-stream must stick. */
const autoOpened = new Set<string>();

function set(next: PanelState) {
  state = next;
  for (const listener of listeners) listener();
}

export function openDocumentPanel(documentId: string) {
  autoOpened.add(documentId);
  set({ ...state, target: { kind: "document", documentId } });
}

export function openHtmlPanel(htmlId: string) {
  autoOpened.add(htmlId);
  set({ ...state, target: { kind: "html", htmlId } });
}

export function closeArtifactPanel() {
  if (state.target === null && !state.fullscreen) return;
  set({ target: null, fullscreen: false });
}

export function toggleArtifactFullscreen() {
  set({ ...state, fullscreen: !state.fullscreen });
}

export function autoOpenStreamingDocument(documentId: string) {
  if (autoOpened.has(documentId)) return;
  openDocumentPanel(documentId);
}

export function autoOpenStreamingHtml(htmlId: string) {
  if (autoOpened.has(htmlId)) return;
  openHtmlPanel(htmlId);
}

const CLOSED: PanelState = { target: null, fullscreen: false };

export function useArtifactPanel(): PanelState {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => state,
    () => CLOSED,
  );
}
