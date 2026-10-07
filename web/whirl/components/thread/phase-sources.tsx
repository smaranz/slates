"use client";

import { IconExternalLink } from "@tabler/icons-react";

import type { SearchSource } from "@whirl/lib/messages";

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function PhaseSources({ sources }: { sources: SearchSource[] }) {
  return (
    <div className="flex max-w-xl flex-col gap-1 py-1">
      {sources.map((source, index) => (
        <a
          key={`${source.url}-${index}`}
          href={source.url}
          target="_blank"
          rel="noreferrer"
          className="group/source flex min-w-0 items-start gap-2 rounded-lg px-2 py-1.5 transition-colors duration-150 hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
        >
          <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm bg-black/[0.05] text-[9px] font-semibold text-muted-foreground uppercase dark:bg-white/[0.07]">
            {hostname(source.url).charAt(0) || "•"}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px]/4.5 text-foreground/85">
              {source.title || hostname(source.url)}
            </span>
            <span className="mt-0.5 block truncate text-[11.5px]/4 text-muted-foreground">
              {hostname(source.url)}
              {source.author ? ` · ${source.author}` : ""}
            </span>
          </span>
          <IconExternalLink
            size={12}
            className="mt-0.5 shrink-0 text-muted-foreground/0 transition-colors duration-150 group-hover/source:text-muted-foreground"
          />
        </a>
      ))}
    </div>
  );
}
