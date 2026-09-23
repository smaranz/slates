"use client";

import { motion } from "motion/react";
import { useState } from "react";

import { planFingerprint } from "@/lib/counselor/plan";
import { STRATEGY_AREAS, type MasterPlan, type PlanRecommendation, type StrategyArea } from "@/lib/counselor/plan-types";
import { profileReady } from "@/lib/counselor/state";
import { useCounselor } from "@/lib/counselor/store";
import { useCounselorModel, useCounselorThinking } from "@/lib/use-counselor-model";
import { Icon, ICON, Spinner } from "../ui";

const TABS = ["overview", "colleges", "roadmap", "strategy", "projects"] as const;
type PlanTab = (typeof TABS)[number];

const TAB_LABEL: Record<PlanTab, string> = {
  overview: "Overview",
  colleges: "Colleges",
  roadmap: "Roadmap",
  strategy: "Strategy",
  projects: "Projects",
};

const STRATEGY_LABEL: Record<StrategyArea, string> = {
  courses: "Courses",
  rigor: "Rigor",
  testing: "Testing",
  activities: "Activities",
  leadership: "Leadership",
  summer: "Summer",
  opportunities: "Opportunities",
  community: "Community impact",
};

export default function PlanView() {
  const counselor = useCounselor();
  const [model] = useCounselorModel();
  const [thinking] = useCounselorThinking();
  const [tab, setTab] = useState<PlanTab>("overview");
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plan = counselor.masterPlan;
  const stale = Boolean(plan && plan.generator.dataFingerprint !== planFingerprint(counselor));
  const pendingProposals = counselor.planProposals.filter((proposal) => proposal.status === "pending");

  async function buildPlan() {
    if (building) return;
    setBuilding(true);
    setError(null);
    try {
      const response = await fetch("/api/counselor/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          thinking,
          state: {
            schemaVersion: 2,
            profile: counselor.profile,
            memories: counselor.memories,
            tasks: counselor.tasks,
            meetings: counselor.meetings,
            applications: counselor.applications,
            list: counselor.list,
            coursework: counselor.coursework,
            testing: counselor.testing,
            awards: counselor.awards,
            essays: counselor.essays,
            threads: [],
            masterPlan: counselor.masterPlan,
            planProposals: counselor.planProposals,
            planRevisions: [],
          },
        }),
      });
      const result = await response.json() as { plan?: MasterPlan; error?: string };
      if (!response.ok || !result.plan) throw new Error(result.error ?? "The plan could not be built.");
      counselor.setMasterPlan(result.plan);
      setTab("overview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The plan could not be built.");
    } finally {
      setBuilding(false);
    }
  }

  return (
    <div className="master-plan-page">
      <header className="master-plan-header">
        <div>
          <p className="master-plan-eyebrow">Strategic college plan</p>
          <div className="master-plan-title-row">
            <h1>{counselor.profile.name ? `${counselor.profile.name.split(" ")[0]}'s plan` : "Your plan"}</h1>
            {plan && <span className="master-plan-version">v{plan.version}</span>}
            {stale && <span className="master-plan-status">Profile changed</span>}
          </div>
          <p className="master-plan-subtitle">
            {plan ? `Built from ${plan.generator.basis}.` : "A grade-aware roadmap built from your full Slates record."}
          </p>
        </div>
        <div className="master-plan-actions">
          {plan && counselor.planRevisions.length > 0 && (
            <button type="button" className="btn btn--quiet" onClick={counselor.undoPlan}>Undo last plan change</button>
          )}
          <button type="button" className="btn master-plan-build" onClick={() => void buildPlan()} disabled={building || !profileReady(counselor.profile)}>
            {building ? <><Spinner size={12} /> Building plan</> : plan ? "Refresh plan" : "Build my plan"}
          </button>
        </div>
      </header>

      {plan && (
        <nav className="master-plan-tabs" aria-label="Plan sections">
          {TABS.map((item) => (
            <button key={item} type="button" aria-current={tab === item ? "page" : undefined} onClick={() => setTab(item)}>
              {TAB_LABEL[item]}
            </button>
          ))}
        </nav>
      )}

      <main className="master-plan-body">
        {error && <div className="counselor-error">{error}</div>}
        {building && <PlanBuilding />}
        {!building && !plan && <PlanEmpty ready={profileReady(counselor.profile)} onBuild={() => void buildPlan()} />}
        {!building && plan && (
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
            {pendingProposals.length > 0 && tab === "overview" && (
              <ProposalList proposals={pendingProposals} version={plan.version} onResolve={counselor.resolvePlanProposal} />
            )}
            {tab === "overview" && <PlanOverview plan={plan} counselor={counselor} />}
            {tab === "colleges" && <PlanColleges plan={plan} />}
            {tab === "roadmap" && <PlanRoadmap plan={plan} />}
            {tab === "strategy" && <PlanStrategy plan={plan} />}
            {tab === "projects" && <PlanProjects plan={plan} onSelect={(projectId) => counselor.applyPlanChange({ type: "select-project", projectId }, "Changed selected project")} />}
          </motion.div>
        )}
      </main>
    </div>
  );
}

function PlanBuilding() {
  return (
    <section className="master-plan-building" aria-live="polite">
      <Spinner size={15} />
      <div><strong>Building the plan from your record</strong><span>The counselor is evaluating timing, positioning, colleges, and next steps.</span></div>
    </section>
  );
}

function PlanEmpty({ ready, onBuild }: { ready: boolean; onBuild: () => void }) {
  return (
    <section className="master-plan-empty">
      <span className="master-plan-index">01</span>
      <h2>{ready ? "Turn your record into a strategy." : "Complete the core profile first."}</h2>
      <p>{ready ? "The plan separates long-term strategy from the work you need to do now, then keeps both connected." : "Add your name and GPA in settings so the first plan has enough evidence to be useful."}</p>
      <div className="master-plan-empty-grid">
        <span>Positioning</span><span>College balance</span><span>Year-by-year roadmap</span><span>Activity strategy</span><span>Project direction</span>
      </div>
      <button type="button" className="btn master-plan-build" disabled={!ready} onClick={onBuild}>Build my plan</button>
    </section>
  );
}

function PlanOverview({ plan, counselor }: { plan: MasterPlan; counselor: ReturnType<typeof useCounselor> }) {
  return (
    <div className="master-plan-stack">
      <PlanSection number="01" title="Student profile"><p className="master-plan-lede">{plan.evaluation.profileSummary}</p></PlanSection>
      <PlanSection number="02" title="Where you stand">
        <div className="master-plan-positions">
          <Position label="Academic position" position={plan.evaluation.academic} />
          <Position label="Extracurricular position" position={plan.evaluation.extracurricular} />
        </div>
      </PlanSection>
      <PlanSection number="03" title="Advantages and risks">
        <div className="master-plan-columns">
          <BulletList title="Strongest advantages" items={plan.evaluation.advantages} />
          <BulletList title="Gaps and risks" items={plan.evaluation.risks} tone="warn" />
        </div>
      </PlanSection>
      <PlanSection number="04" title="Admissions narrative">
        <div className="master-plan-narratives">
          {plan.evaluation.narrativeThemes.map((theme) => (
            <article key={theme.id}><h3>{theme.title}</h3><p>{theme.direction}</p><small>{theme.evidence.join(" · ")}</small></article>
          ))}
        </div>
      </PlanSection>
      <PlanSection number="05" title="Current priorities">
        <div className="master-plan-next-steps">
          {plan.nextSteps.map((step) => {
            const linked = Boolean(step.taskId || counselor.tasks.some((task) => task.planItemId === step.id));
            return (
              <article key={step.id}>
                <div><span>{step.category.replaceAll("-", " ")}</span><h3>{step.title}</h3>{step.detail && <p>{step.detail}</p>}</div>
                <div className="master-plan-next-action">{step.targetDate && <time>{step.targetDate}</time>}<button type="button" className="btn btn--quiet" disabled={linked} onClick={() => counselor.createTaskFromPlanStep(step.id)}>{linked ? "In tasks" : "Add to tasks"}</button></div>
              </article>
            );
          })}
        </div>
      </PlanSection>
    </div>
  );
}

function PlanColleges({ plan }: { plan: MasterPlan }) {
  return <div className="master-plan-stack">{(["reach", "target", "likely"] as const).map((category, index) => {
    const colleges = plan.colleges.filter((college) => college.category === category);
    return <PlanSection key={category} number={`0${index + 1}`} title={`${category[0].toUpperCase()}${category.slice(1)} schools`}><div className="master-plan-colleges">{colleges.length ? colleges.sort((a, b) => b.priority - a.priority).map((college) => <article key={college.id}><header><h3>{college.name}</h3><span>Priority {college.priority}/5</span></header><p>{college.fit}</p><dl><div><dt>Watch</dt><dd>{college.weakness}</dd></div><div><dt>Next</dt><dd>{college.nextAction}</dd></div></dl></article>) : <p className="master-plan-muted">No schools in this category yet.</p>}</div></PlanSection>;
  })}</div>;
}

function PlanRoadmap({ plan }: { plan: MasterPlan }) {
  return <div className="master-plan-stack"><PlanSection number="01" title="Year-by-year plan"><PeriodList periods={plan.roadmap.years} /></PlanSection><PlanSection number="02" title="Term-by-term actions"><PeriodList periods={plan.roadmap.terms} /></PlanSection></div>;
}

function PeriodList({ periods }: { periods: MasterPlan["roadmap"]["years"] }) {
  return <div className="master-plan-timeline">{periods.map((period) => <article key={period.id}><div className="master-plan-period"><h3>{period.label}</h3>{period.focus && <p>{period.focus}</p>}</div><div className="master-plan-milestones">{period.milestones.map((milestone) => <div key={milestone.id}><span className={`master-plan-dot is-${milestone.status}`} /><div><strong>{milestone.title}</strong>{milestone.detail !== milestone.title && <p>{milestone.detail}</p>}</div></div>)}</div></article>)}</div>;
}

function PlanStrategy({ plan }: { plan: MasterPlan }) {
  return <div className="master-plan-stack">{STRATEGY_AREAS.map((area, index) => <PlanSection key={area} number={String(index + 1).padStart(2, "0")} title={STRATEGY_LABEL[area]}><RecommendationList rows={plan.strategy[area]} /></PlanSection>)}</div>;
}

function RecommendationList({ rows }: { rows: PlanRecommendation[] }) {
  return <div className="master-plan-recommendations">{rows.map((row) => <article key={row.id}><h3>{row.title}</h3><p>{row.why}</p><dl><div><dt>Impact</dt><dd>{row.impact}</dd></div><div><dt>Next action</dt><dd>{row.nextAction}</dd></div><div><dt>Timing</dt><dd>{row.timeframe}</dd></div><div><dt>Measure</dt><dd>{row.measure}</dd></div></dl></article>)}</div>;
}

function PlanProjects({ plan, onSelect }: { plan: MasterPlan; onSelect: (id: string | null) => void }) {
  return <div className="master-plan-stack"><PlanSection number="01" title="Passion-project direction"><div className="master-plan-projects">{plan.projects.ideas.map((project) => { const selected = project.id === plan.projects.selectedProjectId; return <button key={project.id} type="button" aria-pressed={selected} onClick={() => onSelect(selected ? null : project.id)}><span>{selected ? "Selected" : "Choose project"}</span><h3>{project.title}</h3><p>{project.concept}</p><dl><div><dt>Why it fits</dt><dd>{project.whyItFits}</dd></div><div><dt>First step</dt><dd>{project.firstStep}</dd></div><div><dt>Evidence</dt><dd>{project.evidenceOfImpact}</dd></div></dl></button>; })}</div></PlanSection><PlanSection number="02" title="Essay positioning"><BulletList title="Themes to carry forward" items={plan.projects.essayPositioning} /></PlanSection>{plan.missingInfo.length > 0 && <PlanSection number="03" title="Information still needed"><BulletList title="Resolve these before the next refresh" items={plan.missingInfo} tone="warn" /></PlanSection>}</div>;
}

function ProposalList({ proposals, version, onResolve }: { proposals: ReturnType<typeof useCounselor>["planProposals"]; version: number; onResolve: (id: string, approve: boolean) => void }) {
  return <section className="master-plan-proposals"><header><span className="master-plan-index">Review</span><h2>Plan changes awaiting your decision</h2></header>{proposals.map((proposal) => <article key={proposal.id}><div><h3>{proposal.summary}</h3><p>{proposal.reason}</p><small>{proposal.evidence}</small>{proposal.baseVersion !== version && <span className="master-plan-conflict">Plan changed since this was proposed</span>}</div><div><button type="button" className="btn btn--quiet" onClick={() => onResolve(proposal.id, false)}>Reject</button><button type="button" className="btn master-plan-build" disabled={proposal.baseVersion !== version} onClick={() => onResolve(proposal.id, true)}>Approve</button></div></article>)}</section>;
}

function PlanSection({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return <section className="master-plan-section"><header><span className="master-plan-index">{number}</span><h2>{title}</h2></header><div className="master-plan-section-body">{children}</div></section>;
}

function Position({ label, position }: { label: string; position: MasterPlan["evaluation"]["academic"] }) {
  return <article><span>{label}</span><strong>{position.rating}</strong><p>{position.summary}</p><ul>{position.evidence.map((evidence) => <li key={evidence}>{evidence}</li>)}</ul></article>;
}

function BulletList({ title, items, tone }: { title: string; items: string[]; tone?: "warn" }) {
  return <div className={`master-plan-bullets${tone ? ` is-${tone}` : ""}`}><h3>{title}</h3><ul>{items.map((item) => <li key={item}><Icon path={ICON.check} size={11} /><span>{item}</span></li>)}</ul></div>;
}
