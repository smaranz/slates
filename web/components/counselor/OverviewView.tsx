"use client";

import { useMemo } from "react";

import { BAND_META, computeChance } from "@/lib/counselor/chances";
import { getCollege } from "@/lib/counselor/colleges";
import { inScope } from "@/lib/counselor/essays";
import { useCounselor } from "@/lib/counselor/store";
import { profileReady } from "@/lib/counselor/state";
import { daysUntil, useToday } from "@/lib/counselor/today";
import { APPLICATION_ITEMS, type Application, type ChanceBand } from "@/lib/counselor/types";
import { useIdentity } from "@/lib/identity";
import { useMode } from "@/lib/mode";
import { Icon, ICON } from "../ui";

const EMPTY_BANDS: Record<ChanceBand, number> = {
  safety: 0,
  match: 0,
  reach: 0,
  "hard-reach": 0,
};

export default function OverviewView() {
  const counselor = useCounselor();
  const identity = useIdentity();
  const { openSettings } = useMode();
  const today = useToday();

  const profileCompletion = useMemo(() => {
    const fields = [
      Boolean(counselor.profile.name.trim()),
      Boolean(counselor.profile.state),
      Boolean(counselor.profile.highSchool),
      counselor.profile.gpaUnweighted != null,
      Boolean(counselor.profile.intendedMajor.trim()),
      counselor.profile.sat != null || counselor.profile.act != null,
      counselor.profile.activities.length > 0,
      counselor.profile.budgetMax != null,
      counselor.coursework.length > 0,
    ];
    return Math.round((fields.filter(Boolean).length / fields.length) * 100);
  }, [counselor.profile, counselor.coursework.length]);

  const bands = useMemo(() => {
    const next = { ...EMPTY_BANDS };
    for (const entry of counselor.list) {
      const college = getCollege(entry.collegeId);
      if (!college) continue;
      next[computeChance(counselor.profile, college, entry.round).band] += 1;
    }
    return next;
  }, [counselor.list, counselor.profile]);

  const openTasks = useMemo(
    () => counselor.tasks
      .filter((task) => task.status === "open")
      .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")),
    [counselor.tasks]
  );

  const applications = useMemo(
    () => [...counselor.applications].sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999")),
    [counselor.applications]
  );

  const firstName = (identity.name || counselor.profile.name).trim().split(/\s+/)[0];
  const collegeEssays = counselor.essays.filter(inScope("college"));
  const portfolioCount = collegeEssays.length;
  const completedRequirements = applications.reduce((total, app) => total + applicationProgress(app).done, 0);
  const totalRequirements = applications.reduce((total, app) => total + applicationProgress(app).total, 0);
  const ready = profileReady(counselor.profile);

  return (
    <div className="counselor-page counselor-overview-page">
      <div className="counselor-overview">
        <header className="counselor-overview-hero">
          <div>
            <p className="counselor-overview-kicker">Admissions command center</p>
            <h1>{firstName ? `${firstName}'s college plan` : "Your college plan"}</h1>
            <p className="counselor-overview-deck">
              {ready
                ? overviewSentence(openTasks.length, applications.length)
                : "Build the record once. Your counselor will use it across every conversation, plan, and application."}
            </p>
          </div>
          <div className="counselor-overview-actions">
            <button type="button" className="btn btn--primary" onClick={() => counselor.setView("chat")}>
              <Icon path={ICON.tutor} size={14} />
              Talk to counselor
            </button>
            {!ready && (
              <button type="button" className="btn btn--quiet" onClick={openSettings}>
                Complete profile
              </button>
            )}
          </div>
        </header>

        <section className="counselor-overview-stats" aria-label="College planning status">
          <OverviewStat
            label="Profile"
            value={`${profileCompletion}%`}
            detail={profileCompletion === 100 ? "Ready for precise advice" : "Complete your admissions record"}
            progress={profileCompletion}
            onClick={openSettings}
          />
          <OverviewStat
            label="College list"
            value={String(counselor.list.length)}
            detail={counselor.list.length ? `${bands.safety} likely, ${bands.match} match, ${bands.reach + bands["hard-reach"]} reach` : "Build a balanced list"}
            onClick={() => counselor.setView("colleges")}
          />
          <OverviewStat
            label="Applications"
            value={applications.length ? `${completedRequirements}/${totalRequirements}` : "0"}
            detail={applications.length ? "Requirements complete" : "Nothing tracked yet"}
            progress={totalRequirements ? Math.round((completedRequirements / totalRequirements) * 100) : 0}
            onClick={() => counselor.setView("applications")}
          />
          <OverviewStat
            label="Essays"
            value={String(portfolioCount)}
            detail={portfolioCount ? "College drafts in progress" : "Start your personal statement"}
            onClick={() => counselor.setView("essays")}
          />
        </section>

        <div className="counselor-overview-grid">
          <section className="counselor-overview-panel counselor-overview-panel--wide">
            <PanelHeading label="Up next" count={openTasks.length} action="Open plan" onClick={() => counselor.setView("plan")} />
            <div className="counselor-overview-list">
              {openTasks.length === 0 ? (
                <OverviewEmpty
                  title="No open priorities"
                  detail="Ask your counselor what matters most this week and it will build the list with you."
                  action="Plan my week"
                  onClick={() => counselor.setView("chat")}
                />
              ) : openTasks.slice(0, 5).map((task) => {
                const days = daysUntil(task.dueDate, today);
                return (
                  <div key={task.id} className="counselor-overview-task">
                    <button
                      type="button"
                      className="counselor-check"
                      onClick={() => counselor.setTaskStatus(task.id, "done")}
                      aria-label={`Mark ${task.title} done`}
                    />
                    <div>
                      <strong>{task.title}</strong>
                      {task.detail && <span>{task.detail}</span>}
                    </div>
                    <Deadline days={days} date={task.dueDate} />
                  </div>
                );
              })}
            </div>
          </section>

          <section className="counselor-overview-panel">
            <PanelHeading label="Application runway" count={applications.length} action="View tracker" onClick={() => counselor.setView("applications")} />
            <div className="counselor-overview-list">
              {applications.length === 0 ? (
                <OverviewEmpty
                  title="No applications yet"
                  detail="Add the schools you are committing to so deadlines and requirements stay visible."
                  action="Start tracker"
                  onClick={() => counselor.setView("applications")}
                />
              ) : applications.slice(0, 4).map((app) => {
                const progress = applicationProgress(app);
                return (
                  <button
                    key={app.id}
                    type="button"
                    className="counselor-overview-app"
                    onClick={() => counselor.setView("applications")}
                  >
                    <span className="counselor-overview-app-main">
                      <strong>{app.collegeName}</strong>
                      <span>{app.round} - {progress.done} of {progress.total} complete</span>
                    </span>
                    <span className="counselor-overview-mini-meter"><i style={{ width: `${progress.pct}%` }} /></span>
                    <Deadline days={daysUntil(app.deadline, today)} date={app.deadline ?? undefined} />
                  </button>
                );
              })}
            </div>
          </section>

          <section className="counselor-overview-panel">
            <PanelHeading label="List balance" count={counselor.list.length} action="Explore" onClick={() => counselor.setView("colleges")} />
            {counselor.list.length ? (
              <div className="counselor-overview-bands">
                {(Object.keys(EMPTY_BANDS) as ChanceBand[]).map((band) => (
                  <div key={band}>
                    <i style={{ background: BAND_META[band].color }} />
                    <strong>{bands[band]}</strong>
                    <span>{BAND_META[band].label}</span>
                  </div>
                ))}
              </div>
            ) : (
              <OverviewEmpty
                title="Your list is still open"
                detail="Compare realistic odds, cost, majors, and application rounds across 40 schools."
                action="Explore colleges"
                onClick={() => counselor.setView("colleges")}
              />
            )}
          </section>

          <section className="counselor-overview-panel">
            <PanelHeading label="Recent work" count={portfolioCount} />
            <div className="counselor-overview-list">
              {portfolioCount === 0 ? (
                <OverviewEmpty
                  title="No saved work yet"
                  detail="Your personal statement and application supplements will stay here."
                  action="Open essays"
                  onClick={() => counselor.setView("essays")}
                />
              ) : (
                <>
                  {collegeEssays.slice(0, 3).map((essay) => (
                    <button key={essay.id} type="button" className="counselor-overview-work" onClick={() => { counselor.openEssay(essay.id); counselor.setView("essays"); }}>
                      <span className="counselor-overview-work-icon"><Icon path={ICON.essay} size={15} /></span>
                      <span><strong>{essay.title}</strong><small>{wordCount(essay.content)} words</small></span>
                    </button>
                  ))}
                </>
              )}
            </div>
          </section>
        </div>

        <p className="counselor-overview-privacy">
          <Icon path={ICON.check} size={11} /> Your counselor record stays in this Slates workspace on your device.
        </p>
      </div>
    </div>
  );
}

function OverviewStat({ label, value, detail, progress, onClick }: { label: string; value: string; detail: string; progress?: number; onClick: () => void }) {
  return (
    <button type="button" className="counselor-overview-stat" onClick={onClick}>
      <span className="counselor-overview-stat-label">{label}</span>
      <strong>{value}</strong>
      <span className="counselor-overview-stat-detail">{detail}</span>
      {progress != null && <span className="counselor-overview-stat-meter"><i style={{ width: `${progress}%` }} /></span>}
    </button>
  );
}

function PanelHeading({ label, count, action, onClick }: { label: string; count?: number; action?: string; onClick?: () => void }) {
  return (
    <header className="counselor-overview-panel-head">
      <span className="section-label">{label}</span>
      {count != null && count > 0 && <span className="counselor-count">{count}</span>}
      <span className="counselor-overview-panel-gap" />
      {action && onClick && <button type="button" onClick={onClick}>{action}</button>}
    </header>
  );
}

function OverviewEmpty({ title, detail, action, onClick }: { title: string; detail: string; action: string; onClick: () => void }) {
  return (
    <div className="counselor-overview-empty">
      <strong>{title}</strong>
      <p>{detail}</p>
      <button type="button" onClick={onClick}>{action}</button>
    </div>
  );
}

function Deadline({ days, date }: { days: number | null; date?: string }) {
  if (!date) return <span className="counselor-overview-due">No date</span>;
  const urgent = days != null && days <= 21;
  const text = days == null
    ? formatDate(date)
    : days < 0
      ? `${Math.abs(days)}d overdue`
      : days === 0
        ? "Today"
        : `${days}d`;
  return <span className={`counselor-overview-due${urgent ? " is-urgent" : ""}`}>{text}</span>;
}

function applicationProgress(app: Application) {
  const active = APPLICATION_ITEMS.filter((item) => (app.items[item] ?? "todo") !== "na");
  const done = active.filter((item) => app.items[item] === "done").length;
  return { done, total: active.length, pct: active.length ? Math.round((done / active.length) * 100) : 0 };
}

function overviewSentence(tasks: number, applications: number) {
  if (tasks && applications) return `${tasks} priorities and ${applications} applications are moving. Keep the next decision visible.`;
  if (tasks) return `${tasks} priorities are open. Your plan is ready for the next conversation.`;
  if (applications) return `${applications} applications are being tracked. Use the runway to stay ahead of every requirement.`;
  return "Your record is ready. Build the list, make the plan, and keep every decision in one place.";
}

function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function wordCount(value: string) {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}
