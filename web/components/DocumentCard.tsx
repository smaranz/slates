"use client";

import { useState } from "react";

import { documentFileName, type TutorDocument } from "@/lib/tutor-documents";
import { splitDocumentGraphs } from "@/lib/tutor-graph";
import GraphCard from "./GraphCard";
import TutorMarkdown from "./TutorMarkdown";
import { Icon, ICON, Spinner } from "./ui";

/**
 * Build a Word file from the document and hand it to the browser.
 *
 * Goes through the server because turning markdown into .docx is not
 * something a page can do — and doing it here rather than in a skill is what
 * lets every model produce one, not just the backend that can run a local
 * Claude Code session.
 */
async function downloadWord(doc: TutorDocument, setBusy: (v: boolean) => void, onError: (m: string) => void) {
  setBusy(true);
  try {
    const res = await fetch("/api/tutor/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: doc.title, body: doc.body, format: "docx" }),
    });
    const body = (await res.json()) as { name?: string; error?: string };
    if (!res.ok || !body.name) throw new Error(body.error ?? "Couldn't build that file.");
    /*
     * An anchor rather than a location assignment: this is a download, not a
     * navigation, and the `download` attribute is what keeps the page in
     * place while the browser saves the file.
     */
    const a = document.createElement("a");
    a.href = `/api/tutor/files?name=${encodeURIComponent(body.name)}`;
    a.download = body.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e) {
    onError(e instanceof Error ? e.message : "Couldn't build that file.");
  } finally {
    setBusy(false);
  }
}

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

  const [building, setBuilding] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

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
          aria-label="Download as markdown"
          title="Download .md"
          style={{ width: 26, height: 26, flexShrink: 0 }}
        >
          <Icon path={ICON.download} size={13} />
        </button>
        <button
          type="button"
          className="btn btn--quiet"
          onClick={() => void downloadWord(doc, setBuilding, setFailed)}
          disabled={building}
          aria-label="Download as a Word document"
          title="Download .docx"
          style={{ height: 26, padding: "0 10px", fontSize: 11.5, flexShrink: 0 }}
        >
          {building ? <Spinner size={11} /> : "Word"}
        </button>
      </div>

      {failed && <span style={{ fontSize: 11.5, color: "var(--bad)" }}>{failed}</span>}

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
