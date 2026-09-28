"use client";

import { useEffect, useMemo, useState } from "react";

import { useMode } from "@/lib/mode";
import { Icon, ICON, Spinner } from "../ui";
import Chat, { Face } from "./Chat";
import Computer from "./Computer";
import { AgentDetails, GroupDetails, NewAgent, NewGroup, Skills, TEMPLATES } from "./Panels";
import s from "./agent.module.css";
import { agentApi, useAgentLive } from "./useAgentData";

/**
 * Agent: AI teammates that live on the host.
 *
 * Each one has a name, a job, standing rules, memory and routines, and works
 * on the always-on PC with full access to it — shell, files, a real browser —
 * plus the student's Schoology. Every window (Mac, phone) is a view onto the
 * same agents; the work happens on the host and keeps going when they close.
 */

const MONITOR = "M3 4h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7v2h3v2H7v-2h3v-2H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 2v9h16V6H4z";
const OPEN_KEY = "slates.agent.open";
const TALK_KEY = "slates.agent.talk";

type Panel = "details" | "computer" | null;
type Dialog = "agent" | "group" | "skills" | null;

export default function AgentApp() {
  const { clear, openSettings } = useMode();
  const [open, setOpen] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [talk, setTalk] = useState(false);
  const live = useAgentLive(open);
  const { roster } = live;

  useEffect(() => {
    if (navigator.userAgent.includes("Electron")) document.documentElement.dataset.desktop = "1";
    const saved = window.localStorage.getItem(OPEN_KEY);
    const initial = window.setTimeout(() => {
      if (saved) setOpen(saved);
      setTalk(window.localStorage.getItem(TALK_KEY) === "1");
    }, 0);
    return () => window.clearTimeout(initial);
  }, []);

  useEffect(() => {
    if (open) window.localStorage.setItem(OPEN_KEY, open);
  }, [open]);

  const agents = useMemo(() => roster?.agents ?? [], [roster]);
  const groups = useMemo(() => roster?.groups ?? [], [roster]);
  const current = agents.find((a) => a.id === open) ?? null;
  const group = groups.find((g) => g.id === open) ?? null;

  useEffect(() => {
    if (!roster || current || group) return;
    // A remembered chat that's gone falls back to the first agent; on a phone the list itself is the start.
    if (!open && window.matchMedia("(max-width: 760px)").matches) return;
    const fallback = window.setTimeout(() => setOpen(roster.agents[0]?.id ?? null), 0);
    return () => window.clearTimeout(fallback);
  }, [roster, open, current, group]);

  const openChat = (id: string | null) => {
    setOpen(id);
    if (id) live.markRead(id);
  };

  const setTalkMode = (on: boolean) => {
    setTalk(on);
    window.localStorage.setItem(TALK_KEY, on ? "1" : "0");
  };

  const quickCreate = async (template: (typeof TEMPLATES)[number]) => {
    const { agent } = await agentApi<{ agent: { id: string } }>("/api/agent", { op: "create-agent", ...template });
    await live.refresh();
    openChat(agent.id);
  };

  const working = agents.filter((a) => a.state === "working").length;

  return (
    <div className="shell ui-mode">
      <div className="main">
        <header className="ui-top">
          <button type="button" className="ui-back" onClick={clear} aria-label="Back to Slates">
            <Icon path={ICON.chevronLeft} size={13} /> Slates
          </button>
          <span className="ui-top-title">Agent</span>
          <span className="ui-top-sub">
            {!live.connected ? "Connecting…" : working ? `${working} working on the PC` : "Teammates that work on your PC"}
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" className={`ui-back ${panel === "computer" ? s.headerOn : ""}`} onClick={() => setPanel(panel === "computer" ? null : "computer")} aria-pressed={panel === "computer"} aria-label="Computer">
            <Icon path={MONITOR} size={13} /> <span className={s.headerLabel}>Computer</span>
          </button>
          <button type="button" className="ui-back" onClick={() => setDialog("skills")} aria-label="Skills">
            <Icon path={ICON.checklist} size={13} /> <span className={s.headerLabel}>Skills</span>
          </button>
          <button type="button" className="ui-back" onClick={openSettings} aria-label="Settings">
            <Icon path={ICON.settings} size={13} />
          </button>
        </header>

        <div className={`${s.shell} ${open ? s.hasOpen : ""}`}>
          <nav className={s.side} aria-label="Agents">
            <div className={s.sideScroll}>
              <div className={s.sideLabel}>Agents</div>
              {agents.map((a) => (
                <button key={a.id} type="button" className={`${s.item} ${open === a.id ? s.itemOn : ""}`} onClick={() => openChat(a.id)}>
                  <Face agent={a} size={30} />
                  <span className={s.itemText}>
                    <strong>{a.name}</strong>
                    <span>{a.state === "working" ? "Working…" : a.state === "queued" ? "Up next" : a.job || "Agent"}</span>
                  </span>
                  {live.unread.has(a.id) && <i className={s.dot} aria-label="New activity" />}
                </button>
              ))}
              {groups.length > 0 && <div className={s.sideLabel}>Groups</div>}
              {groups.map((g) => (
                <button key={g.id} type="button" className={`${s.item} ${open === g.id ? s.itemOn : ""}`} onClick={() => openChat(g.id)}>
                  <span className={s.groupFaces}>
                    {g.members.slice(0, 3).map((id) => {
                      const m = agents.find((a) => a.id === id);
                      return m ? <Face key={id} agent={m} size={18} /> : null;
                    })}
                  </span>
                  <span className={s.itemText}>
                    <strong>{g.name}</strong>
                    <span>{g.members.map((id) => agents.find((a) => a.id === id)?.name).filter(Boolean).join(", ")}</span>
                  </span>
                  {live.unread.has(g.id) && <i className={s.dot} aria-label="New activity" />}
                </button>
              ))}
            </div>
            <div className={s.sideFoot}>
              <button type="button" className={s.newButton} onClick={() => setDialog("agent")}><Icon path={ICON.plus} size={12} /> New agent</button>
              {agents.length >= 2 && <button type="button" className={s.newButtonQuiet} onClick={() => setDialog("group")}>New group</button>}
            </div>
          </nav>

          <section className={s.stage}>
            {!roster ? (
              <div className={s.center}>{live.error ? <p className={s.bad}>{live.error}</p> : <Spinner size={18} />}</div>
            ) : !agents.length ? (
              <div className={s.welcome}>
                <h1>Your AI teammates</h1>
                <p>Agents work on your PC with full access to it: files, a terminal, a real browser, and your Schoology. They keep memory, run on schedules, and keep going when your laptop is closed.</p>
                <div className={s.templates}>
                  {TEMPLATES.map((t) => (
                    <button key={t.name} type="button" className={s.template} onClick={() => void quickCreate(t)}>
                      <strong>{t.name}</strong>
                      <span>{t.job}</span>
                    </button>
                  ))}
                </div>
                <button type="button" className={s.quiet} onClick={() => setDialog("agent")}>Or make your own</button>
              </div>
            ) : current || group ? (
              <>
                <div className={s.chatHead}>
                  <button type="button" className={`${s.iconButton} ${s.mobileBack}`} aria-label="All agents" onClick={() => setOpen(null)}><Icon path={ICON.chevronLeft} size={14} /></button>
                  {current ? <Face agent={current} size={30} /> : (
                    <span className={s.groupFaces}>{group!.members.slice(0, 3).map((id) => { const m = agents.find((a) => a.id === id); return m ? <Face key={id} agent={m} size={20} /> : null; })}</span>
                  )}
                  <div className={s.chatTitle}>
                    <strong>{current?.name ?? group!.name}</strong>
                    <span>{current ? `${roster.models.find((m) => m.id === current.model)?.label ?? current.model}${current.job ? ` · ${current.job}` : ""}` : `${group!.members.length} agents`}</span>
                  </div>
                  <button type="button" className={`${s.iconButton} ${panel === "details" ? s.headerOn : ""}`} aria-label="Details" aria-pressed={panel === "details"} onClick={() => setPanel(panel === "details" ? null : "details")}>
                    <Icon path={ICON.sidebar} size={15} />
                  </button>
                </div>
                <Chat
                  key={open!}
                  chatId={open!}
                  events={live.events}
                  loading={live.loadingChat}
                  agents={agents}
                  group={group}
                  skills={roster.skills}
                  talk={talk}
                  onTalk={setTalkMode}
                />
              </>
            ) : (
              <div className={s.center}><p className={s.muted}>Pick an agent.</p></div>
            )}
          </section>

          {panel === "computer" && <Computer onClose={() => setPanel(null)} />}
          {panel === "details" && roster && current && (
            <AgentDetails key={current.id} agent={current} roster={roster} onClose={() => setPanel(null)} onDeleted={() => { setPanel(null); setOpen(null); }} />
          )}
          {panel === "details" && roster && group && (
            <GroupDetails key={group.id} group={group} agents={agents} onClose={() => setPanel(null)} onDeleted={() => { setPanel(null); setOpen(null); }} />
          )}
        </div>
      </div>

      {dialog === "agent" && roster && (
        <NewAgent models={roster.models} onClose={() => setDialog(null)} onCreated={(id) => { setDialog(null); void live.refresh().then(() => openChat(id)); }} />
      )}
      {dialog === "group" && (
        <NewGroup agents={agents} onClose={() => setDialog(null)} onCreated={(id) => { setDialog(null); void live.refresh().then(() => openChat(id)); }} />
      )}
      {dialog === "skills" && roster && <Skills skills={roster.skills} onClose={() => setDialog(null)} />}
    </div>
  );
}
