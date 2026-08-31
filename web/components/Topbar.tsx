"use client";

import { useStore } from "@/lib/store";
import { Dot, Icon, ICON } from "./ui";

export default function Topbar() {
  const s = useStore();
  const assignment = s.assignmentId ? s.assignmentById(s.assignmentId) : null;
  const course = s.courseId ? s.courseById(s.courseId) : null;

  const title = assignment?.title ?? course?.name ?? s.nav;
  const doneCount = s.snapshot.assignments.filter((a) => s.statusOf(a) === "done").length;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "16px 24px 12px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        {assignment ? (
          <button type="button" className="btn btn--quiet" style={{ height: 30 }} onClick={() => s.openAssignment(null)}>
            <Icon path={ICON.chevronLeft} size={14} />
            Back
          </button>
        ) : course ? (
          <button type="button" className="btn btn--quiet" style={{ height: 30 }} onClick={() => s.openCourse(null)}>
            <Icon path={ICON.chevronLeft} size={14} />
            All grades
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

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        {s.demoMode && s.connected && (
          <span className="badge badge--warning">Sample data</span>
        )}
        {s.view === "list" && !assignment && (
          <span className="badge badge--secondary">{doneCount} done today</span>
        )}
      </div>
    </div>
  );
}
