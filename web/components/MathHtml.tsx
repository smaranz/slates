"use client";

import { useEffect, useRef } from "react";
import renderMathInElement from "katex/contrib/auto-render";

import { prepareMathHtml } from "@/lib/math-text";

/**
 * A teacher's write-up from Schoology, with whatever equation editor they
 * used turned into KaTeX. MathJax leaves `\(` `\)` in the HTML, or a
 * `<script type="math/tex">` tag; both end up typeset here so the assignment
 * page doesn't show the raw delimiters the quiz card used to.
 */
export default function MathHtml({
  html,
  className,
  style,
}: {
  html: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const prepared = prepareMathHtml(html);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Reset before typesetting: React Strict Mode runs the effect twice, and
    // a second pass over already-rendered KaTeX would paint dollars back in.
    el.innerHTML = prepared;
    renderMathInElement(el, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        { left: "\\(", right: "\\)", display: false },
        { left: "$", right: "$", display: false },
      ],
      throwOnError: false,
      strict: "ignore",
      output: "html",
    });
  }, [prepared]);

  return <div ref={ref} className={className} style={style} dangerouslySetInnerHTML={{ __html: prepared }} />;
}
