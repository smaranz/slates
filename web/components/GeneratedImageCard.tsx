"use client";

import type { TutorImage } from "@/lib/tutor-image";
import { Icon, ICON } from "./ui";

/** A safe filename from a prompt — never empty, never a path. */
function fileName(prompt: string): string {
  const slug = prompt
    .trim()
    .slice(0, 60)
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return `${slug || "image"}.png`;
}

/** An illustration the tutor drew, sitting under its reply the way a document or quiz card does. */
export default function GeneratedImageCard({ image }: { image: TutorImage }) {
  if (image.dropped || !image.dataUrl) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--line)",
          background: "var(--sunken)",
          padding: "14px 16px",
        }}
      >
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
          This picture wasn&apos;t kept across the reload — ask again to redraw it.
        </span>
        <span style={{ fontSize: 12, color: "var(--faint)" }}>{image.prompt}</span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxWidth: 360,
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--line)",
        background: "var(--surface)",
        padding: 8,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.dataUrl}
        alt={image.prompt}
        style={{ width: "100%", borderRadius: "var(--radius-xs)", display: "block" }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 4px 2px" }}>
        <span className="truncate" style={{ flex: 1, fontSize: 12, color: "var(--muted)" }}>
          {image.prompt}
        </span>
        <a
          href={image.dataUrl}
          download={fileName(image.prompt)}
          className="icon-btn"
          aria-label="Download image"
          title="Download"
          style={{ width: 24, height: 24, flexShrink: 0, textDecoration: "none" }}
        >
          <Icon path={ICON.download} size={12} />
        </a>
      </div>
    </div>
  );
}
