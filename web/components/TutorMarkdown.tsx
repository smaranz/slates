"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders the tutor's reply through the same `.prose` rules a teacher's own
 * write-up gets in `AssignmentView` — headers, lists, and tables read the
 * same voice everywhere in Slates instead of a second, slightly different
 * markdown look showing up just for the tutor.
 */
export default function TutorMarkdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={["prose", className].filter(Boolean).join(" ")}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}
