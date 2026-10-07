"use client";

import { useState } from "react";
import { IconPencil, IconPlus, IconRefresh, IconTrash, IconUsersGroup } from "@tabler/icons-react";

import type { AgentGroup, RosterAgent } from "@/lib/agent/types";
import { AgentFace } from "@whirl/components/agent-face";
import { ConfirmDialog } from "@whirl/components/confirm-dialog";
import { Button } from "@whirl/components/ui/button";
import { agentApi, agentStateLabel, useRoster } from "@whirl/lib/agents";
import { showToast } from "@whirl/lib/toasts";
import { SettingsCard, SettingsGroupHeader, SettingsHeader, SettingsRow } from "../settings-rows";
import { AgentDialog } from "./agent-dialog";
import { GroupDialog } from "./group-dialog";

/* Settings › Agents: the team. Each agent is a teammate with a job, rules
   and a model, running on the PC that hosts Slates; groups put several in
   one conversation. */

type Pending = { kind: "delete-agent" | "reset-agent"; agent: RosterAgent } | { kind: "delete-group"; group: AgentGroup };

export function AgentsSection() {
  const roster = useRoster();
  const [editing, setEditing] = useState<RosterAgent | "new" | null>(null);
  const [editingGroup, setEditingGroup] = useState<AgentGroup | "new" | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const agents = roster?.agents ?? [];
  const groups = roster?.groups ?? [];

  const confirm = async () => {
    if (!pending) return;
    try {
      if (pending.kind === "delete-group") {
        await agentApi("delete-group", { id: pending.group.id });
        showToast(`${pending.group.name} deleted.`);
      } else {
        await agentApi(pending.kind, { id: pending.agent.id });
        showToast(pending.kind === "delete-agent" ? `${pending.agent.name} removed.` : `${pending.agent.name} starts fresh next time.`);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "That didn't work.");
    }
  };

  return (
    <>
      <SettingsHeader title="Agents" description="Your AI teammates. They work on the PC running Slates, with its files, shell and a real browser." />
      <div className="flex flex-col gap-9">
        <section>
          <SettingsGroupHeader
            title="Team"
            description="Start a chat with any of them from the composer."
            control={
              <Button size="sm" onClick={() => setEditing("new")}>
                <IconPlus size={14} stroke={2.2} />
                New agent
              </Button>
            }
          />
          <SettingsCard>
            {roster === undefined ? (
              <p className="p-4 text-sm text-muted-foreground">Loading the team…</p>
            ) : agents.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No agents yet. Make one, or just send a message and Slates will make Atlas for you.</p>
            ) : (
              agents.map((agent) => (
                <SettingsRow
                  key={agent.id}
                  iconNode={<AgentFace name={agent.name} hue={agent.hue} working={agent.state === "working"} size={28} />}
                  title={agent.name}
                  description={
                    <>
                      {agent.job || "General help"}
                      <span className="text-muted-foreground/70">
                        {" · "}
                        {roster.models.find((m) => m.id === agent.model)?.label ?? agent.model}
                        {agentStateLabel(agent) ? ` · ${agentStateLabel(agent)}` : ""}
                      </span>
                    </>
                  }
                  control={
                    <div className="flex items-center gap-0.5">
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${agent.name}`} onClick={() => setEditing(agent)}>
                        <IconPencil size={15} />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Reset ${agent.name}'s working context`} title="Reset working context" onClick={() => setPending({ kind: "reset-agent", agent })}>
                        <IconRefresh size={15} />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${agent.name}`} onClick={() => setPending({ kind: "delete-agent", agent })}>
                        <IconTrash size={15} />
                      </Button>
                    </div>
                  }
                />
              ))
            )}
          </SettingsCard>
        </section>

        <section>
          <SettingsGroupHeader
            title="Groups"
            description="Several agents in one conversation. @mention one to bring them in."
            control={
              <Button size="sm" variant="secondary" disabled={agents.length < 2} onClick={() => setEditingGroup("new")}>
                <IconPlus size={14} stroke={2.2} />
                New group
              </Button>
            }
          />
          <SettingsCard>
            {groups.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">{agents.length < 2 ? "Make a second agent to start a group." : "No groups yet."}</p>
            ) : (
              groups.map((group) => (
                <SettingsRow
                  key={group.id}
                  icon={IconUsersGroup}
                  title={group.name}
                  description={group.members.map((id) => agents.find((a) => a.id === id)?.name).filter(Boolean).join(", ")}
                  control={
                    <div className="flex items-center gap-0.5">
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${group.name}`} onClick={() => setEditingGroup(group)}>
                        <IconPencil size={15} />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${group.name}`} onClick={() => setPending({ kind: "delete-group", group })}>
                        <IconTrash size={15} />
                      </Button>
                    </div>
                  }
                />
              ))
            )}
          </SettingsCard>
        </section>
      </div>

      <AgentDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        agent={editing && editing !== "new" ? editing : undefined}
        models={roster?.models ?? []}
      />
      <GroupDialog
        open={editingGroup !== null}
        onOpenChange={(open) => !open && setEditingGroup(null)}
        group={editingGroup && editingGroup !== "new" ? editingGroup : undefined}
        agents={agents}
      />
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={
          pending?.kind === "delete-group"
            ? `Delete ${pending.group.name}?`
            : pending?.kind === "reset-agent"
              ? `Reset ${pending.agent.name}?`
              : `Remove ${pending?.agent.name ?? "agent"}?`
        }
        message={
          pending?.kind === "reset-agent"
            ? "Its own chat is cleared and its next turn starts without the working context it built up. Memory, skills and routines stay."
            : pending?.kind === "delete-group"
              ? "The group chat goes with it. The agents stay."
              : "Its routines and its own chat go with it. Threads with it stay in your history."
        }
        confirmLabel={pending?.kind === "reset-agent" ? "Reset" : pending?.kind === "delete-group" ? "Delete" : "Remove"}
        destructive={pending?.kind !== "reset-agent"}
        onConfirm={() => void confirm()}
      />
    </>
  );
}
