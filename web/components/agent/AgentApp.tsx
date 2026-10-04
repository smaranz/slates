"use client";

import { useEffect, useMemo, useState } from "react";

import { useMode } from "@/lib/mode";
import { Icon, ICON, Spinner } from "../ui";
import Chat, { Face } from "./Chat";
import Computer from "./Computer";
import AgentDrawer from "./Drawer";
import FilesPanel from "./FilesPanel";
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
const DRAWER_KEY = "slates.agent.drawer";
const PHONE = "(max-width: 760px)";

type Panel = "details" | "computer" | "files" | null;
type Dialog = "agent" | "group" | "skills" | null;

/**
 * Whether the agents drawer starts open. Docked on a laptop, as the student
 * left it. A sheet over the chat on a phone, open only when there's no chat
 * to go back to, since there the list is where you start.
 */
function initialDrawer(): boolean {
  if (typeof window === "undefined") return true;
  try {
    if (window.matchMedia(PHONE).matches) return !window.localStorage.getItem(OPEN_KEY);
    return window.localStorage.getItem(DRAWER_KEY) !== "closed";
  } catch {
    return true;
  }
}

export default function AgentApp() {
  const { clear, openSettings } = useMode();
  const [open, setOpen] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [talk, setTalk] = useState(false);
  const [drawer, setDrawer] = useState(initialDrawer);
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

  // Every agent has a browser of its own. The Computer shows the open chat's
  // (a group's first member's) until you pick another, for as long as that chat stays open.
  const [pickedBrowser, setPickedBrowser] = useState<{ chat: string | null; id: string } | null>(null);
  const browsers = useMemo(() => [...agents.map((a) => ({ id: a.id, name: a.name })), { id: "", name: "Tutor & Study" }], [agents]);
  const chatBrowser = current?.id ?? group?.members.find((id) => agents.some((a) => a.id === id)) ?? "";
  const browser = pickedBrowser?.chat === open && browsers.some((b) => b.id === pickedBrowser.id) ? pickedBrowser.id : chatBrowser;

  useEffect(() => {
    if (!roster || current || group) return;
    // A remembered chat that's gone falls back to the first agent; on a phone the list itself is the start.
    if (!open && window.matchMedia("(max-width: 760px)").matches) return;
    const fallback = window.setTimeout(() => setOpen(roster.agents[0]?.id ?? null), 0);
    return () => window.clearTimeout(fallback);
  }, [roster, open, current, group]);

  const setDrawerOpen = (next: boolean) => {
    setDrawer(next);
    try {
      if (!window.matchMedia(PHONE).matches) window.localStorage.setItem(DRAWER_KEY, next ? "open" : "closed");
    } catch {}
  };

  const openChat = (id: string | null) => {
    setOpen(id);
    if (id) live.markRead(id);
    // On a phone the drawer covers the chat, so picking one gets out of its way.
    if (id && window.matchMedia(PHONE).matches) setDrawer(false);
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
          <button type="button" className={`ui-back ${panel === "files" ? s.headerOn : ""}`} onClick={() => setPanel(panel === "files" ? null : "files")} aria-pressed={panel === "files"} aria-label="Files">
            <Icon path={ICON.folder} size={13} /> <span className={s.headerLabel}>Files</span>
          </button>
          <button type="button" className="ui-back" onClick={() => setDialog("skills")} aria-label="Skills">
            <Icon path={ICON.checklist} size={13} /> <span className={s.headerLabel}>Skills</span>
          </button>
          <button type="button" className="ui-back" onClick={openSettings} aria-label="Settings">
            <Icon path={ICON.settings} size={13} />
          </button>
        </header>

        {/* The tutor's ChatGPT layout: the agents in its drawer, the one you're
            talking to in its header, the chat in its thread and composer. */}
        <div className={`gpt ${s.gpt}`} data-drawer={drawer ? "open" : "closed"}>
          <div className="gpt-scrim" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
          <AgentDrawer
            agents={agents}
            groups={groups}
            open={open}
            unread={live.unread}
            onOpen={openChat}
            onClose={() => setDrawerOpen(false)}
            onNewAgent={() => setDialog("agent")}
            onNewGroup={agents.length >= 2 ? () => setDialog("group") : undefined}
          />

          <div className="gpt-main">
            <header className="gpt-header">
              <button type="button" className="gpt-icon-btn" onClick={() => setDrawerOpen(!drawer)} aria-label={drawer ? "Hide agents" : "Show agents"} aria-expanded={drawer}>
                <Icon path={ICON.sidebar} size={19} />
              </button>
              {/* Where the tutor names its model: who you're talking to, which opens their details. */}
              {roster && (current || group) && (
                <button type="button" className={s.who} onClick={() => setPanel(panel === "details" ? null : "details")} aria-expanded={panel === "details"} aria-label={`${current?.name ?? group!.name}: details`}>
                  {current ? <Face agent={current} size={24} /> : (
                    <span className={s.groupFaces}>{group!.members.slice(0, 3).map((id) => { const m = agents.find((a) => a.id === id); return m ? <Face key={id} agent={m} size={18} /> : null; })}</span>
                  )}
                  <span className={s.whoText}>
                    <strong>{current?.name ?? group!.name}</strong>
                    <span>{current ? `${roster.models.find((m) => m.id === current.model)?.label ?? current.model}${current.job ? ` · ${current.job}` : ""}` : `${group!.members.length} agents`}</span>
                  </span>
                  <Icon path={ICON.chevronDown} size={12} />
                </button>
              )}
              <span className="gpt-header-gap" />
              <button type="button" className="gpt-icon-btn" onClick={() => setDialog("agent")} aria-label="New agent" title="New agent">
                <Icon path={ICON.compose} size={19} />
              </button>
            </header>

            {roster && (current || group) ? (
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
            ) : (
              <div className="gpt-thread">
                <div className="gpt-column gpt-column--empty">
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
                  ) : (
                    <div className={s.center}><p className={s.muted}>Pick an agent.</p></div>
                  )}
                </div>
              </div>
            )}
          </div>

          {panel === "computer" && (
            <Computer onClose={() => setPanel(null)} browser={browser} browsers={browsers} onBrowser={(id) => setPickedBrowser({ chat: open, id })} />
          )}
          {panel === "files" && <FilesPanel onClose={() => setPanel(null)} onEvent={live.onEvent} />}
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
