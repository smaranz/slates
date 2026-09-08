"use client";

import "katex/dist/katex.min.css";

import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

/**
 * Renders the tutor's reply through the same `.prose` rules a teacher's own
 * write-up gets in `AssignmentView` — headers, lists, and tables read the
 * same voice everywhere in Slates instead of a second, slightly different
 * markdown look showing up just for the tutor.
 *
 * Maths goes through KaTeX. A tutor that answers in fractions and exponents
 * was writing them as flat text — "(2 + (−4))/2", "3cos(2(x − π/4)) − 1" —
 * which is the notation a student has to decode rather than the one their
 * textbook uses. `$…$` renders inline, `$$…$$` on its own line.
 */
export default function TutorMarkdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={["prose", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        /*
         * `strict: false` keeps one bad expression from throwing: the model
         * occasionally emits a command KaTeX doesn't know, and a whole reply
         * failing to render over one stray macro is far worse than that macro
         * showing in red.
         */
        rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
