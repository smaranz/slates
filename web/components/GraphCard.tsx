"use client";

import type { TutorGraph } from "@/lib/tutor-graph";
import DesmosGraph from "./DesmosGraph";
import MathText from "./MathText";
import { Icon, ICON } from "./ui";

/** A graph the tutor plotted, set apart from chat prose the way `QuizCard` and `DocumentCard` are. */
export default function GraphCard({ graph }: { graph: TutorGraph }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        width: "100%",
        /*
         * The message column sizes each bubble to its content (`align-items:
         * flex-start`), which a short chat reply wants — but an empty-until-
         * mounted Desmos container has no content to size against, so without
         * a floor it collapses toward zero instead of filling the column. Has
         * to be a plain px floor, not `min(420px, 100%)`: that percentage
         * resolves against this same shrink-to-fit width, so it collapses
         * right along with it instead of ever winning out at 420px.
         */
        minWidth: 420,
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--line)",
        background: "var(--surface)",
        padding: "14px 14px 10px",
      }}
    >
      {graph.title && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 2px" }}>
          <Icon path={ICON.grades} size={13} style={{ color: "var(--muted)", flexShrink: 0 }} />
          <span className="truncate" style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
            <MathText text={graph.title} />
          </span>
        </div>
      )}
      <DesmosGraph graph={graph} />
    </div>
  );
}
