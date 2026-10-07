"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@whirl/components/ui/tooltip";

/* The little icon buttons under a message (copy, edit, retry, checkpoint):
   one shared look, tooltip included. */

export const MESSAGE_ACTION_CLASS =
  "flex size-7 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.06]";

export function MessageActionButton({
  label,
  tooltip,
  onClick,
  children,
}: {
  label: string;
  /** Shown in the tooltip when it should differ from the aria-label
   *  (e.g. a copy button flashing "Copied"). */
  tooltip?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            onClick={onClick}
            className={MESSAGE_ACTION_CLASS}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{tooltip ?? label}</TooltipContent>
    </Tooltip>
  );
}
