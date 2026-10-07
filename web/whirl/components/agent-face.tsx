"use client";

import { IconUsersGroup } from "@tabler/icons-react";

import { cn } from "@whirl/lib/utils";

/* An agent's face: its initial on a disc of its own hue, in both themes. A
   group wears the people glyph on a neutral disc. `working` adds a soft
   pulse ring so a busy agent reads at a glance in the sidebar. */
export function AgentFace({
  name,
  hue,
  group = false,
  working = false,
  size = 20,
  className,
}: {
  name: string;
  hue?: number | null;
  group?: boolean;
  working?: boolean;
  size?: number;
  className?: string;
}) {
  const h = hue ?? 220;
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none",
        group
          ? "bg-muted text-muted-foreground"
          : "bg-[oklch(0.86_0.07_var(--face-h))] text-[oklch(0.32_0.09_var(--face-h))] dark:bg-[oklch(0.38_0.08_var(--face-h))] dark:text-[oklch(0.93_0.04_var(--face-h))]",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.48), ["--face-h" as string]: String(h) }}
    >
      {group ? <IconUsersGroup size={Math.round(size * 0.62)} stroke={2} /> : (name.trim()[0] ?? "?").toUpperCase()}
      {working && (
        <span className="absolute -inset-0.5 animate-pulse rounded-full ring-2 ring-[oklch(0.7_0.12_var(--face-h))]/60" />
      )}
    </span>
  );
}
