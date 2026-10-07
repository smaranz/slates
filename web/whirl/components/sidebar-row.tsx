import type { ComponentPropsWithRef } from "react";
import type { Icon } from "@tabler/icons-react";

import { cn } from "@whirl/lib/utils";
import { RowPill } from "./row-pill";

/* Flat nav row for the sidebar: icon and label share the soft chrome ink.
   Hover fills a pill in the app's one hover tone. Collapses to a centered
   icon on the rail.

   The pill is its own absolute layer beneath the icon and label (they sit
   above it via `relative`); pressing shades it without moving the content.
   The ::before layer is an invisible hit area reaching the sidebar edges;
   it defaults to the row's own height — stretch it over adjacent gaps per
   instance with `before:-top-*` / `before:-bottom-*`. `active` keeps the
   pill lit for the selected row of a set (the settings sections). */
export function SidebarRow({
  icon: RowIcon,
  label,
  active = false,
  alert = false,
  iconNode,
  trailing,
  className = "",
  ...props
}: {
  icon?: Icon;
  label: string;
  active?: boolean;
  /** Something on the row's page needs attention: a dot on the icon, which
   *  survives the collapse to the rail where a trailing badge wouldn't. */
  alert?: boolean;
  /** Drawn in place of the icon — an agent's face. */
  iconNode?: React.ReactNode;
  /** Quiet text pinned right — an agent's "working". */
  trailing?: React.ReactNode;
} & ComponentPropsWithRef<"button">) {
  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      className={cn(
        // Left-anchored in both states — the 12px collapsed padding centers
        // the icon on the rail with a 2px glide instead of a center-jump,
        // and the label fades under the sliding edge rather than popping.
        "group/row sidebar-glide relative flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[13.5px]/4 font-medium text-foreground-soft transition-[padding] before:absolute before:-inset-x-3 before:top-0 before:bottom-0 sidebar-collapsed:pl-3",
        className,
      )}
      {...props}
    >
      <RowPill className={active ? "bg-accent" : undefined} />
      <span className="relative shrink-0">
        {iconNode ?? (RowIcon ? <RowIcon size={16} /> : null)}
        {alert && (
          <span
            aria-hidden
            /* Ringed in the rail's own colour so it reads as a dot sitting on
               the icon rather than a smudge in it. */
            className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-destructive ring-2 ring-background"
          />
        )}
      </span>
      <span className="relative truncate transition-[opacity,visibility] duration-150 sidebar-collapsed:invisible sidebar-collapsed:opacity-0">
        {label}
      </span>
      {trailing && (
        <span className="relative ml-auto shrink-0 text-[11.5px] font-normal text-muted-foreground transition-[opacity,visibility] duration-150 sidebar-collapsed:invisible sidebar-collapsed:opacity-0">
          {trailing}
        </span>
      )}
    </button>
  );
}
