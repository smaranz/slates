/**
 * One-shot handoff into the home composer. Storage keeps the prompt out of
 * the URL, and every access is guarded so SSR and hydration never read a
 * browser-only global.
 */

const KEY = "whirl:composer-prefill";
let claimedPrefill: string | undefined;

export function stashComposerPrefill(text: string) {
  if (typeof window === "undefined") return;
  claimedPrefill = undefined;
  try {
    window.sessionStorage.setItem(KEY, text);
  } catch {
    // Storage unavailable — navigation still succeeds with an empty draft.
  }
}

export function takeComposerPrefill(): string | null {
  if (claimedPrefill !== undefined) return claimedPrefill;
  if (typeof window === "undefined") return null;
  try {
    const text = window.sessionStorage.getItem(KEY);
    if (text !== null) window.sessionStorage.removeItem(KEY);
    if (text !== null) claimedPrefill = text;
    return text;
  } catch {
    return null;
  }
}

/** Acknowledge only after React has accepted the draft. Until then the
 * in-memory claim survives an effect replay or fast remount. */
export function finishComposerPrefill(text: string) {
  if (claimedPrefill === text) claimedPrefill = undefined;
}
