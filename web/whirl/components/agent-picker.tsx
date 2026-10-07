"use client";

import { IconCheck, IconSettings } from "@tabler/icons-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@whirl/components/ui/dropdown-menu";
import { resolveTarget, setNewChatTarget, useNewChatTarget, useRoster } from "@whirl/lib/agents";
import type { ThreadSummary } from "@whirl/lib/threads";
import { useView } from "@whirl/lib/view";
import { AgentFace } from "./agent-face";

/* Who the composer is talking to — the agent layer's half of the composer,
   beside the model picker and in the same pill style. On home it picks the
   agent or group a new chat goes to; inside a thread the conversation's
   partner is fixed, so it's a plain label. */

const TRIGGER =
  "relative flex h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13.5px]/4 font-medium text-muted-foreground transition-colors duration-150";

export function AgentPicker({ thread }: { thread?: ThreadSummary }) {
  const roster = useRoster();
  const picked = useNewChatTarget();
  const { openSettings } = useView();

  if (thread) {
    const target = thread.target;
    if (!target) return null;
    return (
      <span className={TRIGGER} title={target.kind === "group" ? `Group chat with ${target.name}` : `Talking to ${target.name}`}>
        <AgentFace name={target.name} hue={target.hue} group={target.kind === "group"} size={18} />
        <span className="hidden max-w-28 truncate sm:inline">{target.name}</span>
      </span>
    );
  }

  const target = resolveTarget(roster, picked);
  const agent = target?.kind === "agent" ? roster?.agents.find((a) => a.id === target.id) : undefined;
  const group = target?.kind === "group" ? roster?.groups.find((g) => g.id === target.id) : undefined;
  const label = agent?.name ?? group?.name ?? (roster && !roster.agents.length ? "New agent" : "Agent");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={`${TRIGGER} cursor-pointer hover:bg-black/[0.05] hover:text-foreground data-popup-open:bg-black/[0.05] data-popup-open:text-foreground dark:hover:bg-white/[0.06] dark:data-popup-open:bg-white/[0.06]`}
        aria-label={`Talking to ${label}. Change agent`}
      >
        <AgentFace name={label} hue={agent?.hue} group={!!group} working={agent?.state === "working"} size={18} />
        <span className="hidden max-w-28 truncate sm:inline">{label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-64">
        {roster && roster.agents.length > 0 && (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Agents</DropdownMenuLabel>
            {roster.agents.map((a) => (
              <DropdownMenuItem key={a.id} onClick={() => setNewChatTarget({ kind: "agent", id: a.id })}>
                <AgentFace name={a.name} hue={a.hue} working={a.state === "working"} size={20} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{a.name}</span>
                  {a.job && <span className="truncate text-xs text-muted-foreground">{a.job}</span>}
                </span>
                {target?.kind === "agent" && target.id === a.id && <IconCheck size={14} />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        )}
        {roster && roster.groups.length > 0 && (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Groups</DropdownMenuLabel>
            {roster.groups.map((g) => (
              <DropdownMenuItem key={g.id} onClick={() => setNewChatTarget({ kind: "group", id: g.id })}>
                <AgentFace name={g.name} group size={20} />
                <span className="flex-1 truncate">{g.name}</span>
                {target?.kind === "group" && target.id === g.id && <IconCheck size={14} />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        )}
        {roster && (roster.agents.length > 0 || roster.groups.length > 0) && <DropdownMenuSeparator />}
        <DropdownMenuItem onClick={() => openSettings("agents")}>
          <IconSettings size={16} />
          Manage agents
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
