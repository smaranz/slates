"use client";

import Image from "next/image";
import { useEffect, useMemo } from "react";

import { useCounselor, type CounselorView } from "@/lib/counselor/store";
import { GRADE_LABEL, profileReady } from "@/lib/counselor/state";
import { markDesktopShell } from "@/lib/desktop-shell";
import { useIdentity } from "@/lib/identity";
import { useMode } from "@/lib/mode";
import { Avatar, Icon, ICON } from "../ui";

import ChatView from "./ChatView";
import CollegesView from "./CollegesView";
import DocumentsView from "./DocumentsView";
import PlanView from "./PlanView";
import ProfileView from "./ProfileView";
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
  return <Shell />;
}

interface NavDef {
  label: string;
  view: CounselorView;
  path: string | string[];
  count?: number;
}

function Shell() {
  const c = useCounselor();

  // Nothing the counselor says means anything without a name and a GPA, so a
  // blank record opens on the profile rather than on an empty chat that would
  // have to ask for all of it in prose.
  useEffect(() => {
    if (c.ready && !profileReady(c.profile)) c.setView("profile");
    // Only on the transition into ready — re-running would trap the student on
    // the profile every time they navigated away with it still incomplete.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.ready]);

  return (
    <div className="shell counselor">
      <CounselorSidebar />
      <div className="main">{c.ready ? <Pane view={c.view} /> : null}</div>
    </div>
  );
}

function Pane({ view }: { view: CounselorView }) {
  switch (view) {
    case "voice":
      return <VoiceView />;
    case "documents":
      return <DocumentsView />;
    case "plan":
      return <PlanView />;
    case "colleges":
      return <CollegesView />;
    case "profile":
      return <ProfileView />;
    case "chat":
    default:
      return <ChatView />;
  }
}

function CounselorSidebar() {
  const c = useCounselor();
  const { clear } = useMode();
  const identity = useIdentity();

  useEffect(() => {
    markDesktopShell();
  }, []);

  const navs = useMemo<NavDef[]>(() => {
    const openTasks = c.tasks.filter((t) => t.status === "open").length;
    return [
      { label: "Counselor", view: "chat", path: ICON.tutor },
      { label: "Call", view: "voice", path: ICON.mic },
      { label: "Plan", view: "plan", path: ICON.checklist, count: openTasks },
      { label: "Documents", view: "documents", path: ICON.file, count: c.documents.length },
      { label: "Colleges", view: "colleges", path: ICON.bands, count: c.list.length },
      { label: "Profile", view: "profile", path: ICON.settings },
    ];
  }, [c.tasks, c.documents.length, c.list.length]);

  const incomplete = c.ready && !profileReady(c.profile);

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
              {n.view === "profile" && incomplete ? (
                <span className="counselor-dot" aria-label="Incomplete" />
              ) : n.count ? (
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
          onClick={() => c.setView("profile")}
          aria-label="Open your profile"
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
