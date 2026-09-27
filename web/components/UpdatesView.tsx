"use client";

import { useEffect, useMemo, useState } from "react";

import { useStore } from "@/lib/store";
import type { Update } from "@/lib/types";
import { byDay, isUnseen, openClassOnUpdatesNext, sourceKey, sourcesOf, useUpdatesSeen } from "@/lib/updates";
import { Attachments } from "./AssignmentView";
import { Badge, Dot } from "./ui";

/** Past this many characters a post opens folded, so one long notice doesn't bury the rest. */
const FOLD_AT = 480;

/**
 * Every class's Updates in one feed.
 *
 * Teachers post the changes that matter this week here — an exam cancelled, a
 * quiz moved up — and Schoology leaves them on its home page, where they scroll
 * away. Grouped by day, filterable by class, with anything that arrived since
 * you last looked marked new. Each class also has its own on its page.
 */
export default function UpdatesView() {
  const s = useStore();
  const updates = useMemo(() => s.snapshot.updates ?? [], [s.snapshot.updates]);
  const { seen, markAllSeen } = useUpdatesSeen();
  // What counted as new when you opened this, held so the marks survive marking it all seen.
  const [fresh] = useState(() => new Set(updates.filter((u) => isUnseen(u, seen)).map((u) => u.id)));
  const [filter, setFilter] = useState("all");

  const newest = updates.reduce((max, u) => Math.max(max, u.at), 0);
  useEffect(() => {
    if (newest) markAllSeen(newest);
  }, [newest, markAllSeen]);

  const sources = useMemo(() => sourcesOf(updates), [updates]);
  const active = filter !== "all" && sources.some((src) => src.key === filter) ? filter : "all";
  const shown = useMemo(() => (active === "all" ? updates : updates.filter((u) => sourceKey(u) === active)), [updates, active]);

  return (
    <div className="scroll">
      <div className="col" style={{ maxWidth: 820, gap: 18 }}>
        {sources.length > 1 && (
          <div role="group" aria-label="Show updates from" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <Chip on={active === "all"} onClick={() => setFilter("all")}>
              All classes
            </Chip>
            {sources.map((src) => {
              const course = src.courseId ? s.courseById(src.courseId) : undefined;
              return (
                <Chip key={src.key} on={active === src.key} onClick={() => setFilter(src.key)}>
                  {course && <Dot color={course.dot} size={8} radius={3} />}
                  {course?.name ?? src.realm}
                  <span style={{ color: "var(--faint)" }}>{src.count}</span>
                </Chip>
              );
            })}
          </div>
        )}

        {updates.length === 0 && (
          <p style={{ margin: "24px 0", fontSize: 13, color: "var(--muted)", textAlign: "center" }}>
            {s.connected ? "No updates from your classes yet." : "Connect Schoology to see your classes' updates."}
          </p>
        )}

        <DayGroups updates={shown} fresh={fresh} showClass />
      </div>
    </div>
  );
}

/** One class's Updates, on its own page, the way Schoology files them under the course. */
export function ClassUpdates({ courseId }: { courseId: string }) {
  const s = useStore();
  const updates = useMemo(() => (s.snapshot.updates ?? []).filter((u) => u.courseId === courseId), [s.snapshot.updates, courseId]);
  const { seen, markSeen } = useUpdatesSeen();
  const [fresh] = useState(() => new Set(updates.filter((u) => isUnseen(u, seen)).map((u) => u.id)));

  useEffect(() => {
    if (updates.length) markSeen(updates);
  }, [updates, markSeen]);

  return (
    <div className="scroll">
      <div className="col" style={{ maxWidth: 820, gap: 18 }}>
        {updates.length === 0 && (
          <p style={{ margin: "8px 0", fontSize: 13, color: "var(--muted)" }}>Nothing has been posted to this class yet.</p>
        )}
        <DayGroups updates={updates} fresh={fresh} />
      </div>
    </div>
  );
}

function DayGroups({ updates, fresh, showClass = false }: { updates: Update[]; fresh: Set<string>; showClass?: boolean }) {
  const [now] = useState(() => new Date());
  const groups = useMemo(() => byDay(updates, now), [updates, now]);

  return groups.map((group) => (
    <section key={group.label} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h2 className="section-label" style={{ margin: 0 }}>
        {group.label}
      </h2>
      {group.items.map((u) => (
        <UpdateCard key={u.id} update={u} fresh={fresh.has(u.id)} showClass={showClass} />
      ))}
    </section>
  ));
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        border: "1px solid var(--line)",
        borderRadius: 9999,
        padding: "5px 12px",
        font: "inherit",
        fontSize: 12.5,
        cursor: "pointer",
        ...(on
          ? {
              backgroundImage: "linear-gradient(180deg, oklch(0.42 0 0) 0%, oklch(0.37 0 0) 100%)",
              color: "var(--text)",
              boxShadow: "var(--shadow-raised)",
            }
          : { background: "transparent", color: "var(--muted)" }),
      }}
    >
      {children}
    </button>
  );
}

function UpdateCard({ update: u, fresh, showClass }: { update: Update; fresh: boolean; showClass: boolean }) {
  const s = useStore();
  const course = u.courseId ? s.courseById(u.courseId) : undefined;
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
        {showClass &&
          (course ? (
            <button
              type="button"
              onClick={() => {
                openClassOnUpdatesNext(course.id);
                s.setNav("Classes", "classes");
                s.openCourse(course.id);
              }}
              title={`Open ${course.name}`}
              style={{ border: 0, padding: 0, background: "transparent", font: "inherit", cursor: "pointer" }}
            >
              <Badge tone={course.tone}>{course.short}</Badge>
            </button>
          ) : (
            <span className="truncate" style={{ fontSize: 12, color: "var(--muted)" }}>
              {u.realm}
            </span>
          ))}
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
