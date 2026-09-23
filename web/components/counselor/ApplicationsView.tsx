"use client";

import { useMemo, useState } from "react";

import { COLLEGES } from "@/lib/counselor/colleges";
import { useCounselor } from "@/lib/counselor/store";
import { daysUntil, useToday } from "@/lib/counselor/today";
import {
  APPLICATION_ITEMS,
  APPLICATION_ITEM_LABEL,
  type Application,
  type ApplicationItem,
  type ApplicationRound,
  type ApplicationStatus,
  type Decision,
  type RequirementStatus,
} from "@/lib/counselor/types";
import { Icon, ICON } from "../ui";

const ROUNDS: ApplicationRound[] = ["ED", "ED2", "EA", "REA", "RD", "Rolling"];
const STATUSES: ApplicationStatus[] = ["planning", "in_progress", "submitted"];
const REQUIREMENT_CYCLE: RequirementStatus[] = ["todo", "in_progress", "done", "na"];

export default function ApplicationsView() {
  const counselor = useCounselor();
  const today = useToday();
  const [adding, setAdding] = useState(false);
  const [school, setSchool] = useState("");
  const [round, setRound] = useState<ApplicationRound>("RD");
  const [deadline, setDeadline] = useState("");

  const applications = useMemo(
    () => [...counselor.applications].sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999")),
    [counselor.applications]
  );

  const submitted = applications.filter((app) => app.status === "submitted").length;
  const requirements = applications.reduce(
    (acc, app) => {
      const progress = applicationProgress(app);
      return { done: acc.done + progress.done, total: acc.total + progress.total };
    },
    { done: 0, total: 0 }
  );

  function saveApplications(next: Application[]) {
    counselor.merge({ applications: next });
  }

  function addApplication(event: React.FormEvent) {
    event.preventDefault();
    const name = school.trim();
    if (!name) return;
    const known = COLLEGES.find((college) => college.name.toLowerCase() === name.toLowerCase());
    const existing = counselor.applications.find((app) => app.collegeName.toLowerCase() === name.toLowerCase());
    if (existing) return;
    const now = Date.now();
    const application: Application = {
      id: `${Math.random().toString(36).slice(2, 10)}${now.toString(36).slice(-4)}`,
      collegeId: known?.id ?? null,
      collegeName: known?.name ?? name,
      round,
      deadline: deadline || null,
      status: "planning",
      decision: "pending",
      items: Object.fromEntries(APPLICATION_ITEMS.map((item) => [item, "todo"])) as Application["items"],
      recommenders: [],
      createdAt: now,
      updatedAt: now,
    };
    saveApplications([...counselor.applications, application]);
    setSchool("");
    setDeadline("");
    setRound("RD");
    setAdding(false);
  }

  function updateApplication(id: string, update: (application: Application) => Application) {
    saveApplications(counselor.applications.map((app) => app.id === id ? update(app) : app));
  }

  return (
    <div className="counselor-page counselor-applications-page">
      <div className="counselor-applications">
        <header className="counselor-applications-head">
          <div>
            <p className="counselor-overview-kicker">Application workspace</p>
            <h1>Every school, every requirement.</h1>
            <p>Track the work yourself or ask the counselor to update it during a conversation.</p>
          </div>
          <button type="button" className="btn btn--primary" onClick={() => setAdding((value) => !value)} aria-expanded={adding}>
            <Icon path={adding ? ICON.close : ICON.plus} size={13} />
            {adding ? "Cancel" : "Add application"}
          </button>
        </header>

        <section className="counselor-application-summary" aria-label="Application summary">
          <div><strong>{applications.length}</strong><span>Schools tracked</span></div>
          <div><strong>{submitted}</strong><span>Submitted</span></div>
          <div><strong>{requirements.total ? `${Math.round((requirements.done / requirements.total) * 100)}%` : "0%"}</strong><span>Requirements done</span></div>
          <div><strong>{applications.filter((app) => { const days = daysUntil(app.deadline, today); return days != null && days >= 0 && days <= 30; }).length}</strong><span>Due in 30 days</span></div>
        </section>

        {adding && (
          <form className="counselor-application-add" onSubmit={addApplication}>
            <label>
              <span>College</span>
              <input
                className="counselor-input"
                list="slates-colleges"
                value={school}
                onChange={(event) => setSchool(event.target.value)}
                placeholder="Start typing a school"
                autoFocus
              />
              <datalist id="slates-colleges">
                {COLLEGES.map((college) => <option key={college.id} value={college.name} />)}
              </datalist>
            </label>
            <label>
              <span>Round</span>
              <select className="counselor-input" value={round} onChange={(event) => setRound(event.target.value as ApplicationRound)}>
                {ROUNDS.map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label>
              <span>Deadline</span>
              <input className="counselor-input" type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
            </label>
            <button type="submit" className="btn btn--primary" disabled={!school.trim()}>Add to tracker</button>
          </form>
        )}

        {applications.length === 0 ? (
          <section className="counselor-applications-empty">
            <span><Icon path={ICON.assignments} size={24} /></span>
            <h2>Your tracker is ready.</h2>
            <p>Add a school here, or tell the counselor which applications you are committing to.</p>
            <div>
              <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>Add first application</button>
              <button type="button" className="btn btn--quiet" onClick={() => counselor.setView("chat")}>Ask the counselor</button>
            </div>
          </section>
        ) : (
          <div className="counselor-application-list">
            {applications.map((application) => (
              <ApplicationCard
                key={application.id}
                application={application}
                today={today}
                onUpdate={(update) => updateApplication(application.id, update)}
                onRemove={() => saveApplications(counselor.applications.filter((app) => app.id !== application.id))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ApplicationCard({ application, today, onUpdate, onRemove }: { application: Application; today: string; onUpdate: (update: (application: Application) => Application) => void; onRemove: () => void }) {
  const progress = applicationProgress(application);
  const days = daysUntil(application.deadline, today);
  const urgent = days != null && days <= 21 && application.status !== "submitted";

  function patch(fields: Partial<Application>) {
    onUpdate((current) => ({ ...current, ...fields, updatedAt: Date.now() }));
  }

  function cycleRequirement(item: ApplicationItem) {
    const current = application.items[item] ?? "todo";
    const next = REQUIREMENT_CYCLE[(REQUIREMENT_CYCLE.indexOf(current) + 1) % REQUIREMENT_CYCLE.length];
    patch({ items: { ...application.items, [item]: next } });
  }

  return (
    <article className="counselor-application-card">
      <header className="counselor-application-card-head">
        <div className="counselor-application-monogram" aria-hidden="true">{monogram(application.collegeName)}</div>
        <div className="counselor-application-identity">
          <h2>{application.collegeName}</h2>
          <span>{application.round} application</span>
        </div>
        <div className={`counselor-application-deadline${urgent ? " is-urgent" : ""}`}>
          <strong>{deadlineLabel(days, application.deadline)}</strong>
          <span>{application.deadline ? formatDate(application.deadline) : "No deadline"}</span>
        </div>
        <button type="button" className="icon-btn counselor-application-delete" onClick={() => { if (window.confirm(`Remove ${application.collegeName} from the application tracker?`)) onRemove(); }} aria-label={`Remove ${application.collegeName}`}>
          <Icon path={ICON.trash} size={13} />
        </button>
      </header>

      <div className="counselor-application-progress">
        <span><i style={{ width: `${progress.pct}%` }} /></span>
        <strong>{progress.done} of {progress.total} requirements complete</strong>
      </div>

      <div className="counselor-application-controls">
        <div>
          <span className="counselor-application-control-label">Stage</span>
          <span className="counselor-application-segmented">
            {STATUSES.map((status) => (
              <button key={status} type="button" className={application.status === status ? "is-on" : ""} onClick={() => patch({ status })}>
                {status.replace("_", " ")}
              </button>
            ))}
          </span>
        </div>
        <label>
          <span className="counselor-application-control-label">Decision</span>
          <select className="counselor-input" value={application.decision} onChange={(event) => patch({ decision: event.target.value as Decision })}>
            {(["pending", "accepted", "waitlisted", "deferred", "rejected"] as Decision[]).map((decision) => <option key={decision}>{decision}</option>)}
          </select>
        </label>
      </div>

      <div className="counselor-application-requirements">
        {APPLICATION_ITEMS.map((item) => {
          const status = application.items[item] ?? "todo";
          return (
            <button key={item} type="button" className={`is-${status}`} onClick={() => cycleRequirement(item)} aria-label={`${APPLICATION_ITEM_LABEL[item]}: ${status.replace("_", " ")}. Click to change.`}>
              <span>{status === "done" ? <Icon path={ICON.check} size={10} /> : status === "in_progress" ? <i /> : null}</span>
              {APPLICATION_ITEM_LABEL[item]}
            </button>
          );
        })}
      </div>
      <p className="counselor-application-hint">Click a requirement to move it from not started to in progress, done, or not applicable.</p>
    </article>
  );
}

function applicationProgress(application: Application) {
  const active = APPLICATION_ITEMS.filter((item) => (application.items[item] ?? "todo") !== "na");
  const done = active.filter((item) => application.items[item] === "done").length;
  return { done, total: active.length, pct: active.length ? Math.round((done / active.length) * 100) : 0 };
}

function deadlineLabel(days: number | null, deadline: string | null) {
  if (!deadline) return "Unscheduled";
  if (days == null) return "Deadline";
  if (days < 0) return `${Math.abs(days)} days overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `${days} days left`;
}

function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function monogram(name: string) {
  const words = name.split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}
