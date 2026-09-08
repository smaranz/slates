"use client";

import { useMode } from "@/lib/mode";
import { useStore } from "@/lib/store";

import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import EmptyState from "@/components/EmptyState";
import BoardView from "@/components/BoardView";
import ListView from "@/components/ListView";
import GradesView from "@/components/GradesView";
import CourseView from "@/components/CourseView";
import CalendarView from "@/components/CalendarView";
import TutorView from "@/components/TutorView";
import EssaysView from "@/components/counselor/EssaysView";
import MessagesView from "@/components/MessagesView";
import SettingsView from "@/components/SettingsView";
import AssignmentView from "@/components/AssignmentView";
import ClassesView from "@/components/ClassesView";
import CommandPalette from "@/components/CommandPalette";
import MobileNav from "@/components/MobileNav";
import MobileRuntimeProvider from "@/components/MobileRuntime";
import Launcher from "@/components/Launcher";
import CounselorApp from "@/components/counselor/CounselorApp";

export default function Page() {
  const { mode, ready } = useMode();

  // Nothing renders until the saved choice has been read. A frame of the
  // launcher before jumping into School would be a flash of the wrong app.
  if (!ready) return <div className="shell" />;
  if (!mode) return <Launcher />;
  if (mode === "counselor") return <CounselorApp />;
  return <School />;
}

function School() {
  const s = useStore();

  const nothingSynced = s.snapshot.assignments.length === 0;

  function body() {
    // An open assignment takes over the pane regardless of which nav is active.
    if (s.assignmentId) return <AssignmentView />;

    switch (s.view) {
      case "classes":
        // Same course selection as Grades, a different question about it:
        // everything the class has set, rather than how it's scored.
        return nothingSynced ? <EmptyState /> : <ClassesView />;
      case "grades":
        return s.courseId ? <CourseView /> : <GradesView />;
      case "calendar":
        return <CalendarView />;
      case "tutor":
        return <TutorView />;
      case "essays":
        return <EssaysView />;
      case "messages":
        return <MessagesView />;
      case "settings":
        return <SettingsView />;
      case "list":
        return nothingSynced ? <EmptyState /> : <ListView />;
      case "board":
      default:
        return nothingSynced ? <EmptyState /> : <BoardView />;
    }
  }

  /*
   * What is actually on screen, which is not always `s.view` — an open
   * assignment takes the pane over from whichever nav is lit.
   */
  const showing = s.assignmentId ? "assignment" : s.view;

  return (
    <MobileRuntimeProvider>
      <div className="shell">
        <Sidebar />
        <div className="main">
          <Topbar />
          {/* Keyed on what's showing so React remounts the pane, which is what
              gives the entrance animation something to play against. Without
              the key you get one long-lived div and no transition at all. */}
          <div className="view-swap" key={showing}>
            {body()}
          </div>
        </div>
        <MobileNav />
        <CommandPalette />
      </div>
    </MobileRuntimeProvider>
  );
}
