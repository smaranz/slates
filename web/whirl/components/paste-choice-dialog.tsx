"use client";

import { useState } from "react";
import { IconAlignLeft, IconPaperclip, type Icon } from "@tabler/icons-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@whirl/components/ui/dialog";
import { ToggleSwitch } from "./toggle-switch";

export type PasteChoice = "message" | "attachment";

/* Asks whether a big chunk of pasted text should land inline in the
   composer or ride along as a .md attachment — v1's PasteChoiceModal in
   v2 clothes. Only shows past the length threshold, so short pastes never
   get interrupted. "Don't ask again" rides along with the choice so the
   caller can silence the dialog for good (future big pastes go inline). */
export function PasteChoiceDialog({
  open,
  charCount,
  onChoose,
  onOpenChange,
}: {
  open: boolean;
  charCount: number;
  onChoose: (choice: PasteChoice, dontAskAgain: boolean) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [dontAskAgain, setDontAskAgain] = useState(false);

  /* Reset the tickbox on every close so the next paste starts fresh —
     done in the handlers (not an effect) to keep renders quiet. */
  const handleOpenChange = (next: boolean) => {
    if (!next) setDontAskAgain(false);
    onOpenChange(next);
  };

  const choose = (choice: PasteChoice) => {
    onChoose(choice, dontAskAgain);
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>That&apos;s a big paste</DialogTitle>
          <DialogDescription>
            {charCount.toLocaleString()} characters — keep it inline, or tuck
            it into a file?
          </DialogDescription>
        </DialogHeader>
        <div className="mt-3 flex flex-col gap-1.5">
          <ChoiceRow
            icon={IconAlignLeft}
            title="Paste as message"
            blurb="Drop the text straight into the composer"
            autoFocus
            onClick={() => choose("message")}
          />
          <ChoiceRow
            icon={IconPaperclip}
            title="Paste as attachment"
            blurb="Stash it in a .md file and attach it"
            onClick={() => choose("attachment")}
          />
          <label className="mt-1 flex cursor-pointer items-center gap-2 self-start py-1 text-[13px] text-muted-foreground">
            <ToggleSwitch
              checked={dontAskAgain}
              onCheckedChange={setDontAskAgain}
              aria-label="Don't ask again — always paste as text"
            />
            Don&apos;t ask again — always paste as text
          </label>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChoiceRow({
  icon: RowIcon,
  title,
  blurb,
  autoFocus,
  onClick,
}: {
  icon: Icon;
  title: string;
  blurb: string;
  autoFocus?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      autoFocus={autoFocus}
      onClick={onClick}
      className="flex cursor-pointer items-center gap-3 rounded-xl bg-black/[0.04] p-3 text-left transition-[background-color,scale] duration-150 hover:bg-black/[0.07] active:scale-[0.99] dark:bg-white/[0.05] dark:hover:bg-white/[0.08]"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-well text-foreground shadow-[inset_0_0_0_1px_var(--well-outline),inset_0_1px_0_0_var(--well-highlight)]">
        <RowIcon size={18} stroke={2} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-[13.5px] font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{blurb}</span>
      </span>
    </button>
  );
}
