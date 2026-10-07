import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

import { KatexFormula } from "@whirl/components/math/katex-formula";

/**
 * The in-editor view for an `inlineMath` / `blockMath` node. It renders the
 * LaTeX with KaTeX (reusing {@link KatexFormula}); when the editor is editable,
 * clicking a formula opens a small inline editor over the raw TeX. A freshly
 * inserted (empty) formula opens straight into edit mode. Committing an empty
 * formula removes the node, so an abandoned insert doesn't leave a stray atom.
 */
export function MathNodeView({
  node,
  updateAttributes,
  deleteNode,
  editor,
  selected,
}: NodeViewProps) {
  const isBlock = node.type.name === "blockMath";
  const latex = (node.attrs.latex as string) ?? "";
  const editable = editor.isEditable;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(latex);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const didAutoOpen = useRef(false);

  // A just-inserted empty formula opens its editor immediately so the user can
  // start typing — but only once, and only while editable.
  useEffect(() => {
    if (didAutoOpen.current) return;
    didAutoOpen.current = true;
    if (editable && !latex.trim()) {
      setDraft("");
      setEditing(true);
    }
  }, [editable, latex]);

  // Focus + size the textarea to its content as soon as the editor opens.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!editing || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editing]);

  const open = () => {
    if (!editable) return;
    setDraft(latex);
    setEditing(true);
  };

  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (!next) {
      deleteNode();
      return;
    }
    if (next !== latex) updateAttributes({ latex: next });
  };

  const cancel = () => {
    setEditing(false);
    if (!latex.trim()) deleteNode(); // bail on an abandoned fresh insert
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    } else if (e.key === "Enter" && (!isBlock || e.metaKey || e.ctrlKey)) {
      // Inline math commits on Enter; block math keeps Enter for newlines and
      // commits on ⌘/Ctrl+Enter.
      e.preventDefault();
      commit();
    }
  };

  if (editing) {
    return (
      <NodeViewWrapper
        as={isBlock ? "div" : "span"}
        className={
          isBlock ? "my-3 flex justify-center" : "inline-block align-middle"
        }
      >
        <span
          className="inline-flex flex-col gap-1.5 rounded-lg border border-[#0c82f2]/40 bg-white p-2 align-middle shadow-sm dark:border-[#0c82f2]/50 dark:bg-[#222]"
          contentEditable={false}
        >
          <span className="flex min-h-[1.5rem] items-center justify-center px-1">
            {draft.trim() ? (
              <KatexFormula tex={draft} display={isBlock} />
            ) : (
              <span className="text-[12px] text-neutral-400 dark:text-neutral-500">
                {isBlock ? "Display formula" : "Inline formula"} preview
              </span>
            )}
          </span>
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            onBlur={commit}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            rows={1}
            placeholder="\frac{a}{b}"
            className="w-56 resize-none rounded-md bg-black/[0.04] px-2 py-1 font-mono text-[12.5px] text-neutral-800 outline-none placeholder:text-neutral-400 focus:bg-black/[0.06] dark:bg-white/[0.06] dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:bg-white/[0.09]"
          />
        </span>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as={isBlock ? "div" : "span"}
      className={
        isBlock ? "my-3 flex justify-center" : "inline-block align-middle"
      }
    >
      <span
        contentEditable={false}
        onClick={open}
        role={editable ? "button" : undefined}
        title={editable ? "Click to edit formula" : undefined}
        className={`${
          isBlock ? "block px-2 py-1" : "inline-block px-0.5"
        } rounded-md transition-colors ${
          editable ? "cursor-pointer hover:bg-[#0c82f2]/[0.08]" : ""
        } ${selected ? "bg-[#0c82f2]/[0.12]" : ""}`}
      >
        {latex.trim() ? (
          <KatexFormula tex={latex} display={isBlock} />
        ) : (
          <span className="text-[12px] italic text-neutral-400 dark:text-neutral-500">
            empty formula
          </span>
        )}
      </span>
    </NodeViewWrapper>
  );
}
