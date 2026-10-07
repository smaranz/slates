"use client";

import { useState } from "react";

import type { AgentGroup, RosterAgent } from "@/lib/agent/types";
import { AgentFace } from "@whirl/components/agent-face";
import { Button } from "@whirl/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@whirl/components/ui/dialog";
import { Input } from "@whirl/components/ui/input";
import { agentApi } from "@whirl/lib/agents";
import { showToast } from "@whirl/lib/toasts";
import { cn } from "@whirl/lib/utils";
import { Field } from "./fields";

/* A group chat: two to six agents who hear the same conversation and
   @mention each other to hand work across. */
export function GroupDialog({
  open,
  onOpenChange,
  group,
  agents,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group?: AgentGroup;
  agents: RosterAgent[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Mounted per opening, so the fields start from this group. */}
        {open && <GroupForm key={group?.id ?? "new"} group={group} agents={agents} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function GroupForm({ group, agents, onDone }: { group?: AgentGroup; agents: RosterAgent[]; onDone: () => void }) {
  const [name, setName] = useState(group?.name ?? "");
  const [members, setMembers] = useState<string[]>(group?.members ?? []);
  const [saving, setSaving] = useState(false);

  const toggle = (id: string) =>
    setMembers((current) => (current.includes(id) ? current.filter((m) => m !== id) : current.length >= 6 ? current : [...current, id]));

  const canSave = members.length >= 2 && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await agentApi(group ? "update-group" : "create-group", { ...(group ? { id: group.id } : {}), name: name.trim(), members });
      showToast(group ? "Group saved." : "Group created.");
      onDone();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Couldn't save that group.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <DialogHeader>
        <DialogTitle>{group ? `Edit ${group.name}` : "New group"}</DialogTitle>
      </DialogHeader>
      <div className="mt-4 flex flex-col gap-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Study crew" autoFocus />
        </Field>
        <Field label="Members" hint="Pick two to six. The first one answers unless you @mention someone.">
          <div className="flex flex-col gap-1">
            {agents.map((agent) => {
              const on = members.includes(agent.id);
              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => toggle(agent.id)}
                  aria-pressed={on}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                    on ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60",
                  )}
                >
                  <AgentFace name={agent.name} hue={agent.hue} size={22} />
                  <span className="flex-1 truncate">{agent.name}</span>
                  <span className={cn("text-xs", on ? "text-foreground" : "opacity-0")}>✓</span>
                </button>
              );
            })}
          </div>
        </Field>
      </div>
      <DialogFooter className="mt-5">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSave}>
          {group ? "Save" : "Create group"}
        </Button>
      </DialogFooter>
    </form>
  );
}
