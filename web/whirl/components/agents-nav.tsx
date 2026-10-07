"use client";

import { IconPlus } from "@tabler/icons-react";

import { setNewChatTarget, useRoster, type ChatTarget } from "@whirl/lib/agents";
import { useView } from "@whirl/lib/view";
import { AgentFace } from "./agent-face";
import { SidebarRow } from "./sidebar-row";

/* The team, under New and Search: every agent and group, with who's busy.
   Picking one starts a fresh chat with them — the composer on home takes
   them as its "talking to". The + opens Settings › Agents. */
export function AgentsNav() {
  const roster = useRoster();
  const { openHome, openSettings } = useView();

  if (!roster) return null;

  const start = (target: ChatTarget) => {
    setNewChatTarget(target);
    openHome();
  };

  return (
    <div className="flex flex-col gap-0.5">
      <div className="sidebar-glide flex h-6 items-center justify-between px-2.5 transition-[opacity] sidebar-collapsed:opacity-0">
        <span className="text-[11.5px] font-medium text-muted-foreground">Agents</span>
        <button
          type="button"
          onClick={() => openSettings("agents")}
          aria-label="Manage agents"
          className="-mr-1 flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <IconPlus size={13} stroke={2.4} />
        </button>
      </div>
      {roster.agents.length === 0 && (
        <SidebarRow
          icon={IconPlus}
          label="Make your first agent"
          onClick={() => openSettings("agents")}
          className="before:-top-px before:-bottom-px"
        />
      )}
      {roster.agents.map((agent) => (
        <SidebarRow
          key={agent.id}
          iconNode={<AgentFace name={agent.name} hue={agent.hue} working={agent.state === "working"} size={18} />}
          label={agent.name}
          title={agent.job || undefined}
          trailing={agent.state === "working" ? "working" : agent.state === "queued" ? `${agent.queued} queued` : undefined}
          onClick={() => start({ kind: "agent", id: agent.id })}
          className="before:-top-px before:-bottom-px"
        />
      ))}
      {roster.groups.map((group) => (
        <SidebarRow
          key={group.id}
          iconNode={<AgentFace name={group.name} group size={18} />}
          label={group.name}
          onClick={() => start({ kind: "group", id: group.id })}
          className="before:-top-px before:-bottom-px"
        />
      ))}
    </div>
  );
}
