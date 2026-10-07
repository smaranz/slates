"use client";

import { cn } from "@whirl/lib/utils";

/* The Slates mark in the sidebar's corner, and the way back to the rest of
   Slates. The launcher remembers the last app opened, so leaving clears
   that first — otherwise Slates would bounce straight back here. Different
   root layout, so it's a full page load, not a client navigation. */
export function SlatesHome({ className }: { className?: string }) {
  return (
    <button
      type="button"
      title="Back to Slates"
      aria-label="Back to Slates"
      onClick={() => {
        try {
          window.localStorage.removeItem("slates.mode.v1");
        } catch {
          /* the launcher just shows once more */
        }
        // A different root layout: a full load, not a client navigation.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/");
      }}
      className={cn("flex shrink-0 cursor-pointer items-center gap-2 rounded-md text-[13px] font-semibold text-foreground-soft", className)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a 20px static mark */}
      <img src="/assets/slates-mark.png" alt="" width={20} height={20} className="size-5 rounded-[5px]" />
      <span className="transition-[opacity,visibility] duration-150 sidebar-collapsed:invisible sidebar-collapsed:opacity-0">Agent</span>
    </button>
  );
}
