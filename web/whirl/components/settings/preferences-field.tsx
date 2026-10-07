"use client";

import { useEffect, useRef, useState } from "react";
import { useUser } from "@whirl/backend/auth";
import { useMutation, useQuery } from "@whirl/backend/react";
import { api } from "@whirl/backend/convex/_generated/api";

import { showToast } from "@whirl/lib/toasts";
import { SettingsRow } from "./settings-rows";

/* Mirrors the backend's MAX_PREFERENCES_LENGTH (convex/preferences.ts). */
const MAX_PREFERENCES_LENGTH = 2000;

/* Free-text "tell the AI about yourself" field. Saves on blur; the text is
   injected into the model's system prompt as explicit user preferences.
   Signed-in only — there's no account to pin it to otherwise. */
export function PreferencesField() {
  const { user } = useUser();
  const stored = useQuery(api.preferences.getPreferences, user ? {} : "skip");
  const save = useMutation(api.preferences.setPreferences);

  const [text, setText] = useState<string | null>(null);
  const savingRef = useRef(false);

  /* Seed local state once the stored value loads; never clobber
     in-progress edits. */
  useEffect(() => {
    if (text === null && stored !== undefined) {
      setText(stored?.text ?? "");
    }
  }, [stored, text]);

  if (!user) return null;

  const commit = async () => {
    if (text === null || savingRef.current) return;
    const trimmed = text.trim();
    if (trimmed === (stored?.text ?? "")) return;

    savingRef.current = true;
    try {
      await save({ text: trimmed });
    } catch {
      showToast("Couldn't save your preferences. Try again.");
    } finally {
      savingRef.current = false;
    }
  };

  return (
    <SettingsRow
      title="Your preferences"
      description="Anything Whirl should know about you — tone, interests, how you like answers. Applied to every conversation."
    >
      <textarea
        value={text ?? ""}
        onChange={(event) =>
          setText(event.target.value.slice(0, MAX_PREFERENCES_LENGTH))
        }
        onBlur={() => void commit()}
        disabled={text === null}
        rows={5}
        maxLength={MAX_PREFERENCES_LENGTH}
        placeholder="e.g. I'm a med student, keep explanations short, no emojis please"
        className="w-full resize-y rounded-lg bg-well px-3 py-2.5 text-[13px]/5 shadow-[inset_0_0_0_1px_var(--well-outline),inset_0_1px_0_0_var(--well-highlight)] outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      />
      {text !== null && text.length >= MAX_PREFERENCES_LENGTH - 200 && (
        <p className="mt-1 text-right text-[11px]/4 tabular-nums text-muted-foreground">
          {text.length} / {MAX_PREFERENCES_LENGTH}
        </p>
      )}
    </SettingsRow>
  );
}
