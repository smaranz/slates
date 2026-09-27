"use client";

import { useEffect, useMemo, useState } from "react";

import { useStore } from "@/lib/store";
import type { Update } from "@/lib/types";
import {
  byDay,
  dayLabel,
  filterUpdatesNext,
  sourceKey,
  sourcesOf,
  takeUpdatesFilter,
  useUpdatesSeen,
} from "@/lib/updates";
import { Attachments } from "./AssignmentView";
import { Badge, Dot, Icon, ICON } from "./ui";

/** Past this many characters a post opens folded, so one long notice doesn't bury the rest. */
const FOLD_AT = 480;

/**
 * Every class's Updates in one feed.
 *
 * Teachers post the changes that matter this week here — an exam cancelled, a
 * quiz moved up — and Schoology leaves them on its home page, where they scroll
 * away. Grouped by day, filterable by class, with anything that arrived since
 * you last looked marked new.
 */
export default function UpdatesView() {
  const s = useStore();
  const updates = useMemo(() => s.snapshot.updates ?? [], [s.snapshot.updates]);
  const [seenAt, markSeen] = useUpdatesSeen();
  // What counted as new when you opened this, held so the marks survive marking it all seen.
  const [since] = useState(seenAt);
  const [now] = useState(() => new Date());
  const [filter, setFilter] = useState(() => takeUpdatesFilter() ?? "all");

  const newest = updates.reduce((max, u) => Math.max(max, u.at), 0);
  useEffect(() => {
    if (newest) markSeen(newest);
  }, [newest, markSeen]);

  const sources = useMemo(() => sourcesOf(updates), [updates]);
  const active = filter !== "all" && sources.some((src) => src.key === filter) ? filter : "all";
  const groups = useMemo(
    () => byDay(active === "all" ? updates : updates.filter((u) => sourceKey(u) === active), now),
    [updates, active, now]
  );

  return (
    <div className="scroll">
      <div className="col" style={{ gap: 18 }}>
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

        {groups.map((group) => (
          <section key={group.label} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h2 className="section-label" style={{ margin: 0 }}>
              {group.label}
            </h2>
            {group.items.map((u) => (
              <UpdateCard key={u.id} update={u} fresh={u.at > since} />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
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

function UpdateCard({ update: u, fresh }: { update: Update; fresh: boolean }) {
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
        {course ? (
          <Badge tone={course.tone}>{course.short}</Badge>
        ) : (
          <span className="truncate" style={{ fontSize: 12, color: "var(--muted)" }}>
            {u.realm}
          </span>
        )}
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

/** Long enough to cover a quiz announced a couple of weeks out. */
const PEEK_DAYS = 21;

/** A class's latest post, at the top of its page while it's recent, opening the feed on that class. */
export function UpdatesPeek({ courseId }: { courseId: string }) {
  const s = useStore();
  const mine = (s.snapshot.updates ?? []).filter((u) => u.courseId === courseId).sort((a, b) => b.at - a.at);
  const latest = mine[0];
  if (!latest || latest.at < s.snapshot.syncedAt - PEEK_DAYS * 86_400_000) return null;

  return (
    <button
      type="button"
      className="card"
      onClick={() => {
        filterUpdatesNext(`c:${courseId}`);
        s.setNav("Updates", "updates");
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        width: "100%",
        border: "1px solid var(--line)",
        padding: "13px 16px",
        font: "inherit",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", fontSize: 12, color: "var(--muted)" }}>
        <Icon path={ICON.updates} size={13} />
        <span className="truncate">
          Latest update · {latest.author} · {dayLabel(latest.at, new Date(s.snapshot.syncedAt))}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ flexShrink: 0 }}>{mine.length > 1 ? `All ${mine.length} →` : "Open →"}</span>
      </span>
      <span
        style={{
          fontSize: 13.5,
          lineHeight: 1.5,
          color: "var(--text-2)",
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {latest.text || "Open it to see this post."}
      </span>
    </button>
  );
}
