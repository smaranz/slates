"use client";

import { IconPlugConnected } from "@tabler/icons-react";

import type { LiveArtifactBinding } from "@whirl/lib/live-artifacts";

/**
 * Which integrations an artifact reads from, shown in the host's own chrome
 * rather than inside the frame.
 *
 * Bindings are auto-approved — the model declares them, they're read-only, and
 * the artifact's code can't reach past them — but "you didn't have to approve
 * it" is not the same as "you don't get to know about it". This is the part
 * that makes it visible, and it deliberately sits outside the sandbox so a
 * model-written page can't render something else in its place.
 */
export function ArtifactDataSources({
  bindings,
  className = "",
}: {
  bindings: LiveArtifactBinding[];
  className?: string;
}) {
  if (bindings.length === 0) return null;

  const integrations = [...new Set(bindings.map((b) => b.integration))];
  const summary =
    integrations.length === 1
      ? integrations[0]
      : integrations.length === 2
        ? `${integrations[0]} and ${integrations[1]}`
        : `${integrations.slice(0, -1).join(", ")}, and ${integrations.at(-1)}`;

  return (
    <span
      title={bindings
        .map((b) => `${b.label || b.tool} · ${b.integration}`)
        .join("\n")}
      className={`flex min-w-0 items-center gap-1.5 text-[11.5px]/4 text-muted-foreground ${className}`}
    >
      <IconPlugConnected size={13} stroke={2} className="shrink-0" />
      <span className="truncate">Reads live data from {summary}</span>
    </span>
  );
}
