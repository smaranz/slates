"use client";

import { useEffect, useState } from "react";

import { describeSchedule } from "@/lib/agent/schedule";
import type { AgentGroup, ModelChoice, Roster, RosterAgent, Skill } from "@/lib/agent/types";
import { DEFAULT_MODEL } from "@/lib/agent/types";
import { Icon, ICON, Spinner, Toggle } from "../ui";
import { Face } from "./Chat";
import s from "./agent.module.css";
import { agentApi } from "./useAgentData";

/** Dialogs and the details panel for the Agent app. */

export const TEMPLATES = [
  { name: "Planner", job: "Plans my week around what's due in Schoology", rules: "Check my Schoology board before planning. Build plans around due dates and grades, hardest work first. Keep nights realistic: no more than three hours of homework." },
  { name: "Researcher", job: "Researches anything and cites sources", rules: "Search the web and link every claim to its source. Separate facts from opinions. Save long reports as files in the workspace and summarize them in chat." },
  { name: "Inbox", job: "Keeps up with Schoology messages and drafts replies", rules: "Summarize new messages from teachers, most important first. Draft replies in my voice. Never send anything without my approval." },
  { name: "Builder", job: "Builds and runs things on the PC", rules: "Work inside the workspace folder. Explain what you ran and why, and say how to undo anything big." },
];

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEscape(onClose);
  return (
    <div className={s.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={s.modal} role="dialog" aria-modal="true" aria-label={title}>
        <div className={s.modalHead}>
          <h2>{title}</h2>
          <button type="button" className={s.iconButton} aria-label="Close" onClick={onClose}><Icon path={ICON.close} size={14} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModelSelect({ models, value, onChange }: { models: ModelChoice[]; value: string; onChange: (id: string) => void }) {
  const list = models.some((m) => m.id === value) ? models : [{ id: value, label: value }, ...models];
  return (
    <select className={s.field} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Model">
      {list.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
    </select>
  );
}

export function NewAgent({ models, onClose, onCreated }: { models: ModelChoice[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [job, setJob] = useState("");
  const [rules, setRules] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { agent } = await agentApi<{ agent: { id: string } }>("/api/agent", { op: "create-agent", name, job, rules, model });
      onCreated(agent.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  return (
    <Modal title="New agent" onClose={onClose}>
      <div className={s.templates}>
        {TEMPLATES.map((t) => (
          <button key={t.name} type="button" className={s.template} onClick={() => { setName(t.name); setJob(t.job); setRules(t.rules); }}>
            <strong>{t.name}</strong>
            <span>{t.job}</span>
          </button>
        ))}
      </div>
      <label className={s.label}>Name<input className={s.field} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Planner" maxLength={40} autoFocus /></label>
      <label className={s.label}>Job<input className={s.field} value={job} onChange={(e) => setJob(e.target.value)} placeholder="One thing this agent owns" maxLength={200} /></label>
      <label className={s.label}>Rules<textarea className={s.field} value={rules} onChange={(e) => setRules(e.target.value)} placeholder="How it should always work, and what it must ask you about first" rows={4} /></label>
      <label className={s.label}>Model<ModelSelect models={models} value={model} onChange={setModel} /></label>
      {error && <p className={s.bad}>{error}</p>}
      <div className={s.modalActions}>
        <button type="button" className={s.quiet} onClick={onClose}>Cancel</button>
        <button type="button" className={s.primary} disabled={busy || !name.trim()} onClick={() => void create()}>{busy && <Spinner size={12} />} Create</button>
      </div>
    </Modal>
  );
}

export function NewGroup({ agents, onClose, onCreated }: { agents: RosterAgent[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    try {
      const { group } = await agentApi<{ group: { id: string } }>("/api/agent", { op: "create-group", name: name || "Group", members });
      onCreated(group.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <Modal title="New group" onClose={onClose}>
      <label className={s.label}>Name<input className={s.field} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Finals crew" autoFocus /></label>
      <div className={s.label}>Agents <span className={s.muted}>(2 to 6)</span></div>
      <div className={s.pickList}>
        {agents.map((a) => (
          <label key={a.id} className={s.pick}>
            <input type="checkbox" checked={members.includes(a.id)} onChange={(e) => setMembers((m) => e.target.checked ? [...m, a.id].slice(0, 6) : m.filter((x) => x !== a.id))} />
            <Face agent={a} size={22} />
            <span>{a.name}</span>
          </label>
        ))}
      </div>
      {error && <p className={s.bad}>{error}</p>}
      <div className={s.modalActions}>
        <button type="button" className={s.quiet} onClick={onClose}>Cancel</button>
        <button type="button" className={s.primary} disabled={members.length < 2} onClick={() => void create()}>Create</button>
      </div>
    </Modal>
  );
}

export function Skills({ skills, onClose }: { skills: Skill[]; onClose: () => void }) {
  const [editing, setEditing] = useState<Partial<Skill> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      await agentApi("/api/agent", { op: "save-skill", id: editing?.id, name: editing?.name, instructions: editing?.instructions });
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <Modal title="Skills" onClose={onClose}>
      {editing ? (
        <>
          <label className={s.label}>Name<input className={s.field} value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus /></label>
          <label className={s.label}>Instructions<textarea className={s.field} rows={10} value={editing.instructions ?? ""} onChange={(e) => setEditing({ ...editing, instructions: e.target.value })} placeholder="When to use it, the steps, how to check the result, what to return, and what needs your approval." /></label>
          {error && <p className={s.bad}>{error}</p>}
          <div className={s.modalActions}>
            {editing.id && <button type="button" className={s.danger} onClick={() => void agentApi("/api/agent", { op: "delete-skill", id: editing.id }).then(() => setEditing(null))}>Delete</button>}
            <span style={{ flex: 1 }} />
            <button type="button" className={s.quiet} onClick={() => setEditing(null)}>Back</button>
            <button type="button" className={s.primary} disabled={!editing.name?.trim() || !editing.instructions?.trim()} onClick={() => void save()}>Save</button>
          </div>
        </>
      ) : (
        <>
          <p className={s.muted}>Reusable instructions every agent can follow. Type / in a message to use one; agents can save new ones too.</p>
          <div className={s.skillList}>
            {skills.map((k) => (
              <button key={k.id} type="button" className={s.skillRow} onClick={() => setEditing(k)}>
                <strong>/{k.name}</strong>
                <span>{k.instructions.split("\n")[0]}</span>
              </button>
            ))}
            {!skills.length && <p className={s.muted}>No skills yet.</p>}
          </div>
          <div className={s.modalActions}>
            <button type="button" className={s.primary} onClick={() => setEditing({ name: "", instructions: "" })}><Icon path={ICON.plus} size={12} /> New skill</button>
          </div>
        </>
      )}
    </Modal>
  );
}

const WHEN = [
  { id: "daily", label: "Every day" },
  { id: "weekdays", label: "Weekdays" },
  { id: "weekends", label: "Weekends" },
  { id: "hourly", label: "Every hour" },
];

function RoutineForm({ agentId, onDone }: { agentId: string; onDone: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [when, setWhen] = useState("weekdays");
  const [time, setTime] = useState("07:00");
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    try {
      await agentApi("/api/agent", {
        op: "create-routine", agentId, prompt, name: prompt.split(/[.\n]/)[0]!.slice(0, 60),
        ...(when === "hourly" ? { everyMinutes: 60 } : { days: when, time }),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <div className={s.routineForm}>
      <textarea className={s.field} rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What should it do each time? e.g. Check what's due this week and post tonight's plan." autoFocus />
      <div className={s.row}>
        <select className={s.field} value={when} onChange={(e) => setWhen(e.target.value)} aria-label="When">
          {WHEN.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
        </select>
        {when !== "hourly" && <input className={s.field} type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" />}
      </div>
      {error && <p className={s.bad}>{error}</p>}
      <div className={s.row}>
        <button type="button" className={s.quiet} onClick={onDone}>Cancel</button>
        <button type="button" className={s.primary} disabled={!prompt.trim()} onClick={() => void create()}>Add routine</button>
      </div>
    </div>
  );
}

function Confirm({ label, confirm, onConfirm }: { label: string; confirm: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(timer);
  }, [armed]);
  return (
    <button type="button" className={armed ? s.dangerSolid : s.danger} onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {armed ? confirm : label}
    </button>
  );
}

export function AgentDetails({ agent, roster, onClose, onDeleted }: { agent: RosterAgent; roster: Roster; onClose: () => void; onDeleted: () => void }) {
  const [name, setName] = useState(agent.name);
  const [job, setJob] = useState(agent.job);
  const [rules, setRules] = useState(agent.rules);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (patch: Record<string, unknown>) =>
    agentApi("/api/agent", { op: "update-agent", id: agent.id, ...patch }).then(() => setError(null)).catch((err: Error) => setError(err.message));
  const dirty = name !== agent.name || job !== agent.job || rules !== agent.rules;
  const mine = roster.routines.filter((r) => r.agentId === agent.id);
  return (
    <aside className={s.panel} aria-label={`${agent.name} details`}>
      <div className={s.panelHead}>
        <h2>Details</h2>
        <button type="button" className={s.iconButton} aria-label="Close details" onClick={onClose}><Icon path={ICON.close} size={14} /></button>
      </div>
      <div className={s.panelBody}>
        <label className={s.label}>Name<input className={s.field} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></label>
        <label className={s.label}>Job<input className={s.field} value={job} onChange={(e) => setJob(e.target.value)} maxLength={200} /></label>
        <label className={s.label}>Rules<textarea className={s.field} rows={5} value={rules} onChange={(e) => setRules(e.target.value)} /></label>
        {dirty && (
          <div className={s.row}>
            <button type="button" className={s.quiet} onClick={() => { setName(agent.name); setJob(agent.job); setRules(agent.rules); }}>Revert</button>
            <button type="button" className={s.primary} onClick={() => void update({ name, job, rules })}>Save</button>
          </div>
        )}
        <label className={s.label}>Model<ModelSelect models={roster.models} value={agent.model} onChange={(model) => void update({ model })} /></label>
        <div className={s.toggleRow}>
          <span>Reply with voice memos</span>
          <Toggle on={agent.voiceReplies} label="Reply with voice memos" onClick={() => void update({ voiceReplies: !agent.voiceReplies })} />
        </div>

        <h3 className={s.section}>Memory</h3>
        {agent.memory.length ? (
          <ul className={s.memory}>
            {agent.memory.map((m) => (
              <li key={m.id}>
                <span>{m.text}</span>
                <button type="button" aria-label="Forget" onClick={() => void agentApi("/api/agent", { op: "forget", id: agent.id, memoryId: m.id })}><Icon path={ICON.close} size={10} /></button>
              </li>
            ))}
          </ul>
        ) : <p className={s.muted}>Nothing yet. Tell it what to remember, or it saves preferences as it learns them.</p>}

        <h3 className={s.section}>Routines</h3>
        {mine.map((r) => (
          <div key={r.id} className={s.routine}>
            <div className={s.routineTop}>
              <strong>{r.name}</strong>
              <Toggle on={r.enabled} label={r.enabled ? "Pause routine" : "Resume routine"} onClick={() => void agentApi("/api/agent", { op: "update-routine", id: r.id, enabled: !r.enabled })} />
            </div>
            <span className={s.muted}>{describeSchedule(r.schedule)}{r.enabled && r.nextRun ? ` · next ${new Date(r.nextRun).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}` : " · paused"}</span>
            {r.runs[0] && <span className={r.runs[0].ok ? s.muted : s.bad}>Last run {new Date(r.runs[0].at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}: {r.runs[0].note}</span>}
            <div className={s.row}>
              <button type="button" className={s.linkButton} onClick={() => void agentApi("/api/agent", { op: "run-routine", id: r.id })}>Run now</button>
              <button type="button" className={s.linkButton} onClick={() => void agentApi("/api/agent", { op: "delete-routine", id: r.id })}>Delete</button>
            </div>
          </div>
        ))}
        {adding ? <RoutineForm agentId={agent.id} onDone={() => setAdding(false)} /> : (
          <button type="button" className={s.quiet} onClick={() => setAdding(true)}><Icon path={ICON.plus} size={12} /> Add a routine</button>
        )}
        {!mine.length && !adding && <p className={s.muted}>Routines run on the PC on a schedule, even when your laptop is closed. You can also just ask the agent to set one up.</p>}

        {error && <p className={s.bad}>{error}</p>}
        <div className={s.dangerZone}>
          <Confirm label="Start fresh" confirm="Clear chat and context?" onConfirm={() => void agentApi("/api/agent", { op: "reset-agent", id: agent.id })} />
          <Confirm label="Delete agent" confirm={`Delete ${agent.name}?`} onConfirm={() => void agentApi("/api/agent", { op: "delete-agent", id: agent.id }).then(onDeleted)} />
        </div>
      </div>
    </aside>
  );
}

export function GroupDetails({ group, agents, onClose, onDeleted }: { group: AgentGroup; agents: RosterAgent[]; onClose: () => void; onDeleted: () => void }) {
  const [name, setName] = useState(group.name);
  const [error, setError] = useState<string | null>(null);
  const setMembers = (members: string[]) =>
    agentApi("/api/agent", { op: "update-group", id: group.id, members }).then(() => setError(null)).catch((err: Error) => setError(err.message));
  return (
    <aside className={s.panel} aria-label={`${group.name} details`}>
      <div className={s.panelHead}>
        <h2>Group</h2>
        <button type="button" className={s.iconButton} aria-label="Close details" onClick={onClose}><Icon path={ICON.close} size={14} /></button>
      </div>
      <div className={s.panelBody}>
        <label className={s.label}>Name<input className={s.field} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== group.name && void agentApi("/api/agent", { op: "update-group", id: group.id, name })} /></label>
        <div className={s.label}>Members</div>
        <div className={s.pickList}>
          {agents.map((a) => (
            <label key={a.id} className={s.pick}>
              <input type="checkbox" checked={group.members.includes(a.id)} onChange={(e) => void setMembers(e.target.checked ? [...group.members, a.id] : group.members.filter((m) => m !== a.id))} />
              <Face agent={a} size={22} />
              <span>{a.name}</span>
            </label>
          ))}
        </div>
        <p className={s.muted}>With no @mention, {agents.find((a) => a.id === group.members[0])?.name ?? "the first member"} answers and brings in others. @everyone asks them all.</p>
        {error && <p className={s.bad}>{error}</p>}
        <div className={s.dangerZone}>
          <Confirm label="Delete group" confirm={`Delete ${group.name}?`} onConfirm={() => void agentApi("/api/agent", { op: "delete-group", id: group.id }).then(onDeleted)} />
        </div>
      </div>
    </aside>
  );
}
