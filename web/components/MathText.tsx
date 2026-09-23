"use client";

import { renderKatexHtml } from "@/lib/katex-html";
import { mathParts } from "@/lib/math-text";

/**
 * Typeset `$…$` / `$$…$$` inside a string that is otherwise plain text —
 * quiz stems, choice labels, user bubbles, review rows. Full markdown stays
 * on `TutorMarkdown`; this is the one that can sit inside a button or a
 * `white-space: pre-wrap` bubble without wrapping a `<p>` around the line.
 */
export default function MathText({ text, className }: { text: string; className?: string }) {
  const parts = mathParts(text);
  if (parts.length === 1 && parts[0].type === "text") {
    return className ? <span className={className}>{text}</span> : <>{text}</>;
  }

  return (
    <span className={["math-text", className].filter(Boolean).join(" ")}>
      {parts.map((part, i) =>
        part.type === "text" ? (
          <span key={i}>{part.value}</span>
        ) : (
          <span
            key={i}
            className={part.display ? "katex-display" : undefined}
            aria-label={part.value}
            dangerouslySetInnerHTML={{ __html: renderKatexHtml(part.value, part.display) }}
          />
        )
      )}
    </span>
  );
}
