"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useStore, type View } from "@/lib/store";
import { Icon, ICON } from "./ui";

interface Destination {
  label: string;
  short: string;
  view: View;
  path: string;
}

const PRIMARY: Destination[] = [
  { label: "Assignments", short: "Board", view: "board", path: ICON.assignments },
  { label: "Calendar", short: "Calendar", view: "calendar", path: ICON.calendar },
  { label: "Grades", short: "Grades", view: "grades", path: ICON.grades },
  { label: "Tutor", short: "Tutor", view: "tutor", path: ICON.tutor },
];

const SECONDARY: Destination[] = [
  { label: "Classes", short: "Classes", view: "classes", path: ICON.classes },
  { label: "Messages", short: "Messages", view: "messages", path: ICON.messages },
  { label: "Settings", short: "Settings", view: "settings", path: ICON.settings },
];

/**
 * Thumb-reachable navigation for phones.
 *
 * The full desktop sidebar remains mounted (and hidden with CSS) so the two
 * shells use the same store and destinations. Four frequent actions stay one
 * tap away; the lower-frequency destinations live in a short bottom sheet.
 */
export default function MobileNav() {
  const s = useStore();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);

  const unread = useMemo(
    () => s.snapshot.messages.filter((m) => m.unread && !s.msgRead[m.id]).length,
    [s.msgRead, s.snapshot.messages]
  );
  const moreActive = SECONDARY.some((item) => item.view === s.view);

  useEffect(() => {
    if (!moreOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMoreOpen(false);
        moreButton.current?.focus();
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [moreOpen]);

  function go(item: Destination) {
    s.setNav(item.label, item.view);
    setMoreOpen(false);
  }

  return (
    <>
      {moreOpen && (
        <div className="mobile-more-backdrop" onClick={() => setMoreOpen(false)}>
          <section
            className="mobile-more-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="More Slates destinations"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mobile-more-handle" aria-hidden="true" />
            <div className="mobile-more-heading">
              <div>
                <strong>{s.studentName || "Slates"}</strong>
                <span>{s.demoMode ? "Sample workspace" : "Student workspace"}</span>
              </div>
              <button
                type="button"
                className="mobile-sheet-close"
                onClick={() => setMoreOpen(false)}
                aria-label="Close more destinations"
              >
                Done
              </button>
            </div>
            <div className="mobile-more-list">
              {SECONDARY.map((item) => {
                const active = item.view === s.view;
                const count = item.view === "messages" ? unread : 0;
                return (
                  <button
                    key={item.view}
                    type="button"
                    className="mobile-more-row"
                    aria-current={active ? "page" : undefined}
                    onClick={() => go(item)}
                  >
                    <span className="mobile-more-icon">
                      <Icon path={item.path} size={18} />
                    </span>
                    <span>{item.short}</span>
                    {count > 0 && <span className="mobile-nav-badge">{count > 99 ? "99+" : count}</span>}
                    <span className="mobile-more-chevron" aria-hidden="true">›</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      )}

      <nav className="mobile-nav" aria-label="Primary navigation">
        {PRIMARY.map((item) => {
          const active = item.view === s.view;
          return (
            <button
              key={item.view}
              type="button"
              className="mobile-nav-item"
              aria-current={active ? "page" : undefined}
              onClick={() => go(item)}
            >
              <span className="mobile-nav-icon">
                <Icon path={item.path} size={19} />
              </span>
              <span>{item.short}</span>
            </button>
          );
        })}
        <button
          ref={moreButton}
          type="button"
          className="mobile-nav-item"
          aria-current={moreActive ? "page" : undefined}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
        >
          <span className="mobile-nav-icon mobile-nav-more-icon" aria-hidden="true">
            <i />
            <i />
            <i />
            {unread > 0 && <span className="mobile-nav-dot" />}
          </span>
          <span>More</span>
        </button>
      </nav>
    </>
  );
}
