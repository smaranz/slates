import type { ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import type { TablerIcon } from "@tabler/icons-react";
import {
  IconColumnInsertLeft,
  IconColumnInsertRight,
  IconColumnRemove,
  IconHeading,
  IconRowInsertBottom,
  IconRowInsertTop,
  IconRowRemove,
  IconTableOff,
} from "@tabler/icons-react";

/**
 * A floating control strip for editing a table's structure. It surfaces only
 * while the selection sits inside a table (mirroring how TipTap bubble menus
 * work), with add/remove row + column actions, a header-row toggle, and a
 * delete. Styling matches the editor's toolbar so it reads as part of the same
 * surface in both themes.
 */
export function TableMenu({ editor }: { editor: Editor }) {
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableMenu"
      shouldShow={({ editor }) => editor.isEditable && editor.isActive("table")}
      // Portal to the body so the editor's scroll container can't clip the menu.
      appendTo={() => document.body}
      options={{ placement: "top", offset: 8 }}
    >
      <div className="flex items-center gap-0.5 rounded-lg border border-black/[0.08] bg-white p-1 shadow-md dark:border-white/[0.1] dark:bg-[#2a2a2a]">
        <Action
          icon={IconColumnInsertLeft}
          label="Add column before"
          onClick={() => editor.chain().focus().addColumnBefore().run()}
        />
        <Action
          icon={IconColumnInsertRight}
          label="Add column after"
          onClick={() => editor.chain().focus().addColumnAfter().run()}
        />
        <Action
          icon={IconColumnRemove}
          label="Delete column"
          onClick={() => editor.chain().focus().deleteColumn().run()}
        />
        <Divider />
        <Action
          icon={IconRowInsertTop}
          label="Add row above"
          onClick={() => editor.chain().focus().addRowBefore().run()}
        />
        <Action
          icon={IconRowInsertBottom}
          label="Add row below"
          onClick={() => editor.chain().focus().addRowAfter().run()}
        />
        <Action
          icon={IconRowRemove}
          label="Delete row"
          onClick={() => editor.chain().focus().deleteRow().run()}
        />
        <Divider />
        <Action
          icon={IconHeading}
          label="Toggle header row"
          active={editor.isActive("tableHeader")}
          onClick={() => editor.chain().focus().toggleHeaderRow().run()}
        />
        <Action
          icon={IconTableOff}
          label="Delete table"
          danger
          onClick={() => editor.chain().focus().deleteTable().run()}
        />
      </div>
    </BubbleMenu>
  );
}

function Action({
  icon,
  label,
  onClick,
  active = false,
  danger = false,
}: {
  icon: TablerIcon;
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  const Glyph = icon;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
        danger
          ? "text-red-500 hover:bg-red-500/10 dark:text-red-400"
          : active
            ? "bg-black/[0.08] text-neutral-900 dark:bg-white/[0.14] dark:text-neutral-50"
            : "text-neutral-600 hover:bg-black/[0.05] dark:text-neutral-300 dark:hover:bg-white/[0.07]"
      }`}
    >
      <Glyph size={15} stroke={2} />
    </button>
  );
}

function Divider(): ReactNode {
  return (
    <span className="mx-0.5 h-4 w-px bg-black/[0.08] dark:bg-white/[0.1]" />
  );
}
