"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

import { inScope } from "@/lib/counselor/essays";
import { useCounselor } from "@/lib/counselor/store";
import { useMode } from "@/lib/mode";
import { useStore, type View } from "@/lib/store";
import SchoologySignIn from "./SchoologySignIn";
import { Avatar, Icon, ICON } from "./ui";

/** What the scraper says about its own last sync (`/api/scrape` → `/health`). */
interface SyncHealth {
  running: boolean;
  ok?: boolean | null;
  error?: string | null;
}

/**
 * The scraper's real state, checked every minute and on return to the window.
 *
 * Having a board isn't being connected: a saved snapshot keeps the board up
 * through an expired Schoology session, so the footer asks the scraper how its
 * last sync actually went instead. The second value asks again now, as after
 * a sign-in, rather than at the next minute.
 */
function useSyncHealth(): [SyncHealth | null, () => void] {
  const [health, setHealth] = useState<SyncHealth | null>(null);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const res = await fetch("/api/scrape", { cache: "no-store" });
        const data = (await res.json()) as SyncHealth;
        if (!cancelled) setHealth(data);
      } catch {
        /* the portal itself is unreachable; keep the last answer */
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 60_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [asked]);
  return [health, () => setAsked((n) => n + 1)];
}

function connectionLabel(connected: boolean, demoMode: boolean, health: SyncHealth | null): { text: string; warn: boolean; signedOut?: boolean } {
  if (demoMode) return { text: "Sample data", warn: false };
  if (health && !health.running) return { text: "Sync service offline", warn: true };
  if (health?.ok === false) {
    const never = /not signed in/i.test(health.error ?? "");
    const signedOut = never || /signed out/i.test(health.error ?? "");
    const text = never ? "Not signed in to Schoology" : signedOut ? "Signed out of Schoology" : "Schoology sync failing";
    return { text, warn: true, signedOut };
  }
  if (health?.ok) return { text: "Schoology connected", warn: false };
  return { text: connected ? "Checking Schoology…" : "Not connected", warn: false };
}

interface NavDef {
  label: string;
  path: string;
  view: View;
  count: number;
}

export default function Sidebar() {
  const s = useStore();
  // Essays live in the counselor's record but are written on the school side,
  // so the count comes from there.
  // Scoped, or the badge reads "1" over a list the student is being told is
  // empty — the two halves keep separate essays.
  const essayCount = useCounselor().essays.filter(inScope("school")).length;
  const { clear, openSettings } = useMode();
  const [health, recheckHealth] = useSyncHealth();
  const status = connectionLabel(s.connected, s.demoMode, health);

  // In the desktop app the macOS traffic lights are drawn over the top-left of
  // the window, which is exactly where the brand sits. Flag the shell so the
  // header can move out from under them; in a browser tab there is nothing to
  // avoid. Done on mount rather than during render to keep SSR markup stable.
  useEffect(() => {
    if (navigator.userAgent.includes("Electron")) {
      document.documentElement.dataset.desktop = "1";
    }
  }, []);

  const navs = useMemo<NavDef[]>(() => {
    const open = s.snapshot.assignments.filter((a) => s.onBoard(a) && s.statusOf(a) !== "done");
    const unread = s.snapshot.messages.filter(
      (m) => m.unread && !s.msgRead[m.id]
    ).length;

    return [
      { label: "Assignments", path: ICON.assignments, view: "board", count: open.length },
      { label: "Classes", path: ICON.classes, view: "classes", count: 0 },
      { label: "Grades", path: ICON.grades, view: "grades", count: 0 },
      { label: "Calendar", path: ICON.calendar, view: "calendar", count: 0 },
      { label: "Tutor", path: ICON.tutor, view: "tutor", count: 0 },
      { label: "Study", path: ICON.bands, view: "study", count: 0 },
      { label: "Essays", path: ICON.essay, view: "essays", count: essayCount },
      { label: "Messages", path: ICON.messages, view: "messages", count: unread },
    ];
  }, [s, essayCount]);

  return (
    <aside
      className="slates-sidebar"
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
      {/*
        The brand is the way back to the launcher. In the desktop shell this
        strip is also the frameless window's only drag handle, so the button
        opts itself out of dragging and the empty space beside it keeps
        working as one.
      */}
      <div
        className="app-brand"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          borderBottom: "1px solid var(--line)",
        }}
      >
        <button type="button" className="brand-home" onClick={clear} title="Choose School or Counselor">
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
        </button>
      </div>

      <nav style={{ flex: 1, overflowY: "auto", padding: 8 }}>
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
          onClick={openSettings}
          aria-label="Open settings"
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
            <p
              title={status.warn ? "Open Settings to see what's wrong" : undefined}
              style={{ margin: "1px 0 0", fontSize: 11, color: status.warn ? "var(--warn)" : "var(--muted)" }}
            >
              {status.text}
            </p>
          </div>
        </button>
        {/* Its own button, not inside the one above: that one opens Settings. */}
        {status.signedOut && (
          <SchoologySignIn
            className="btn btn--primary"
            style={{ width: "100%", height: 30, marginTop: 6 }}
            onSignedIn={recheckHealth}
          />
        )}
      </div>
    </aside>
  );
}
