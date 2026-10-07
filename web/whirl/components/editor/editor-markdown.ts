import type { Editor } from "@tiptap/react";

/* Deliberately its own module, and deliberately tiny.

   The download menu needs this one accessor off a live editor, but it is
   rendered in the artifact panel's header — which mounts long before (and
   often without) any editor. Importing it from markdown-editor.tsx pulled
   TipTap, ProseMirror and KaTeX into whatever bundle the menu landed in,
   which defeated lazily loading the editor at all. The `Editor` import here
   is type-only, so it erases at build time and this file costs nothing. */

/** tiptap-markdown registers this on `editor.storage` but ships no types. */
export function getMarkdown(editor: Editor): string {
  return (
    editor.storage as unknown as { markdown: { getMarkdown: () => string } }
  ).markdown.getMarkdown();
}
