"use client";

import Image from "next/image";
import { useEffect, useMemo } from "react";

import { inScope } from "@/lib/counselor/essays";
import { useCounselor, type CounselorView } from "@/lib/counselor/store";
import { GRADE_LABEL, profileReady } from "@/lib/counselor/state";
import { useIdentity } from "@/lib/identity";
import { useMode } from "@/lib/mode";
import { Avatar, Icon, ICON } from "../ui";
import MobileRuntimeProvider from "../MobileRuntime";

import ApplicationsView from "./ApplicationsView";
import ChatView from "./ChatView";
import CollegesView from "./CollegesView";
import CounselorMobileNav from "./CounselorMobileNav";
import CollegeEssaysView from "./CollegeEssaysView";
import OverviewView from "./OverviewView";
import PlanView from "./PlanView";
import VoiceView from "./VoiceView";

/**
 * The counselor half of Slates.
 *
 * Same shell as the school side — 256px rail, one pane — so switching between
 * them feels like two rooms in one building rather than two apps. What differs
 * is what's in the rail, and that the accent is violet rather than blue: at a
 * glance you can tell which half you're in without reading anything.
 */

export default function CounselorApp() {
  return (
    <MobileRuntimeProvider>
      <Shell />
    </MobileRuntimeProvider>
  );
}

interface NavDef {
  label: string;
  view: CounselorView;
  path: string | string[];
  count?: number;
}

function Shell() {
  const c = useCounselor();

  /*
   * An incomplete record is pointed out rather than forced.
   *
   * This used to jump straight to the profile tab, which was fine while that
   * was a tab. Settings is now a screen that takes over the window, and
   * sending someone there on mount looped: closing it remounted the counselor,
   * which sent them back. The chat's own "Fill in your profile" button and the
   * warning on the college list say the same thing without hijacking anyone.
   */

  return (
    <div className="shell counselor">
      <CounselorSidebar />
      <div className="main">{c.ready ? <Pane view={c.view} /> : null}</div>
      <CounselorMobileNav />
    </div>
  );
}

function Pane({ view }: { view: CounselorView }) {
  switch (view) {
    case "overview":
      return <OverviewView />;
    case "voice":
      return <VoiceView />;
    case "essays":
      return <CollegeEssaysView />;
    case "plan":
      return <PlanView />;
    case "applications":
      return <ApplicationsView />;
    case "colleges":
      return <CollegesView />;
    case "chat":
    default:
      return <ChatView />;
  }
}

function CounselorSidebar() {
  const c = useCounselor();
  /** Only the application essays — coursework lives on the school side. */
  const collegeEssays = c.essays.filter(inScope("college")).length;
  const { clear, openSettings } = useMode();
  const identity = useIdentity();

  useEffect(() => {
    if (navigator.userAgent.includes("Electron")) {
      document.documentElement.dataset.desktop = "1";
    }
  }, []);

  const navs = useMemo<NavDef[]>(() => {
    const openTasks = c.tasks.filter((t) => t.status === "open").length;
    return [
      { label: "Overview", view: "overview", path: ICON.overview },
      { label: "Counselor", view: "chat", path: ICON.tutor },
      { label: "Plan", view: "plan", path: ICON.checklist, count: openTasks },
      { label: "Applications", view: "applications", path: ICON.assignments, count: c.applications.length },
      { label: "Essays", view: "essays", path: ICON.essay, count: collegeEssays },
      { label: "Call", view: "voice", path: ICON.mic },
    ];
  }, [c.tasks, c.applications.length, collegeEssays]);

  return (
    <aside className="counselor-rail">
      {/* Same as the school rail: the brand takes you back to the launcher,
          and opts out of the frameless window's drag region so the click
          lands instead of moving the window. */}
      <div className="app-brand counselor-brand">
        <button type="button" className="brand-home" onClick={clear} title="Choose School or Counselor">
          <span className="counselor-brand-mark">
            <Image src="/assets/slates-mark.png" alt="Slates" width={26} height={26} />
          </span>
          <span className="counselor-brand-name">Slates</span>
        </button>
        <span className="counselor-brand-tag">Counselor</span>
      </div>

      <nav className="counselor-nav">
        {navs.map((n) => {
          const active = c.view === n.view;
          return (
            <button
              key={n.label}
              type="button"
              className={`counselor-nav-item${active ? " is-active" : ""}`}
              aria-current={active ? "page" : undefined}
              onClick={() => c.setView(n.view)}
            >
              <Icon path={n.path} size={16} />
              <span className="truncate" style={{ flex: 1 }}>
                {n.label}
              </span>
              {n.count ? (
                <span className="counselor-count">{n.count}</span>
              ) : null}
            </button>
          );
        })}
      </nav>

      {/* The same person, the same row, in the same place as the school half's
          sidebar — the two rails shouldn't disagree about who is using them. */}
      <div className="counselor-rail-foot">
        <button
          type="button"
          className="counselor-me"
          onClick={openSettings}
          aria-label="Open settings"
        >
          <Avatar src={identity.avatar} name={identity.name} size={28} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <p className="truncate counselor-me-name">{identity.name || "No name yet"}</p>
            <p className="counselor-me-sub">
              {profileReady(c.profile)
                ? `${GRADE_LABEL[c.profile.gradeLevel] ?? ""}, applying ${c.profile.applyYear}`
                : "Profile incomplete"}
            </p>
          </div>
        </button>
      </div>
    </aside>
  );
}
