"use client";

import { useState } from "react";

import type { AgentGroup, RosterAgent } from "@/lib/agent/types";
import { Icon, ICON } from "../ui";
import { Face } from "./Chat";
import s from "./agent.module.css";

/**
 * The agents, as the tutor's conversation drawer: a docked column on a laptop
 * and a sheet over the chat on a phone, from the same `gpt-*` markup and CSS,
 * so the two chat screens can't drift apart.
 */
export default function AgentDrawer({
  agents,
  groups,
  open,
  unread,
  onOpen,
  onClose,
  onNewAgent,
  onNewGroup,
}: {
  agents: RosterAgent[];
  groups: AgentGroup[];
  open: string | null;
  unread: ReadonlySet<string>;
  onOpen: (id: string) => void;
  onClose: () => void;
  onNewAgent: () => void;
  onNewGroup?: () => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const byId = new Map(agents.map((a) => [a.id, a]));
  const shownAgents = needle ? agents.filter((a) => `${a.name} ${a.job}`.toLowerCase().includes(needle)) : agents;
  const shownGroups = needle ? groups.filter((g) => g.name.toLowerCase().includes(needle)) : groups;

  return (
    <aside className="gpt-drawer" aria-label="Agents">
      <div className="gpt-drawer-head">
        <button type="button" className="gpt-icon-btn" onClick={onClose} aria-label="Hide agents">
          <Icon path={ICON.sidebar} size={19} />
        </button>
        <span className="gpt-header-gap" />
        <button type="button" className="gpt-icon-btn" onClick={onNewAgent} aria-label="New agent" title="New agent">
          <Icon path={ICON.compose} size={19} />
        </button>
      </div>

      <div className="gpt-search">
        <Icon path={ICON.magnifier} size={15} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search agents" aria-label="Search agents" className="bare-field" />
      </div>

      <button type="button" className="gpt-drawer-new" onClick={onNewAgent}>
        <span className="gpt-drawer-new-icon"><Icon path={ICON.plus} size={15} /></span>
        New agent
      </button>
      {onNewGroup && (
        <button type="button" className="gpt-drawer-new" onClick={onNewGroup}>
          <span className="gpt-drawer-new-icon"><Icon path={ICON.plus} size={15} /></span>
          New group
        </button>
      )}

      <div className="gpt-drawer-list">
        {agents.length === 0 && <p className="gpt-drawer-empty">No agents yet. Make one, or start from one of the teammates on the right.</p>}
        {needle && shownAgents.length === 0 && shownGroups.length === 0 && <p className="gpt-drawer-empty">Nothing matches “{query.trim()}”.</p>}

        {shownAgents.length > 0 && (
          <div className="gpt-drawer-group">
            <div className="gpt-drawer-band">Agents</div>
            {shownAgents.map((agent) => (
              <Row
                key={agent.id}
                active={agent.id === open}
                unread={unread.has(agent.id)}
                onOpen={() => onOpen(agent.id)}
                face={<Face agent={agent} size={26} />}
                title={agent.name}
                sub={agent.state === "working" ? "Working…" : agent.state === "queued" ? "Up next" : agent.job || "Agent"}
              />
            ))}
          </div>
        )}

        {shownGroups.length > 0 && (
          <div className="gpt-drawer-group">
            <div className="gpt-drawer-band">Groups</div>
            {shownGroups.map((group) => (
              <Row
                key={group.id}
                active={group.id === open}
                unread={unread.has(group.id)}
                onOpen={() => onOpen(group.id)}
                face={
                  <span className={s.groupFaces}>
                    {group.members.slice(0, 3).map((id) => {
                      const member = byId.get(id);
                      return member ? <Face key={id} agent={member} size={18} /> : null;
                    })}
                  </span>
                }
                title={group.name}
                sub={group.members.map((id) => byId.get(id)?.name).filter(Boolean).join(", ")}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function Row({ active, unread, onOpen, face, title, sub }: { active: boolean; unread: boolean; onOpen: () => void; face: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="gpt-drawer-row" data-active={active ? "1" : undefined}>
      <button type="button" className={`gpt-drawer-open ${s.drawerItem}`} onClick={onOpen} aria-current={active ? "page" : undefined}>
        {face}
        <span className={s.drawerText}>
          <span className="truncate">{title}</span>
          <span className="gpt-drawer-when">{sub}</span>
        </span>
        {unread && <i className={s.dot} aria-label="New activity" />}
      </button>
    </div>
  );
}
