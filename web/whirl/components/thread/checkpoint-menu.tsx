"use client";

import { useState } from "react";
import { IconGitBranch, IconRestore } from "@tabler/icons-react";

import { ConfirmDialog } from "@whirl/components/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@whirl/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@whirl/components/ui/tooltip";
import { MESSAGE_ACTION_CLASS } from "./message-action-button";

/* The per-message checkpoint control: one little branch icon opening a
   menu with the two timeline actions — branch the conversation up to this
   point into a fresh thread, or roll the thread back to here by deleting
   everything after. Both confirm before doing anything. */

const ITEM = "gap-2 px-2 py-1.5";

export function CheckpointMenu({
  onBranch,
  onRollback,
}: {
  onBranch: () => void;
  /** Absent when there's nothing after this message to roll back. */
  onRollback?: () => void;
}) {
  const [confirming, setConfirming] = useState<"branch" | "rollback" | null>(
    null,
  );

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                aria-label="Checkpoint"
                className={`${MESSAGE_ACTION_CLASS} data-popup-open:bg-black/[0.05] data-popup-open:text-foreground dark:data-popup-open:bg-white/[0.06]`}
              />
            }
          >
            <IconGitBranch size={15} />
          </TooltipTrigger>
          <TooltipContent>Checkpoint</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" sideOffset={4} className="w-48 p-1">
          <DropdownMenuItem
            className={ITEM}
            onClick={() => setConfirming("branch")}
          >
            <IconGitBranch size={15} className="text-muted-foreground" />
            Branch off here
          </DropdownMenuItem>
          {onRollback && (
            <DropdownMenuItem
              className={ITEM}
              variant="destructive"
              onClick={() => setConfirming("rollback")}
            >
              <IconRestore size={15} />
              Roll back to here
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirming === "branch"}
        onOpenChange={(open) => setConfirming(open ? "branch" : null)}
        title="Branch off from here?"
        message="Copies the conversation up to this message into a new thread and takes you there. The original stays untouched."
        confirmLabel="Branch off"
        onConfirm={onBranch}
      />
      <ConfirmDialog
        open={confirming === "rollback"}
        onOpenChange={(open) => setConfirming(open ? "rollback" : null)}
        title="Roll back to this point?"
        message="Everything after this message will be deleted from the thread. This can't be undone — branch off first if you want to keep both timelines."
        confirmLabel="Roll back"
        destructive
        onConfirm={() => onRollback?.()}
      />
    </>
  );
}
