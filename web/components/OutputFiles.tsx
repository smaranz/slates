"use client";

import { Icon, ICON } from "./ui";

/**
 * Files the tutor actually produced, offered where it said it made them.
 *
 * One row per file rather than a single "download" link: a reply can write a
 * document and the chart that goes in it, and a student needs to be able to
 * tell which is which before opening either.
 */

/** What the extension means, in the words a student would use. */
const KIND: Record<string, string> = {
  docx: "Word document",
  pdf: "PDF",
  pptx: "Presentation",
  xlsx: "Spreadsheet",
  csv: "Spreadsheet",
  png: "Image",
  jpg: "Image",
  jpeg: "Image",
  svg: "Image",
  md: "Markdown",
  txt: "Text",
};

function describe(name: string, size: number): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return [KIND[ext] ?? ext.toUpperCase(), formatSize(size)].filter(Boolean).join(" · ");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function OutputFiles({ files }: { files: { name: string; size: number }[] }) {
  if (!files.length) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10, maxWidth: 560 }}>
      {files.map((file) => (
        <a
          key={file.name}
          href={`/api/tutor/files?name=${encodeURIComponent(file.name)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="palette-row"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-xs)",
            background: "var(--surface)",
            padding: "10px 13px",
            textDecoration: "none",
          }}
        >
          <Icon path={ICON.file} size={15} style={{ color: "var(--text-2)", flexShrink: 0 }} />
          <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column" }}>
            <span className="truncate" style={{ fontSize: 13.5, color: "var(--text)" }}>
              {file.name}
            </span>
            <span style={{ marginTop: 2, fontSize: 11.5, color: "var(--muted)" }}>
              {describe(file.name, file.size)}
            </span>
          </span>
          <Icon path={ICON.download} size={14} style={{ color: "var(--faint)", flexShrink: 0 }} />
        </a>
      ))}
    </div>
  );
}
