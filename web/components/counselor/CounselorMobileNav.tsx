"use client";

import { useEffect, useRef, useState } from "react";

import { useCounselor, type CounselorView } from "@/lib/counselor/store";
import { useIdentity } from "@/lib/identity";
import { useMode } from "@/lib/mode";
import { Icon, ICON } from "../ui";

interface Destination {
  label: string;
  view: CounselorView;
  path: string;
}

const PRIMARY: Destination[] = [
  { label: "Overview", view: "overview", path: ICON.overview },
  { label: "Counselor", view: "chat", path: ICON.tutor },
  { label: "Plan", view: "plan", path: ICON.checklist },
];

const SECONDARY: Destination[] = [
  { label: "Applications", view: "applications", path: ICON.assignments },
  { label: "Essays", view: "essays", path: ICON.essay },
  { label: "Call", view: "voice", path: ICON.mic },
];

export default function CounselorMobileNav() {
  const counselor = useCounselor();
  const identity = useIdentity();
  const { openSettings } = useMode();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const moreActive = SECONDARY.some((item) => item.view === counselor.view);

  useEffect(() => {
    if (!moreOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMoreOpen(false);
      moreButton.current?.focus();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [moreOpen]);

  function go(view: CounselorView) {
    counselor.setView(view);
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
            aria-label="More counselor destinations"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mobile-more-handle" aria-hidden="true" />
            <div className="mobile-more-heading">
              <div>
                <strong>{identity.name || "College counselor"}</strong>
                <span>Your admissions workspace</span>
              </div>
              <button type="button" className="mobile-sheet-close" onClick={() => setMoreOpen(false)}>
                Done
              </button>
            </div>
            <div className="mobile-more-list">
              {SECONDARY.map((item) => (
                <button
                  key={item.view}
                  type="button"
                  className="mobile-more-row"
                  aria-current={counselor.view === item.view ? "page" : undefined}
                  onClick={() => go(item.view)}
                >
                  <span className="mobile-more-icon"><Icon path={item.path} size={18} /></span>
                  <span>{item.label}</span>
                  <span className="mobile-more-chevron" aria-hidden="true">›</span>
                </button>
              ))}
              <button type="button" className="mobile-more-row" onClick={openSettings}>
                <span className="mobile-more-icon"><Icon path={ICON.settings} size={18} /></span>
                <span>Profile &amp; settings</span>
                <span className="mobile-more-chevron" aria-hidden="true">›</span>
              </button>
            </div>
          </section>
        </div>
      )}

      <nav className="mobile-nav counselor-mobile-nav" aria-label="Counselor navigation">
        {PRIMARY.map((item) => (
          <button
            key={item.view}
            type="button"
            className="mobile-nav-item"
            aria-current={counselor.view === item.view ? "page" : undefined}
            onClick={() => go(item.view)}
          >
            <span className="mobile-nav-icon"><Icon path={item.path} size={19} /></span>
            <span>{item.label}</span>
          </button>
        ))}
        <button
          ref={moreButton}
          type="button"
          className="mobile-nav-item"
          aria-current={moreActive ? "page" : undefined}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
        >
          <span className="mobile-nav-icon mobile-nav-more-icon" aria-hidden="true">
            <i /><i /><i />
          </span>
          <span>More</span>
        </button>
      </nav>
    </>
  );
}
