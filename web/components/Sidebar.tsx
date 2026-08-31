"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef } from "react";

import { useStore, type View } from "@/lib/store";
import { Avatar, Icon, ICON, SearchIcon } from "./ui";

interface NavDef {
  label: string;
  path: string;
  view: View;
  count: number;
}

export default function Sidebar() {
  const s = useStore();
  const searchRef = useRef<HTMLInputElement>(null);

  // In the desktop app the macOS traffic lights are drawn over the top-left of
  // the window, which is exactly where the brand sits. Flag the shell so the
  // header can move out from under them; in a browser tab there is nothing to
  // avoid. Done on mount rather than during render to keep SSR markup stable.
  useEffect(() => {
    if (navigator.userAgent.includes("Electron")) {
      document.documentElement.dataset.desktop = "1";
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const navs = useMemo<NavDef[]>(() => {
    const open = s.snapshot.assignments.filter((a) => s.statusOf(a) !== "done");
    const tonight = open.filter((a) => a.bucket === "tonight");
    const unread = s.snapshot.messages.filter(
      (m) => m.unread && !s.msgRead[m.id]
    ).length;

    return [
      { label: "Assignments", path: ICON.assignments, view: "board", count: open.length },
      { label: "Tonight", path: ICON.tonight, view: "list", count: tonight.length },
      { label: "Grades", path: ICON.grades, view: "grades", count: 0 },
      { label: "Calendar", path: ICON.calendar, view: "calendar", count: 0 },
      { label: "Tutor", path: ICON.tutor, view: "tutor", count: 0 },
      { label: "Messages", path: ICON.messages, view: "messages", count: unread },
      { label: "Settings", path: ICON.settings, view: "settings", count: 0 },
    ];
  }, [s]);

  return (
    <aside
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: 256,
        flexShrink: 0,
        background: "var(--surface)",
        color: "var(--text)",
        borderRight: "1px solid var(--line)",
        boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.05), 0 1px 2px oklch(0 0 0 / 0.18)",
      }}
    >
      <div
        className="app-brand"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          borderBottom: "1px solid var(--line)",
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 20,
            height: 20,
            flexShrink: 0,
            margin: "-2px -4px 0 0",
          }}
        >
          <Image
            src="/assets/slates-mark.png"
            alt="Slates"
            width={26}
            height={26}
            style={{ display: "block", objectFit: "contain", transform: "translate(2px, -2px)" }}
          />
        </span>
        <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>Slates</span>
      </div>

      <div style={{ padding: 8 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            borderRadius: 20,
            background: "var(--sunken)",
            border: "1px solid var(--line)",
            padding: "0 10px",
            height: 34,
            boxShadow: "var(--shadow-inset)",
          }}
        >
          <SearchIcon />
          <input
            ref={searchRef}
            className="bare-field"
            style={{ fontSize: 13 }}
            value={s.query}
            onChange={(e) => s.setQuery(e.target.value)}
            placeholder="Search assignments"
            aria-label="Search assignments"
          />
          <span
            style={{
              flexShrink: 0,
              fontSize: 11,
              color: "var(--muted)",
              border: "1px solid var(--line)",
              borderRadius: 6,
              padding: "1px 5px",
            }}
          >
            ⌘K
          </span>
        </div>
      </div>

      <nav style={{ flex: 1, overflowY: "auto", padding: "0 8px 8px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {navs.map((n) => {
            const active = n.label === s.nav;
            return (
              <button
                key={n.label}
                type="button"
                onClick={() => s.setNav(n.label, n.view)}
                aria-current={active ? "page" : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  border: 0,
                  borderRadius: 20,
                  padding: "6px 8px",
                  font: "inherit",
                  fontSize: 14,
                  textAlign: "left",
                  cursor: "pointer",
                  transition: "background-color .15s, color .15s",
                  ...(active
                    ? {
                        backgroundImage:
                          "linear-gradient(180deg, oklch(0.42 0 0) 0%, oklch(0.37 0 0) 100%)",
                        color: "var(--text)",
                        textShadow: "0 1px 1px oklch(0 0 0 / 0.4)",
                        boxShadow: "var(--shadow-raised)",
                      }
                    : { background: "transparent", color: "var(--muted)" }),
                }}
              >
                <span
                  style={{
                    display: "flex",
                    width: 16,
                    height: 16,
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Icon path={n.path} size={16} />
                </span>
                <span className="truncate" style={{ flex: 1 }}>
                  {n.label}
                </span>
                {n.count > 0 && (
                  <span style={{ flexShrink: 0, fontSize: 12, color: "var(--muted)" }}>
                    {n.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      <div style={{ borderTop: "1px solid var(--line)", padding: 8 }}>
        <button
          type="button"
          onClick={() => s.setNav("Settings", "settings")}
          aria-label="Open profile settings"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            width: "100%",
            border: 0,
            borderRadius: 20,
            padding: "6px 8px",
            background: "transparent",
            color: "inherit",
            font: "inherit",
            textAlign: "left",
            cursor: "pointer",
          }}
        >
          <Avatar src={s.avatar} name={s.studentName} size={28} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <p className="truncate" style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "var(--text)" }}>
              {s.studentName || "Not signed in"}
            </p>
            <p style={{ margin: "1px 0 0", fontSize: 11, color: "var(--muted)" }}>
              {s.connected ? (s.demoMode ? "Sample data" : "Schoology connected") : "Not connected"}
            </p>
          </div>
        </button>
      </div>
    </aside>
  );
}
