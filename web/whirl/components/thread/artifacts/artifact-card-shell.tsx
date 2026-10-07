"use client";

import type { ReactNode } from "react";
import type { Icon } from "@tabler/icons-react";

import { LabelMorph, useRotatingVerb } from "@whirl/components/ui/label-morph";

/* Shared chrome for the inline artifact cards (documents and HTML), so
   both wear identical shells, icon badges, and the indeterminate
   "working" bar. */

/** How long the message row's own mount fades can still be running after
 * a card's interior mounts. Anything that must never paint under an
 * animating ancestor (the inline viz iframe — Chromium freezes it as a
 * stale snapshot) waits this long before mounting. */
export const ARTIFACT_SETTLE_MS = 400;

/** The card the artifact chrome sits in. Deliberately a static div — NO
 * entrance, crossfade, filter or transform: an inline viz mounts a
 * sandboxed iframe in here, and Chromium freezes an iframe that paints
 * while any ancestor animates. Keep it that way. */
export function ArtifactCardShell({
  children,
  className = "w-95 max-w-full",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative isolate mb-2 min-w-0 max-w-full overflow-hidden rounded-2xl bg-well shadow-[inset_0_0_0_1px_var(--well-outline),inset_0_1px_0_0_var(--well-highlight)] ${className}`}
    >
      {children}
    </div>
  );
}

/** A rounded icon badge, sized to sit in the artifact card header. */
export function ArtifactIconBadge({ icon }: { icon: Icon }) {
  const Glyph = icon;
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-black/[0.04] text-muted-foreground dark:bg-white/[0.06]">
      <Glyph size={17} stroke={2} />
    </span>
  );
}

/**
 * An indeterminate progress bar — the "working" affordance while
 * streaming. Driven by a CSS keyframe (.artifact-progress-bar in
 * globals.css), NOT motion: the cards re-render on every streamed delta,
 * which would restart a JS keyframe loop each time.
 */
export function ArtifactProgressBar() {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]">
      <div className="artifact-progress-bar h-full w-1/3 rounded-full bg-foreground/35" />
    </div>
  );
}

/**
 * The one working state every artifact card shows: icon badge, a rotating
 * whimsical label, and the indeterminate bar. `title` adds a static
 * subtitle once it's known (full pages write theirs up front).
 */
export function ArtifactWorkingBody({
  icon,
  verbs,
  title,
}: {
  icon: Icon;
  verbs: string[];
  title?: string;
}) {
  const verb = useRotatingVerb(verbs);
  return (
    <div className="flex items-center gap-3 px-3.5 py-3">
      <ArtifactIconBadge icon={icon} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="flex min-w-0 flex-col">
          <LabelMorph
            text={verb}
            ellipsis
            shimmer
            className="text-[13.5px]/5 font-medium"
          />
          {title && (
            <LabelMorph
              text={title}
              className="max-w-full truncate text-[11.5px]/4 text-muted-foreground"
            />
          )}
        </span>
        <ArtifactProgressBar />
      </div>
    </div>
  );
}
