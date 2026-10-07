"use client";

import { useEffect, useRef, useState } from "react";
import {
  IconArrowUp,
  IconCheck,
  IconCopy,
  IconPencil,
  IconX,
} from "@tabler/icons-react";

import { SquishButton } from "@whirl/components/squish-button";
import type { ChatMessage } from "@whirl/lib/messages";
import { MessageActionButton } from "./message-action-button";
import { MessageAttachments } from "./message-attachments";

/* One user turn: attachments up top, then the prompt in a well-toned
   capsule hugging the right edge. Plain text on purpose — prompts aren't
   markdown, and rendering them as such mangles code pastes.

   Editing swaps the capsule for an in-place editor; saving resends from
   that point (the reply after it regenerates). */

export function UserMessage({
  message,
  onEdit,
}: {
  message: ChatMessage;
  /** Save an edited prompt (and regenerate the reply that follows).
   *  Absent — debug fixtures, signed-out views — hides the affordance. */
  onEdit?: (content: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const canEdit = onEdit !== undefined && message.content.length > 0;

  return (
    <div className="group/msg flex min-w-0 flex-col items-end gap-2">
      {message.attachments && message.attachments.length > 0 && (
        <MessageAttachments attachments={message.attachments} />
      )}
      {editing && onEdit ? (
        <EditCard
          initial={message.content}
          onCancel={() => setEditing(false)}
          onSave={(content) => {
            setEditing(false);
            onEdit(content);
          }}
        />
      ) : (
        <>
          {message.content.length > 0 && (
            <div
              data-quotable="user"
              className="min-w-0 max-w-[85%] rounded-[20px] rounded-br-md bg-well px-3.5 py-2 text-[15px]/6 break-words whitespace-pre-wrap [overflow-wrap:anywhere] shadow-[inset_0_0_0_1px_var(--well-outline),inset_0_1px_0_0_var(--well-highlight)]"
            >
              {message.content}
            </div>
          )}
          <div className="-mt-1 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/msg:opacity-100 focus-within:opacity-100 coarse:opacity-100">
            {canEdit && (
              <MessageActionButton
                label="Edit message"
                onClick={() => setEditing(true)}
              >
                <IconPencil size={15} />
              </MessageActionButton>
            )}
            <CopyAction text={message.content} />
          </div>
        </>
      )}
    </div>
  );
}

/* The in-place editor: the bubble opened up, wearing the composer's
   manners — content-fit width, Enter resends, a round arrow-up to send it
   off. Saving is a resend: the reply after this message runs again on the
   new words. */
function EditCard({
  initial,
  onCancel,
  onSave,
}: {
  initial: string;
  onCancel: () => void;
  onSave: (content: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const trimmed = value.trim();
  const canSave = trimmed.length > 0 && trimmed !== initial.trim();

  return (
    <div className="w-fit min-w-0 max-w-[85%] rounded-[20px] rounded-br-md bg-well p-2 shadow-[inset_0_0_0_1px_var(--well-outline),inset_0_1px_0_0_var(--well-highlight)]">
      {/* The classic mirror-in-a-grid: an invisible copy of the draft sets
          both width and height, the textarea just fills the cell — so the
          capsule hugs the words like the bubble it replaced. */}
      <div className="grid max-h-60 overflow-y-auto">
        <div
          aria-hidden
          className="invisible col-start-1 row-start-1 px-1.5 py-0.5 field-text break-words whitespace-pre-wrap [overflow-wrap:anywhere]"
        >
          {value}{" "}
        </div>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            } else if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (canSave) onSave(trimmed);
              else onCancel();
            }
          }}
          aria-label="Edit message"
          className="col-start-1 row-start-1 block h-full w-full resize-none overflow-hidden bg-transparent px-1.5 py-0.5 field-text caret-foreground outline-none"
        />
      </div>
      <div className="mt-1.5 flex items-center justify-end gap-1.5">
        <button
          type="button"
          aria-label="Cancel edit"
          onClick={onCancel}
          className="flex size-8 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.06]"
        >
          <IconX size={16} />
        </button>
        <SquishButton
          aria-label="Save and resend"
          disabled={!canSave}
          onClick={() => onSave(trimmed)}
          className="size-8 shrink-0 justify-center rounded-full p-0 transition-[background-color,scale,opacity] disabled:pointer-events-none disabled:opacity-40"
        >
          <IconArrowUp size={16} stroke={2.5} />
        </SquishButton>
      </div>
    </div>
  );
}

function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  if (text.length === 0) return null;
  return (
    <MessageActionButton
      label="Copy message"
      tooltip={copied ? "Copied" : "Copy message"}
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => {});
      }}
    >
      {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
    </MessageActionButton>
  );
}
