"use client";

import { useState } from "react";

import { useStore } from "@/lib/store";
import OwnWorkDialog from "./OwnWorkDialog";
import { Dot, Icon, ICON } from "./ui";

export default function Topbar() {
  const s = useStore();
  const [adding, setAdding] = useState(false);
  const assignment = s.assignmentId ? s.assignmentById(s.assignmentId) : null;
  const course = s.courseId ? s.courseById(s.courseId) : null;

  const title = assignment?.title ?? course?.name ?? s.nav;
  const doneCount = s.snapshot.assignments.filter((a) => s.statusOf(a) === "done").length;

  // The tutor draws its own header — the model you're talking to, the way back
  // to the conversation list, and a new chat. A bar above that saying "Tutor"
  // is a second title for a view that already has one. An assignment opened
  // from anywhere still gets the topbar, because that is where Back lives.
  if (s.view === "tutor" && !assignment) return null;

  return (
    <div
      className="topbar"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "16px 24px 12px",
      }}
    >
      <div className="topbar-leading" style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        {assignment ? (
          <button type="button" className="btn btn--quiet" style={{ height: 30 }} onClick={() => s.openAssignment(null)}>
            <Icon path={ICON.chevronLeft} size={14} />
            Back
          </button>
        ) : course ? (
          <button type="button" className="btn btn--quiet" style={{ height: 30 }} onClick={() => s.openCourse(null)}>
            <Icon path={ICON.chevronLeft} size={14} />
            {s.view === "classes" ? "All classes" : "All grades"}
          </button>
        ) : null}

        {course && !assignment && <Dot color={course.dot} size={14} radius={4} />}

        <span
          className="truncate"
          style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--text)" }}
        >
          {title}
        </span>
      </div>

      <div className="topbar-status" style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        {s.demoMode && s.connected && (
          <span className="badge badge--warning">Sample data</span>
        )}
        {s.view === "list" && !assignment && (
          <span className="badge badge--secondary">{doneCount} done today</span>
        )}

        {/* Plenty of real work never reaches Schoology — a reading assigned out
            loud, a make-up test arranged by email. This is on the views where
            work is planned; it would be noise on Grades or Settings. */}
        {!assignment && (s.view === "board" || s.view === "list" || s.view === "calendar") && (
          <button
            type="button"
            className="btn btn--quiet"
            style={{ height: 30 }}
            onClick={() => setAdding(true)}
            title="Add work Schoology doesn't know about"
          >
            <Icon path={ICON.plus} size={14} />
            Add
          </button>
        )}
      </div>

      {adding && <OwnWorkDialog courseId={course?.id} onClose={() => setAdding(false)} />}
    </div>
  );
}
