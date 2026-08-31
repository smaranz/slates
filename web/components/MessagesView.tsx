"use client";

import { useStore } from "@/lib/store";
import { Badge, Dot } from "./ui";

export default function MessagesView() {
  const s = useStore();
  const active = s.snapshot.messages.find((m) => m.id === s.msgOpen);
  const activeCourse = active ? s.courseById(active.courseId) : null;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", justifyContent: "center", padding: "0 24px 24px" }}>
      <div
        style={{
          width: "100%",
          maxWidth: 1100,
          display: "grid",
          gridTemplateColumns: "340px 1fr",
          gap: 16,
          minHeight: 0,
        }}
      >
        <div className="card" style={{ overflowY: "auto", minHeight: 0 }}>
          {s.snapshot.messages.map((m) => {
            const c = s.courseById(m.courseId);
            const unread = m.unread && !s.msgRead[m.id];
            const isOpen = s.msgOpen === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => s.openMessage(m.id)}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  width: "100%",
                  border: 0,
                  borderBottom: "1px solid var(--line)",
                  background: isOpen ? "var(--hover)" : "transparent",
                  padding: "14px 16px",
                  font: "inherit",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span style={{ marginTop: 4 }}>
                  <Dot color={unread ? "oklch(0.72 0.16 250)" : "transparent"} radius={9999} />
                </span>
                <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3 }}>
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%" }}>
                    <span style={{ fontSize: 13, fontWeight: unread ? 600 : 500, color: "var(--text)" }}>{m.from}</span>
                    <span style={{ flexShrink: 0, fontSize: 11, color: "var(--muted)" }}>{m.time}</span>
                  </span>
                  <span
                    className="truncate"
                    style={{
                      width: "100%",
                      fontSize: 13,
                      fontWeight: unread ? 600 : 400,
                      color: unread ? "var(--text)" : "var(--text-2)",
                    }}
                  >
                    {m.subject}
                  </span>
                  {c && <Badge tone={c.tone}>{c.short}</Badge>}
                </span>
              </button>
            );
          })}
        </div>

        <div className="card" style={{ overflowY: "auto", minHeight: 0, padding: "22px 26px" }}>
          {!active && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 13, color: "var(--muted)" }}>
              Select a message to read it
            </div>
          )}
          {active && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {activeCourse && <Badge tone={activeCourse.tone}>{activeCourse.short}</Badge>}
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{active.time}</span>
              </div>
              <div style={{ marginTop: 10, fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--text)" }}>
                {active.subject}
              </div>
              <div style={{ marginTop: 4, fontSize: 13, color: "var(--muted)" }}>{active.from}</div>
              <p style={{ margin: "18px 0 0", fontSize: 14, lineHeight: 1.6, color: "var(--text-2)", maxWidth: "60ch" }}>
                {active.body}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
