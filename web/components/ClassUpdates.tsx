"use client";

import { useEffect, useMemo, useState } from "react";

import { useStore } from "@/lib/store";
import type { Update } from "@/lib/types";
import { byDay, isUnseen, useUpdatesSeen } from "@/lib/updates";
import { Attachments } from "./AssignmentView";
import { Badge } from "./ui";

/** Past this many characters a post opens folded, so one long notice doesn't bury the rest. */
const FOLD_AT = 480;

/**
 * One class's Updates, on its own page, the way Schoology files them under the course.
 *
 * Teachers post the changes that matter this week here — an exam cancelled, a
 * quiz moved up. Grouped by day, with anything that arrived since you last
 * looked marked new.
 */
export default function ClassUpdates({ courseId }: { courseId: string }) {
  const s = useStore();
  const updates = useMemo(() => (s.snapshot.updates ?? []).filter((u) => u.courseId === courseId), [s.snapshot.updates, courseId]);
  const { seen, markSeen } = useUpdatesSeen();
  // What counted as new when you opened this, held so the marks survive marking them seen.
  const [fresh] = useState(() => new Set(updates.filter((u) => isUnseen(u, seen)).map((u) => u.id)));
  const [now] = useState(() => new Date());
  const groups = useMemo(() => byDay(updates, now), [updates, now]);

  useEffect(() => {
    if (updates.length) markSeen(updates);
  }, [updates, markSeen]);

  return (
    <div className="scroll">
      <div className="col" style={{ maxWidth: 820, gap: 18 }}>
        {updates.length === 0 && (
          <p style={{ margin: "8px 0", fontSize: 13, color: "var(--muted)" }}>Nothing has been posted to this class yet.</p>
        )}
        {groups.map((group) => (
          <section key={group.label} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h2 className="section-label" style={{ margin: 0 }}>
              {group.label}
            </h2>
            {group.items.map((u) => (
              <UpdateCard key={u.id} update={u} fresh={fresh.has(u.id)} />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function UpdateCard({ update: u, fresh }: { update: Update; fresh: boolean }) {
  const s = useStore();
  const long = u.text.length > FOLD_AT;
  const [open, setOpen] = useState(!long);
  const folded = open ? undefined : { maxHeight: "9.6em", overflow: "hidden", maskImage: "linear-gradient(180deg, #000 55%, transparent)" };
  const when = new Date(u.at);

  return (
    <article
      className="card"
      style={{ display: "flex", flexDirection: "column", gap: 10, border: "1px solid var(--line)", padding: "16px 18px" }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span className="truncate" style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
          {u.author}
        </span>
        {fresh && <Badge tone="speed">New</Badge>}
        <span style={{ flex: 1 }} />
        <time
          dateTime={when.toISOString()}
          title={when.toLocaleString()}
          style={{ flexShrink: 0, fontSize: 12, color: "var(--faint)" }}
        >
          {when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </time>
      </header>

      {u.kind === "poll" && <span style={{ fontSize: 12, color: "var(--muted)" }}>Poll · answer it in Schoology</span>}

      {u.html ? (
        <div className="prose" style={folded} dangerouslySetInnerHTML={{ __html: u.html }} />
      ) : u.text ? (
        <p className="prose" style={{ margin: 0, whiteSpace: "pre-wrap", ...folded }}>
          {u.text}
        </p>
      ) : null}

      {long && (
        <button type="button" className="btn btn--quiet" onClick={() => setOpen((v) => !v)} style={{ alignSelf: "flex-start" }}>
          {open ? "Show less" : "Show more"}
        </button>
      )}

      {u.media > 0 && (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }}>
          {u.text
            ? `Also has ${u.media === 1 ? "an image or video" : `${u.media} images or videos`} that open in Schoology.`
            : "This post is an image or video. Open it in Schoology to see it."}
        </p>
      )}

      {u.attachments.length > 0 && <Attachments items={u.attachments} domain={s.snapshot.domain} />}

      <footer style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: "var(--muted)" }}>
        {u.comments > 0 && <span>{u.comments === 1 ? "1 comment" : `${u.comments} comments`}</span>}
        <span style={{ flex: 1 }} />
        {u.realmUrl && (
          <a href={u.realmUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--muted)" }}>
            Open in Schoology ↗
          </a>
        )}
      </footer>
    </article>
  );
}
