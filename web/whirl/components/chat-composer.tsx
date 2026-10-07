"use client";

import type { ComponentProps } from "react";

import { setComposerDraft, useComposerDraft } from "@whirl/lib/composer-draft";
import { Composer } from "./composer";

/* The chat face's message bar: the same Composer everyone else renders,
   with its draft wired to lib/composer-draft's store instead of state on
   the chat face. Typing re-renders this component and the pill under it —
   the transcript, the dock's layout projection, and the chat face's own
   hooks all sit still. The marketing and debug composers keep passing their
   own value/onValueChange; only this one is store-backed. */
export function ChatComposer(
  props: Omit<ComponentProps<typeof Composer>, "value" | "onValueChange">,
) {
  const value = useComposerDraft();
  return (
    <Composer {...props} value={value} onValueChange={setComposerDraft} />
  );
}
