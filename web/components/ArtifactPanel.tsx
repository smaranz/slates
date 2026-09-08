"use client";

import type { ReactNode } from "react";

import { Icon, ICON } from "./ui";

/**
 * Where a quiz or document actually lives once opened — a side panel next to
 * the conversation, the way an artifact opens in Claude's own app, instead of
 * a card buried in the scrollback. The chat keeps talking while this stays
 * put, and full screen is one click for when it's the only thing that
 * matters right now.
 */
export default function ArtifactPanel({
  title,
  icon,
  fullscreen,
  onToggleFullscreen,
  onClose,
  children,
}: {
  title: string;
  icon: string;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        width: fullscreen ? "100%" : "min(460px, 42vw)",
        flexShrink: 0,
        background: "var(--bg)",
        ...(fullscreen
          ? { position: "fixed" as const, inset: 0, zIndex: 40 }
          : { borderLeft: "1px solid var(--line)" }),
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 10px 12px 16px",
          borderBottom: "1px solid var(--line)",
          flexShrink: 0,
        }}
      >
        <Icon path={icon} size={14} style={{ color: "var(--muted)", flexShrink: 0 }} />
        <span className="truncate" style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
          {title}
        </span>
        <button
          type="button"
          className="icon-btn"
          onClick={onToggleFullscreen}
          aria-label={fullscreen ? "Exit full screen" : "Full screen"}
          title={fullscreen ? "Exit full screen" : "Full screen"}
          style={{ width: 28, height: 28, flexShrink: 0 }}
        >
          <Icon path={fullscreen ? ICON.collapse : ICON.expand} size={13} />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={onClose}
          aria-label="Close panel"
          title="Close"
          style={{ width: 28, height: 28, flexShrink: 0 }}
        >
          <Icon path={ICON.close} size={13} />
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 18, display: "flex", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: fullscreen ? 760 : undefined }}>{children}</div>
      </div>
    </div>
  );
}
