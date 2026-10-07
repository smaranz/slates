"use client";

import { useEffect, useRef } from "react";
import { motion } from "motion/react";

import { pinRasterPath } from "@whirl/lib/motion";
import { cn } from "@whirl/lib/utils";

/* Tab chips: free-standing capsules with air between them — the active one
   filled with primary ink, the rest just a hairline ring until hovered. A
   tally rides along as a smaller dimmed figure. The fill's radius is styled
   inline so motion can keep the capsule's corners round while the pill
   stretches between different-width chips.
 *
 * Shared by the store (two or three chips, side by side) and the settings
 * face on a phone (nine, in a scroller — that's where the rail's section
 * rows go when there's no rail). */
export function StoreTabs<T extends string>({
  value,
  onChange,
  tabs,
  className,
  glide = true,
}: {
  value: T;
  onChange: (value: T) => void;
  tabs: { value: T; label: string; count?: number }[];
  className?: string;
  /** The fill travels from chip to chip on a shared layoutId. Switch it off
   *  for a set that scrolls: the pill would fly across the ones in between,
   *  and it animates against a scroll offset that moves underneath it. */
  glide?: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  /* Keep the selected chip in view of its own scroller — nine sections is
     more than fits across a phone, and the one you're reading should never
     be the one off the end. scrollLeft rather than scrollIntoView, which is
     free to scroll every ancestor including the page. */
  useEffect(() => {
    const list = listRef.current;
    if (!list || list.scrollWidth <= list.clientWidth) return;
    const chip = list.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!chip) return;
    const overflowLeft = chip.offsetLeft - list.scrollLeft;
    const overflowRight =
      chip.offsetLeft + chip.offsetWidth - (list.scrollLeft + list.clientWidth);
    if (overflowLeft >= 0 && overflowRight <= 0) return;
    list.scrollTo({
      left: chip.offsetLeft - (list.clientWidth - chip.offsetWidth) / 2,
      behavior: "smooth",
    });
  }, [value]);

  return (
    <div
      ref={listRef}
      role="tablist"
      className={cn("flex items-center gap-1.5", className)}
    >
      {tabs.map((tab) => {
        const active = value === tab.value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={`group relative h-8 shrink-0 cursor-pointer rounded-full px-3.5 transition-[box-shadow,background-color,scale] duration-150 active:scale-[0.96] ${
              active
                ? glide
                  ? ""
                  : "bg-primary"
                : "ring-1 ring-border hover:bg-muted"
            }`}
          >
            {active && glide && (
              <motion.span
                layoutId="store-tab-chip"
                transition={{ type: "spring", stiffness: 480, damping: 38 }}
                transformTemplate={pinRasterPath}
                style={{ borderRadius: 16 }}
                className="absolute inset-0 bg-primary"
              />
            )}
            <span
              className={`relative z-10 flex items-baseline gap-1.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-150 ${
                active
                  ? "text-primary-foreground"
                  : "text-muted-foreground group-hover:text-foreground"
              }`}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span
                  className={`text-[11px] font-medium ${active ? "opacity-70" : ""}`}
                >
                  {tab.count}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
