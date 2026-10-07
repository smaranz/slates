"use client";

import { useRoster } from "@whirl/lib/agents";

/* Under the home composer: where the agents actually are. Whirl's footer
   pointed at its own site; in Slates the useful fact is that this work
   happens on the PC hosting Slates, in its workspace folder. */
export function HomeFooter() {
  const roster = useRoster();
  return (
    <footer className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-xs text-neutral-400 dark:text-neutral-500">
      <span>Agents work on the PC that hosts Slates, with its files, shell and browser.</span>
      {roster?.workspace && (
        <>
          <span aria-hidden className="text-neutral-300 dark:text-neutral-700">
            ·
          </span>
          <span className="font-mono text-[11px]" title="Their shared working folder">
            {roster.workspace.replace(/^\/(Users|home)\/[^/]+/, "~")}
          </span>
        </>
      )}
    </footer>
  );
}
