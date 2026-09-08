"use client";

import { Icon, ICON } from "./ui";

/**
 * How a quiz or document shows up in the transcript itself — a compact,
 * clickable row rather than the whole thing rendered inline. The real content
 * lives in the side panel; this is just the door to it.
 */
export default function ArtifactChip({
  icon,
  title,
  subtitle,
  active,
  onClick,
}: {
  icon: string;
  title: string;
  subtitle: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        maxWidth: 320,
        textAlign: "left",
        borderRadius: "var(--radius-sm)",
        border: `1px solid ${active ? "var(--ring)" : "var(--line)"}`,
        background: "var(--surface)",
        padding: "10px 12px",
        font: "inherit",
        cursor: "pointer",
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          height: 32,
          flexShrink: 0,
          borderRadius: "var(--radius-xs)",
          background: "var(--sunken)",
          color: "var(--text-2)",
        }}
      >
        <Icon path={icon} size={15} />
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span className="truncate" style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
          {title}
        </span>
        <span style={{ display: "block", fontSize: 11.5, color: "var(--muted)" }}>{subtitle}</span>
      </span>
      <Icon
        path={ICON.chevronDown}
        size={12}
        style={{ color: "var(--faint)", flexShrink: 0, transform: "rotate(-90deg)" }}
      />
    </button>
  );
}
