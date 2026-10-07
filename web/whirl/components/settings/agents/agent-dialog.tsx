"use client";

import { useState } from "react";

import type { ModelChoice, RosterAgent } from "@/lib/agent/types";
import { ToggleSwitch } from "@whirl/components/toggle-switch";
import { Button } from "@whirl/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@whirl/components/ui/dialog";
import { Input } from "@whirl/components/ui/input";
import { agentApi } from "@whirl/lib/agents";
import { showToast } from "@whirl/lib/toasts";
import { Field, Select, TextArea } from "./fields";

/* Create or edit one agent: who it is, what it owns, the rules it always
   follows, which model it thinks with, and whether it answers out loud.
   `agent` undefined means a new one. */
export function AgentDialog({
  open,
  onOpenChange,
  agent,
  models,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent?: RosterAgent;
  models: ModelChoice[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* Mounted per opening, so the fields start from this agent. */}
        {open && <AgentForm key={agent?.id ?? "new"} agent={agent} models={models} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function AgentForm({ agent, models, onDone }: { agent?: RosterAgent; models: ModelChoice[]; onDone: () => void }) {
  const [name, setName] = useState(agent?.name ?? "");
  const [job, setJob] = useState(agent?.job ?? "");
  const [rules, setRules] = useState(agent?.rules ?? "");
  const [model, setModel] = useState(agent?.model ?? models[0]?.id ?? "");
  const [voice, setVoice] = useState(agent?.voiceReplies ?? false);
  const [saving, setSaving] = useState(false);

  const canSave = name.trim().length > 0 && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await agentApi(agent ? "update-agent" : "create-agent", {
        ...(agent ? { id: agent.id } : {}),
        name: name.trim(),
        job: job.trim(),
        rules,
        model,
        voiceReplies: voice,
      });
      showToast(agent ? `${name.trim()} saved.` : `${name.trim()} is on the team.`);
      onDone();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Couldn't save that agent.");
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
        <DialogTitle>{agent ? `Edit ${agent.name}` : "New agent"}</DialogTitle>
      </DialogHeader>
      <div className="mt-4 flex flex-col gap-4">
        <Field label="Name" hint="What you call it — and how teammates @mention it in group chats.">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Atlas" autoFocus />
        </Field>
        <Field label="Job" hint="One line on what it owns.">
          <Input value={job} onChange={(e) => setJob(e.target.value)} maxLength={200} placeholder="Keeps my assignments and deadlines straight" />
        </Field>
        <Field label="Standing rules" hint="Instructions it follows on every task.">
          <TextArea
            value={rules}
            onChange={(e) => setRules(e.target.value)}
            rows={4}
            maxLength={4000}
            placeholder="Check Schoology before answering anything about due dates. Keep replies short."
          />
        </Field>
        <Field label="Model">
          <Select value={model} onChange={(e) => setModel(e.target.value)}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            {model && !models.some((m) => m.id === model) && <option value={model}>{model}</option>}
          </Select>
        </Field>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">Voice replies</div>
            <div className="text-xs text-muted-foreground">Answers arrive as a voice memo as well as text.</div>
          </div>
          <ToggleSwitch checked={voice} onCheckedChange={setVoice} />
        </div>
      </div>
      <DialogFooter className="mt-5">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSave}>
          {agent ? "Save" : "Create agent"}
        </Button>
      </DialogFooter>
    </form>
  );
}
