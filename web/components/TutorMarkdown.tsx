"use client";

import { Children, isValidElement, type ComponentProps, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { renderKatexHtml } from "@/lib/katex-html";
import { prepareMathMarkdown } from "@/lib/math-text";

/**
 * Renders the tutor's reply through the same `.prose` rules a teacher's own
 * write-up gets in `AssignmentView` — headers, lists, and tables read the
 * same voice everywhere in Slates instead of a second, slightly different
 * markdown look showing up just for the tutor.
 *
 * Maths is parsed by remark-math (before GFM, so `_` in `$C_L$` is a
 * subscript, not italic) and typeset with the same KaTeX as `MathText`.
 */
export default function TutorMarkdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={["prose", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        components={{
          code: MarkdownCode,
          pre: MarkdownPre,
        }}
      >
        {prepareMathMarkdown(text)}
      </ReactMarkdown>
    </div>
  );
}

function mathKind(className?: string): "inline" | "display" | null {
  if (!className?.includes("language-math")) return null;
  return className.includes("math-display") ? "display" : "inline";
}

function MarkdownCode({
  className,
  children,
  ...props
}: ComponentProps<"code">) {
  const kind = mathKind(className);
  if (kind) {
    const tex = String(children ?? "").replace(/\n$/, "");
    return (
      <span
        className={kind === "display" ? "katex-display" : undefined}
        aria-label={tex}
        dangerouslySetInnerHTML={{ __html: renderKatexHtml(tex, kind === "display") }}
      />
    );
  }
  return (
    <code className={className} {...props}>
      {children}
    </code>
  );
}

/** remark-math wraps display maths in `<pre><code class="language-math">`. */
function MarkdownPre({ children, ...props }: ComponentProps<"pre">) {
  const only = onlyChild(children);
  if (only && mathKind(only.props.className) === "display") {
    return <>{only}</>;
  }
  return <pre {...props}>{children}</pre>;
}

function onlyChild(children: ReactNode) {
  const list = Children.toArray(children);
  const first = list[0];
  return list.length === 1 && isValidElement<{ className?: string }>(first) ? first : null;
}
