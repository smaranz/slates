"use client";

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
import MessagesView from "@/components/MessagesView";
import SettingsView from "@/components/SettingsView";
import AssignmentView from "@/components/AssignmentView";
import ClassesView from "@/components/ClassesView";
import CommandPalette from "@/components/CommandPalette";

export default function Page() {
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

  return (
    <div className="shell">
      <Sidebar />
      <div className="main">
        <Topbar />
        {body()}
      </div>
      <CommandPalette />
    </div>
  );
}
