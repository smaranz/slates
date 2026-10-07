import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

/**
 * Renders a LaTeX string with KaTeX. Falls back to the raw string if KaTeX
 * can't parse it, so a malformed formula degrades to plain text instead of
 * throwing. `display` switches between inline and centered display math.
 */
export function KatexFormula({
  tex,
  display = false,
  className,
}: {
  tex: string;
  display?: boolean;
  className?: string;
}) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, {
        displayMode: display,
        throwOnError: false,
        output: "html",
      });
    } catch {
      return null;
    }
  }, [tex, display]);

  if (!html) {
    return <span className={className}>{tex}</span>;
  }

  return (
    <span
      className={className}
      // KaTeX output is trusted (we generate the TeX server-side) and sanitized
      // by KaTeX itself with throwOnError/trust defaults.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
