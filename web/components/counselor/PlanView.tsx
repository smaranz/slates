"use client";

import { useMemo, useState } from "react";

import { useCounselor } from "@/lib/counselor/store";
import { daysUntil, useToday } from "@/lib/counselor/today";
import { APPLICATION_ITEMS, APPLICATION_ITEM_LABEL, type Task } from "@/lib/counselor/types";
import { Icon, ICON } from "../ui";

/**
 * The plan: what's next, what's booked, what the counselor remembers, and
 * where every application stands.
 *
 * All four are records the counselor writes to during a conversation, so this
 * is where you check its work. Everything here is editable by hand — a
 * counselor that can add a task you can't delete is a counselor you stop
 * trusting.
 */

export default function PlanView() {
  const c = useCounselor();
  const today = useToday();
  const [draft, setDraft] = useState("");
  const [due, setDue] = useState("");

  const { open, done } = useMemo(() => {
    const byDue = (a: Task, b: Task) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
    return {
      open: c.tasks.filter((t) => t.status === "open").sort(byDue),
      done: c.tasks.filter((t) => t.status !== "open"),
    };
  }, [c.tasks]);

  const meetings = c.meetings.filter((m) => m.status === "scheduled");

  return (
    <div className="counselor-page">
      <div className="counselor-page-inner">
        <Section title="Next steps" count={open.length}>
          <form
            className="counselor-add"
            onSubmit={(e) => {
              e.preventDefault();
              const title = draft.trim();
              if (!title) return;
              c.addTask(title, due || undefined);
              setDraft("");
              setDue("");
            }}
          >
            <input
              className="bare-field"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add a step"
              aria-label="Add a step"
            />
            <input
              className="counselor-date"
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              aria-label="Due date"
            />
            <button type="submit" className="icon-btn" style={{ width: 28, height: 28 }} aria-label="Add">
              <Icon path={ICON.plus} size={13} />
            </button>
          </form>

          {open.length === 0 && <p className="counselor-empty-note">Nothing open.</p>}
          {open.map((t) => (
            <TaskRow key={t.id} task={t} today={today} />
          ))}

          {done.length > 0 && (
            <details className="counselor-done">
              <summary>{done.length} finished</summary>
              {done.map((t) => (
                <TaskRow key={t.id} task={t} today={today} />
              ))}
            </details>
          )}
        </Section>

        <Section title="Check-ins" count={meetings.length}>
          {meetings.length === 0 && (
            <p className="counselor-empty-note">
              None booked. Ask the counselor to schedule your next one.
            </p>
          )}
          {meetings.map((m) => (
            <div key={m.id} className="counselor-meeting">
              <span className="counselor-meeting-when">
                {new Date(m.scheduledFor).toLocaleString([], {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p className="counselor-meeting-topic truncate">{m.topic}</p>
                {m.agenda && <p className="counselor-meeting-agenda">{m.agenda}</p>}
              </div>
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => c.setView(m.mode === "voice" ? "voice" : "chat")}
              >
                <Icon path={m.mode === "voice" ? ICON.mic : ICON.tutor} size={13} />
                Start
              </button>
            </div>
          ))}
        </Section>

        <Section title="Applications" count={c.applications.length}>
          {c.applications.length === 0 && (
            <p className="counselor-empty-note">
              Nothing tracked. Tell the counselor which schools you&apos;re committing to and it
              opens the tracker.
            </p>
          )}
          {c.applications.map((a) => {
            const outstanding = APPLICATION_ITEMS.filter((k) => (a.items[k] ?? "todo") === "todo");
            const days = daysUntil(a.deadline, today);
            return (
              <div key={a.id} className="counselor-app">
                <div className="counselor-app-head">
                  <span className="counselor-app-name truncate">{a.collegeName}</span>
                  <span className="counselor-tag">{a.round}</span>
                  {a.deadline && (
                    <span
                      className="counselor-tag"
                      style={days != null && days <= 21 ? { color: "var(--warn)" } : undefined}
                    >
                      {days != null && days >= 0 ? `${days}d left` : a.deadline}
                    </span>
                  )}
                  {a.decision !== "pending" && <span className="counselor-tag is-strong">{a.decision}</span>}
                </div>
                <div className="counselor-app-items">
                  {APPLICATION_ITEMS.filter((k) => (a.items[k] ?? "todo") !== "na").map((k) => {
                    const state = a.items[k] ?? "todo";
                    return (
                      <span key={k} className={`counselor-item is-${state}`}>
                        {state === "done" && <Icon path={ICON.check} size={9} />}
                        {APPLICATION_ITEM_LABEL[k]}
                      </span>
                    );
                  })}
                </div>
                {a.recommenders.length > 0 && (
                  <p className="counselor-app-recs">
                    Recommenders:{" "}
                    {a.recommenders.map((r) => `${r.name}${r.status === "received" ? " ✓" : ""}`).join(", ")}
                  </p>
                )}
                {outstanding.length > 0 && (
                  <p className="counselor-app-left">{outstanding.length} things still outstanding</p>
                )}
              </div>
            );
          })}
        </Section>

        <Section title="What it remembers" count={c.memories.length}>
          {c.memories.length === 0 && (
            <p className="counselor-empty-note">
              Nothing yet. It saves things as it learns them — and you can delete any of them.
            </p>
          )}
          {[...c.memories]
            .sort((a, b) => b.importance - a.importance || b.updatedAt - a.updatedAt)
            .map((m) => (
              <div key={m.id} className="counselor-memory">
                <span className="counselor-tag">{m.kind}</span>
                <span style={{ flex: 1, minWidth: 0 }}>{m.content}</span>
                <button
                  type="button"
                  className="counselor-thread-del"
                  onClick={() => c.removeMemory(m.id)}
                  aria-label="Forget this"
                >
                  <Icon path={ICON.close} size={12} />
                </button>
              </div>
            ))}
        </Section>
      </div>
    </div>
  );
}

function TaskRow({ task, today }: { task: Task; today: string }) {
  const c = useCounselor();
  const overdue = task.status === "open" && Boolean(task.dueDate) && Boolean(today) && task.dueDate! < today;

  return (
    <div className={`counselor-task${task.status !== "open" ? " is-done" : ""}`}>
      <button
        type="button"
        className={`counselor-check${task.status === "done" ? " is-on" : ""}`}
        onClick={() => c.setTaskStatus(task.id, task.status === "done" ? "open" : "done")}
        aria-label={task.status === "done" ? "Reopen" : "Mark done"}
      >
        {task.status === "done" && <Icon path={ICON.check} size={10} />}
      </button>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p className="counselor-task-title">{task.title}</p>
        {task.detail && <p className="counselor-task-detail">{task.detail}</p>}
      </div>
      {task.dueDate && (
        <span className="counselor-tag" style={overdue ? { color: "var(--bad)" } : undefined}>
          {new Date(`${task.dueDate}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" })}
        </span>
      )}
      <button
        type="button"
        className="counselor-thread-del"
        onClick={() => c.removeTask(task.id)}
        aria-label="Delete"
      >
        <Icon path={ICON.close} size={12} />
      </button>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="counselor-section">
      <div className="counselor-section-head">
        <span className="section-label">{title}</span>
        {count != null && count > 0 && <span className="counselor-count">{count}</span>}
      </div>
      <div className="counselor-section-body">{children}</div>
    </section>
  );
}
