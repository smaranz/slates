"use client";

import type { ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import type { TablerIcon } from "@tabler/icons-react";
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBold,
  IconCode,
  IconH1,
  IconH2,
  IconH3,
  IconItalic,
  IconList,
  IconListNumbers,
  IconMathFunction,
  IconQuote,
  IconSourceCode,
  IconStrikethrough,
  IconTablePlus,
} from "@tabler/icons-react";

/**
 * The formatting tool row for the markdown editor. Buttons mirror the TipTap
 * StarterKit commands and light up to reflect the selection's active marks and
 * nodes. Re-renders with its parent on every editor transaction, so active
 * state stays in sync.
 */
export function MarkdownToolbar({ editor }: { editor: Editor }) {
  const insertTable = () => {
    editor
      .chain()
      .focus()
      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
      .run();
  };

  const insertFormula = () => {
    /* Insert an empty display formula; its NodeView opens straight into
       edit mode so the user can type the LaTeX. */
    editor
      .chain()
      .focus()
      .insertContent({ type: "blockMath", attrs: { latex: "" } })
      .run();
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-border bg-surface px-2 py-1.5">
      <ToolButton
        icon={IconArrowBackUp}
        label="Undo"
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
      />
      <ToolButton
        icon={IconArrowForwardUp}
        label="Redo"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
      />

      <Divider />

      <ToolButton
        icon={IconH1}
        label="Heading 1"
        active={editor.isActive("heading", { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      />
      <ToolButton
        icon={IconH2}
        label="Heading 2"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      />
      <ToolButton
        icon={IconH3}
        label="Heading 3"
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      />

      <Divider />

      <ToolButton
        icon={IconBold}
        label="Bold"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <ToolButton
        icon={IconItalic}
        label="Italic"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <ToolButton
        icon={IconStrikethrough}
        label="Strikethrough"
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      />
      <ToolButton
        icon={IconCode}
        label="Inline code"
        active={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
      />

      <Divider />

      <ToolButton
        icon={IconList}
        label="Bullet list"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <ToolButton
        icon={IconListNumbers}
        label="Numbered list"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <ToolButton
        icon={IconQuote}
        label="Quote"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      />
      <ToolButton
        icon={IconSourceCode}
        label="Code block"
        active={editor.isActive("codeBlock")}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      />

      <Divider />

      <ToolButton
        icon={IconTablePlus}
        label="Insert table"
        onClick={insertTable}
      />
      <ToolButton
        icon={IconMathFunction}
        label="Insert formula"
        onClick={insertFormula}
      />
    </div>
  );
}

function ToolButton({
  icon,
  label,
  onClick,
  active = false,
  disabled = false,
}: {
  icon: TablerIcon;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  const Glyph = icon;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      // Keep focus in the document so the command applies to the selection.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-30 ${
        active
          ? "bg-black/[0.08] text-foreground dark:bg-white/[0.14]"
          : "text-muted-foreground hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.07]"
      }`}
    >
      <Glyph size={15} stroke={2} />
    </button>
  );
}

function Divider(): ReactNode {
  return <span className="mx-1 h-4 w-px bg-black/[0.08] dark:bg-white/[0.1]" />;
}
