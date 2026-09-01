"use client";

import { useState } from "react";

import { documentFileName, type TutorDocument } from "@/lib/tutor-documents";
import { splitDocumentGraphs } from "@/lib/tutor-graph";
import GraphCard from "./GraphCard";
import TutorMarkdown from "./TutorMarkdown";
import { Icon, ICON } from "./ui";

/** Blob-download a document as a plain `.md` file — no server round trip needed. */
function download(doc: TutorDocument) {
  const blob = new Blob([doc.body], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = documentFileName(doc.title);
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * A study guide, outline, or other document the tutor wrote — set apart from
 * chat prose as its own card, the way `QuizCard` sets a practice set apart,
 * with a way to actually keep it (copy or download) rather than just reading
 * it once and losing it when the conversation scrolls away.
 */
export default function DocumentCard({ document: doc }: { document: TutorDocument }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(doc.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard permission denied — the download button still works */
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        width: "100%",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--line)",
        background: "var(--surface)",
        padding: "14px 18px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon path={ICON.file} size={14} style={{ color: "var(--muted)", flexShrink: 0 }} />
        <span className="truncate" style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
          {doc.title}
        </span>
        <button
          type="button"
          className="icon-btn"
          onClick={copy}
          aria-label="Copy document"
          title={copied ? "Copied" : "Copy"}
          style={{ width: 26, height: 26, flexShrink: 0 }}
        >
          <Icon path={copied ? ICON.check : ICON.copy} size={13} style={{ color: copied ? "var(--good)" : undefined }} />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => download(doc)}
          aria-label="Download document"
          title="Download"
          style={{ width: 26, height: 26, flexShrink: 0 }}
        >
          <Icon path={ICON.download} size={13} />
        </button>
      </div>

      {splitDocumentGraphs(doc.body).map((block, i) =>
        block.type === "graph" ? (
          <GraphCard key={i} graph={block.graph} />
        ) : (
          <TutorMarkdown key={i} text={block.value} />
        )
      )}
    </div>
  );
}
