"use client";

import { useState } from "react";
import { IconX } from "@tabler/icons-react";
import type { LinkSafetyModalProps } from "streamdown";

import { Button } from "@whirl/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@whirl/components/ui/dialog";

/* The "off you go" gate for links in assistant prose. Streamdown's built-in
   modal renders inline inside the paragraph (invalid DOM nesting — a console
   error per layer) and its translucent backdrop compiles solid in our build,
   so we hand Streamdown this instead: the app's portalled Dialog with the
   standard entrance and a frosted backdrop. */

export function LinkSafetyDialog({
  url,
  isOpen,
  onClose,
  onConfirm,
}: LinkSafetyModalProps) {
  const [copied, setCopied] = useState(false);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open: boolean) => {
        if (!open) {
          setCopied(false);
          onClose();
        }
      }}
    >
      <DialogContent backdropClassName="backdrop-blur-xs">
        <DialogClose
          aria-label="Close"
          className="absolute top-3 right-3 flex size-7 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.06]"
        >
          <IconX size={15} />
        </DialogClose>
        <DialogHeader>
          <DialogTitle>Open external link?</DialogTitle>
          <DialogDescription>
            This link leads outside Whirl — check the address before you go.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-3 max-h-28 overflow-y-auto rounded-lg bg-well px-3 py-2 font-mono text-xs/5 break-all text-muted-foreground shadow-[inset_0_0_0_1px_var(--well-outline)]">
          {url}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              navigator.clipboard
                .writeText(url)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
                .catch(() => {});
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Button
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            Open link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
