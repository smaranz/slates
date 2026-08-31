"use client";

import { IMPACT_LABEL, useStore } from "@/lib/store";
import { fmtMinutes } from "@/lib/format";
import { Badge } from "./ui";

export default function ListView() {
  const s = useStore();

  const tonight = s.snapshot.assignments.filter(
    (a) => s.bucketOf(a) === "tonight" && s.statusOf(a) !== "done"
  );

  return (
    <div className="scroll centered">
      <div className="col" style={{ maxWidth: 1100, gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {tonight.map((a, i) => {
            const course = s.courseById(a.courseId);
            const active = s.statusOf(a) === "active";
            const overlay = a.submit === "overlay";
            return (
              <div
                key={a.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 14,
                  borderBottom: "1px solid var(--line)",
                  padding: "16px 4px",
                }}
              >
                <span
                  className="tabular"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 22,
                    height: 22,
                    flexShrink: 0,
                    marginTop: 1,
                    borderRadius: 9999,
                    fontSize: 11,
                    fontWeight: 600,
                    background: active ? "oklch(0.4 0.1 250 / 0.3)" : "var(--sunken)",
                    color: active ? "var(--info)" : "var(--text-2)",
                    boxShadow: "var(--shadow-sunken)",
                  }}
                >
                  {i + 1}
                </span>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <button
                    type="button"
                    onClick={() => s.openAssignment(a.id)}
                    style={{
                      display: "block",
                      width: "100%",
                      border: 0,
                      background: "transparent",
                      padding: 0,
                      margin: 0,
                      textAlign: "left",
                      cursor: "pointer",
                      font: "inherit",
                    }}
                  >
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: "var(--text)" }}>
                      {a.title}
                    </p>
                  </button>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--muted)" }}>
                    {course?.short} · {fmtMinutes(a.minutes)} · {a.due}
                  </p>
                  {a.impactNote && (
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--muted)" }}>
                      {a.impactNote}
                    </p>
                  )}
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 8,
                    flexShrink: 0,
                  }}
                >
                  <Badge tone={IMPACT_LABEL[a.impact].tone}>{IMPACT_LABEL[a.impact].label}</Badge>
                  <button
                    type="button"
                    className={`btn ${active ? "btn--quiet" : "btn--primary"}`}
                    onClick={() =>
                      overlay ? s.openOverlay(a.id) : s.setStatus(a.id, active ? "done" : "active")
                    }
                  >
                    {overlay ? "Open in Schoology" : active ? "Mark done" : "Start"}
                  </button>
                </div>
              </div>
            );
          })}

          {tonight.length === 0 && (
            <div
              style={{
                borderRadius: 20,
                border: "1px dashed var(--line-strong)",
                padding: "28px 14px",
                textAlign: "center",
                fontSize: 13,
                color: "var(--muted)",
              }}
            >
              Nothing left tonight.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
