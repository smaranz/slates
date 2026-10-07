"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { code } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { Streamdown, type PluginConfig, type StreamdownProps } from "streamdown";
import "katex/dist/katex.min.css";

import { cn } from "@whirl/lib/utils";
import { LinkSafetyDialog } from "./link-safety-dialog";
import { TABLE_COMPONENTS } from "./markdown-table";
import { normalizeMathDelimiters } from "./math-delimiters";
import { MermaidDiagram } from "./mermaid-diagram";

/* Assistant prose: Streamdown with shiki code blocks, tuned for the pane —
   copy/download controls, no line numbers, and a soft per-character fade
   on freshly streamed text. Memoized because the thread re-renders on every
   streamed chunk and only the tail message changes. */

const PLUGINS: PluginConfig = {
  code,
  /* Single-dollar stays off: `$5 and $10` is money, not math. LaTeX-style
     `\(...\)` / `\[...\]` are normalized to `$$` before parsing instead. */
  math: createMathPlugin({ singleDollarTextMath: false }),
  renderers: [{ language: "mermaid", component: MermaidDiagram }],
};

/* Same pair the main app renders with — monochrome-friendly on both
   surfaces. */
const SHIKI_THEMES: NonNullable<StreamdownProps["shikiTheme"]> = [
  "github-light",
  "github-dark-default",
];

const CONTROLS: NonNullable<StreamdownProps["controls"]> = {
  code: { copy: true, download: true },
  /* Tables render through TABLE_COMPONENTS — the built-in controls row
     went out with the boxed default it sat on. */
  table: false,
  mermaid: false,
};

/* Link safety is on by Streamdown default — we only swap its built-in
   modal (broken backdrop, invalid DOM nesting) for the app's Dialog. */
const LINK_SAFETY: NonNullable<StreamdownProps["linkSafety"]> = {
  enabled: true,
  renderModal: (props) => <LinkSafetyDialog {...props} />,
};

/* `animated` makes Streamdown wrap each streamed character in its own
   `[data-sd-animate]` span — `sep: "char"` is the load-bearing part. We do
   NOT rely on its duration/stagger vars: the plugin decides which chars are
   "new" via shared state mutated during render, which desyncs across block
   re-parses and React's replayed renders, re-fading text that was already
   on screen. The fade is pinned in CSS instead (globals.css) where it fires
   once per span on mount — duration/stagger here are inert. */
const ANIMATION: NonNullable<StreamdownProps["animated"]> = {
  animation: "fadeIn",
  sep: "char",
  duration: 300,
  stagger: 0,
};

/* How long a settled reply keeps its streaming scaffolding. Long enough for
   the last characters to finish fading in; short enough that nobody is
   interacting with the page through it. */
const SHED_DELAY_MS = 450;

export const Markdown = memo(function Markdown({
  children,
  streaming = false,
  className,
}: {
  children: string;
  streaming?: boolean;
  className?: string;
}) {
  /* The reveal is borrowed, never kept — same rule as the blur.

     Streaming mode wraps every character it reveals in its own span so the
     fade has something to catch. Those spans are the price of the animation,
     and they are not supposed to outlive it — but they did: the blocks
     holding them never re-parse once the text stops changing, so a finished
     reply kept roughly one element per two characters for as long as the tab
     stayed open. Measured on a 700-character answer: 450 elements where the
     same text loaded from history renders 119. A long generation left ten
     thousand spare nodes on the page, and every hover, scroll and keystroke
     after it paid for them. That is the lag that only a reload fixed.

     So a beat after the text settles, the reply re-renders as plain static
     markdown — exactly what a reload would have given it. Historical
     messages still mount static and never go near this. */
  const [live, setLive] = useState(streaming);
  if (streaming && !live) setLive(true);
  useEffect(() => {
    if (streaming) return;
    const timer = setTimeout(() => setLive(false), SHED_DELAY_MS);
    return () => clearTimeout(timer);
  }, [streaming]);

  /* Cheap when no LaTeX delimiters are present (early-out on includes), and
     the memo above already limits this to the streaming tail message. */
  const content = useMemo(() => normalizeMathDelimiters(children), [children]);

  return (
    <Streamdown
      mode={live ? "streaming" : "static"}
      isAnimating={streaming}
      animated={live ? ANIMATION : false}
      plugins={PLUGINS}
      shikiTheme={SHIKI_THEMES}
      controls={CONTROLS}
      components={TABLE_COMPONENTS}
      linkSafety={LINK_SAFETY}
      lineNumbers={false}
      className={cn(
        /* w-full matters: the message column aligns items-start, so without
           it this block sizes to its content and wide tables/code push past
           the pane instead of scrolling inside it. */
        "t-markdown w-full min-w-0 space-y-4 text-[15px]/7 [&_pre]:text-[13px]/6",
        className,
      )}
    >
      {content}
    </Streamdown>
  );
});
