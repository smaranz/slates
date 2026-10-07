"use client";

import { useEffect, useRef, useState } from "react";
import { IconMessagePlus } from "@tabler/icons-react";

/**
 * A deliberately small source-file editor. Code documents stay raw text so
 * edits and downloads never pick up rich-text transformations.
 */
export function CodeDocumentEditor({
  value,
  onChange,
  editable = true,
  stickToBottom = false,
  onAddSelectionToChat,
}: {
  value: string;
  onChange?: (value: string) => void;
  editable?: boolean;
  stickToBottom?: boolean;
  onAddSelectionToChat?: (selectedText: string) => void;
}) {
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [selection, setSelection] = useState("");

  /* Cancelled on re-run: `value` changes per streamed token, and without
     the cleanup every token left one more pending frame, each forcing a
     fresh layout read on the same tick. One live frame is plenty. */
  useEffect(() => {
    if (!stickToBottom) return;
    const frame = requestAnimationFrame(() => {
      const editor = editorRef.current;
      if (editor) editor.scrollTop = editor.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [value, stickToBottom]);

  const refreshSelection = () => {
    const editor = editorRef.current;
    if (!editor || !onAddSelectionToChat) return;
    setSelection(
      editor.value.slice(editor.selectionStart, editor.selectionEnd).trim(),
    );
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!editable || event.key !== "Tab") return;
    event.preventDefault();
    const editor = event.currentTarget;
    const next = `${value.slice(0, editor.selectionStart)}  ${value.slice(editor.selectionEnd)}`;
    const cursor = editor.selectionStart + 2;
    onChange?.(next);
    requestAnimationFrame(() => {
      editor.selectionStart = cursor;
      editor.selectionEnd = cursor;
    });
  };

  return (
    <div className="relative h-full min-h-0 bg-background">
      <textarea
        ref={editorRef}
        aria-label="Code document"
        value={value}
        readOnly={!editable}
        spellCheck={false}
        wrap="off"
        onChange={(event) => onChange?.(event.target.value)}
        onSelect={refreshSelection}
        onKeyUp={refreshSelection}
        onKeyDown={handleKeyDown}
        className="h-full w-full resize-none overflow-auto bg-transparent px-5 py-4 font-mono text-[13px]/6 text-foreground caret-primary outline-none selection:bg-primary/20"
      />
      {selection && onAddSelectionToChat ? (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onAddSelectionToChat(selection);
            setSelection("");
            editorRef.current?.focus();
          }}
          className="absolute right-4 bottom-4 flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-background px-3 text-[12px]/4 font-medium shadow-md transition-colors hover:bg-muted"
        >
          <IconMessagePlus size={14} stroke={2} />
          Add to chat
        </button>
      ) : null}
    </div>
  );
}
