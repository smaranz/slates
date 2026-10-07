"use client";

import { useEffect, useMemo, useState } from "react";
import { IconArrowUpRight, IconCheck, IconCopy, IconSitemap } from "@tabler/icons-react";
import type { CustomRendererProps } from "streamdown";

import { useIsDark } from "@whirl/lib/theme";

type MermaidModule = typeof import("mermaid").default;
let modulePromise: Promise<MermaidModule> | null = null;
let renderId = 0;

async function draw(code: string, dark: boolean) {
  modulePromise ??= import("mermaid").then((module) => module.default);
  const mermaid = await modulePromise;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: dark ? "dark" : "neutral",
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
  });
  const valid = await mermaid.parse(code, { suppressErrors: true }).catch(() => false);
  if (!valid) return null;
  const id = `whirl-v2-mermaid-${renderId++}`;
  try {
    return (await mermaid.render(id, code)).svg;
  } catch {
    document.getElementById(`d${id}`)?.remove();
    return null;
  }
}

export function MermaidDiagram({
  code,
  isIncomplete,
}: CustomRendererProps) {
  const dark = useIsDark();
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void draw(code, dark).then((result) => {
        if (cancelled) return;
        if (result) {
          setSvg(result);
          setFailed(false);
        } else if (!isIncomplete) {
          setFailed(true);
        }
      });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [code, dark, isIncomplete]);

  const open = useMemo(() => {
    if (!svg) return undefined;
    return () => {
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      window.open(url, "_blank", "noopener");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    };
  }, [svg]);

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-border">
      <div className="flex h-10 items-center gap-2 border-b border-border bg-muted/35 px-3">
        <IconSitemap size={15} className="text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {failed && !svg ? "Diagram couldn’t be drawn" : "Diagram"}
        </span>
        <button
          type="button"
          aria-label="Copy diagram source"
          onClick={() => {
            void navigator.clipboard.writeText(code);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          }}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
        </button>
        {open && (
          <button
            type="button"
            aria-label="Open diagram in a new tab"
            onClick={open}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <IconArrowUpRight size={14} />
          </button>
        )}
      </div>
      {svg ? (
        <div
          className="flex justify-center overflow-x-auto p-4 [&_svg]:h-auto [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : failed ? (
        <pre className="overflow-x-auto p-3 text-xs"><code>{code}</code></pre>
      ) : (
        <div className="h-28 animate-pulse bg-muted/40" />
      )}
    </div>
  );
}
