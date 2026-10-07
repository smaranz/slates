import { Extension, type Editor } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * A tiny ProseMirror plugin that paints transient highlight decorations over
 * whatever ranges whirl just changed, so an incoming edit is *seen*, not missed.
 * The decorations carry a CSS class (`edit-flash`) whose keyframes — defined in
 * app.css — fade the highlight out on their own; we just clear the set after.
 */
export const editHighlightKey = new PluginKey<DecorationSet>("editHighlight");

export const EditHighlight = Extension.create({
  name: "editHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: editHighlightKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const meta = tr.getMeta(editHighlightKey) as
              { decorations: DecorationSet } | undefined;
            if (meta) return meta.decorations;
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return editHighlightKey.getState(state);
          },
        },
      }),
    ];
  },
});

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strip the markdown syntax off a snippet so it has a fighting chance of
 * matching the *rendered* text in the editor (e.g. `## Title` → `Title`,
 * `**bold**` → `bold`). Best-effort — enough to anchor the highlight.
 */
function stripMarkdown(input: string): string {
  return input
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]/g, "")
    .trim();
}

/** Find every range in the doc matching `search`, tolerant of whitespace runs. */
function findRanges(
  doc: ProseNode,
  search: string,
): { from: number; to: number }[] {
  const needle = search.trim();
  if (needle.length < 2) return [];
  const pattern = needle
    .split(/\s+/)
    .filter(Boolean)
    .map(escapeRegExp)
    .join("\\s+");
  if (!pattern) return [];

  const re = new RegExp(pattern, "g");
  const ranges: { from: number; to: number }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(node.text)) !== null) {
      ranges.push({ from: pos + m.index, to: pos + m.index + m[0].length });
      if (m[0].length === 0) re.lastIndex += 1;
    }
    return true;
  });
  return ranges;
}

/**
 * Flash a highlight over the given (markdown) snippets. Returns true if any
 * range was found and painted — callers fall back to a coarser cue otherwise.
 */
export function flashEditHighlight(
  editor: Editor,
  snippets: string[],
): boolean {
  const ranges = snippets
    .flatMap((snippet) => findRanges(editor.state.doc, stripMarkdown(snippet)))
    .sort((a, b) => a.from - b.from);
  if (ranges.length === 0) return false;

  const decorations = DecorationSet.create(
    editor.state.doc,
    ranges.map((r) => Decoration.inline(r.from, r.to, { class: "edit-flash" })),
  );
  editor.view.dispatch(
    editor.state.tr.setMeta(editHighlightKey, { decorations }),
  );
  return true;
}

/** Clear any active edit highlights. */
export function clearEditHighlight(editor: Editor) {
  editor.view.dispatch(
    editor.state.tr.setMeta(editHighlightKey, {
      decorations: DecorationSet.empty,
    }),
  );
}
