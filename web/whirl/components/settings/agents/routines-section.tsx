"use client";

import { useState } from "react";
import { IconPencil, IconPlayerPlayFilled, IconPlus, IconTrash } from "@tabler/icons-react";

import type { Routine, Schedule } from "@/lib/agent/types";
import { AgentFace } from "@whirl/components/agent-face";
import { ConfirmDialog } from "@whirl/components/confirm-dialog";
import { ToggleSwitch } from "@whirl/components/toggle-switch";
import { Button } from "@whirl/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@whirl/components/ui/dialog";
import { Input } from "@whirl/components/ui/input";
import { agentApi, useRoster, type RosterView } from "@whirl/lib/agents";
import { showToast } from "@whirl/lib/toasts";
import { cn } from "@whirl/lib/utils";
import { ChoiceCapsules } from "../choice-capsules";
import { SettingsCard, SettingsGroupHeader, SettingsHeader, SettingsRow } from "../settings-rows";
import { Field, Select, TextArea } from "./fields";

/* Settings › Routines: work an agent does on a schedule — a morning
   briefing, a nightly check of new grades. Results land in that agent's
   own chat, which shows up in the sidebar like any other. */

const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function describe(schedule: Schedule): string {
  if (schedule.kind === "every") {
    const m = schedule.minutes;
    return m % 60 === 0 ? `Every ${m / 60 === 1 ? "hour" : `${m / 60} hours`}` : `Every ${m} minutes`;
  }
  const days =
    schedule.days.length === 7
      ? "Every day"
      : schedule.days.length === 5 && !schedule.days.includes(0) && !schedule.days.includes(6)
        ? "Weekdays"
        : schedule.days.map((d) => DAY_NAMES[d]).join(", ");
  return `${days} at ${schedule.time}`;
}

function when(at: number | null): string {
  if (!at) return "";
  return new Date(at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

export function RoutinesSection() {
  const roster = useRoster();
  const [editing, setEditing] = useState<Routine | "new" | null>(null);
  const [removing, setRemoving] = useState<Routine | null>(null);
  const routines = roster?.routines ?? [];
  const agents = roster?.agents ?? [];

  const run = async (op: string, body: Record<string, unknown>, done?: string) => {
    try {
      await agentApi(op, body);
      if (done) showToast(done);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "That didn't work.");
    }
  };

  return (
    <>
      <SettingsHeader title="Routines" description="Work your agents do on a schedule, whether or not you're around." />
      <section>
        <SettingsGroupHeader
          title="Scheduled"
          description="Results land in the agent's own chat."
          control={
            <Button size="sm" disabled={!agents.length} onClick={() => setEditing("new")}>
              <IconPlus size={14} stroke={2.2} />
              New routine
            </Button>
          }
        />
        <SettingsCard>
          {roster === undefined ? (
            <p className="p-4 text-sm text-muted-foreground">Loading routines…</p>
          ) : routines.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              {agents.length ? "No routines yet. Try a morning briefing of what's due." : "Make an agent first, under Agents."}
            </p>
          ) : (
            routines.map((routine) => {
              const agent = agents.find((a) => a.id === routine.agentId);
              const last = routine.runs[0];
              return (
                <SettingsRow
                  key={routine.id}
                  iconNode={<AgentFace name={agent?.name ?? "?"} hue={agent?.hue} size={28} />}
                  title={routine.name}
                  description={
                    <>
                      {describe(routine.schedule)} · {agent?.name ?? "Removed agent"}
                      {routine.enabled && routine.nextRun ? ` · next ${when(routine.nextRun)}` : ""}
                      {last && (
                        <span className={cn("block truncate", last.ok ? "text-muted-foreground/80" : "text-destructive")}>
                          Last run {when(last.at)}: {last.note}
                        </span>
                      )}
                    </>
                  }
                  control={
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Run ${routine.name} now`}
                        title="Run now"
                        onClick={() => void run("run-routine", { id: routine.id }, `${routine.name} started.`)}
                      >
                        <IconPlayerPlayFilled size={14} />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${routine.name}`} onClick={() => setEditing(routine)}>
                        <IconPencil size={15} />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${routine.name}`} onClick={() => setRemoving(routine)}>
                        <IconTrash size={15} />
                      </Button>
                      <ToggleSwitch checked={routine.enabled} onCheckedChange={(enabled) => void run("update-routine", { id: routine.id, enabled })} />
                    </div>
                  }
                />
              );
            })
          )}
        </SettingsCard>
      </section>

      <RoutineDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        routine={editing && editing !== "new" ? editing : undefined}
        roster={roster}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Delete ${removing?.name ?? "routine"}?`}
        message="It stops running. What it already posted stays in the agent's chat."
        confirmLabel="Delete"
        destructive
        onConfirm={() => removing && void run("delete-routine", { id: removing.id }, `${removing.name} deleted.`)}
      />
    </>
  );
}

function RoutineDialog({
  open,
  onOpenChange,
  routine,
  roster,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  routine?: Routine;
  roster: RosterView | undefined;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* Mounted per opening, so the fields start from this routine. */}
        {open && <RoutineForm key={routine?.id ?? "new"} routine={routine} roster={roster} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function RoutineForm({ routine, roster, onDone }: { routine?: Routine; roster: RosterView | undefined; onDone: () => void }) {
  const schedule = routine?.schedule;
  const [agentId, setAgentId] = useState(routine?.agentId ?? roster?.agents[0]?.id ?? "");
  const [name, setName] = useState(routine?.name ?? "");
  const [prompt, setPrompt] = useState(routine?.prompt ?? "");
  const [mode, setMode] = useState<"days" | "every">(schedule?.kind ?? "days");
  const [days, setDays] = useState<number[]>(schedule?.kind === "days" ? schedule.days : [1, 2, 3, 4, 5]);
  const [time, setTime] = useState(schedule?.kind === "days" ? schedule.time : "07:30");
  const [hours, setHours] = useState(schedule?.kind === "every" ? String(Math.max(1, Math.round(schedule.minutes / 60))) : "1");
  const [saving, setSaving] = useState(false);

  const canSave = !!agentId && prompt.trim().length > 0 && (mode === "every" || days.length > 0) && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const schedule = mode === "days" ? { days, time } : { everyMinutes: Math.max(1, Number(hours) || 1) * 60 };
      await agentApi(routine ? "update-routine" : "create-routine", {
        ...(routine ? { id: routine.id } : { agentId }),
        name: name.trim(),
        prompt: prompt.trim(),
        ...schedule,
      });
      showToast(routine ? "Routine saved." : "Routine scheduled.");
      onDone();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Couldn't save that routine.");
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
        <DialogTitle>{routine ? `Edit ${routine.name}` : "New routine"}</DialogTitle>
      </DialogHeader>
      <div className="mt-4 flex flex-col gap-4">
        {!routine && (
          <Field label="Agent">
            <Select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              {(roster?.agents ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Morning briefing" />
        </Field>
        <Field label="What to do" hint="Written like a message to the agent.">
          <TextArea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            maxLength={8000}
            placeholder="Check Schoology for anything due in the next three days and give me a short plan."
          />
        </Field>
        <Field label="When">
          <div className="flex flex-col gap-3">
            <ChoiceCapsules
              value={mode}
              onChange={setMode}
              options={[
                { value: "days", label: "On days" },
                { value: "every", label: "Every few hours" },
              ]}
            />
            {mode === "days" ? (
              <div className="flex flex-wrap items-center gap-2">
                {DAYS.map((label, day) => {
                  const on = days.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={on}
                      aria-label={DAY_NAMES[day]}
                      onClick={() => setDays((d) => (on ? d.filter((x) => x !== day) : [...d, day].sort()))}
                      className={cn(
                        "size-8 rounded-full text-xs font-medium transition-colors",
                        on ? "bg-primary text-primary-foreground" : "bg-well text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="ml-auto w-32" />
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm">
                Every
                <Input type="number" min={1} max={48} value={hours} onChange={(e) => setHours(e.target.value)} className="w-20" />
                hours
              </div>
            )}
          </div>
        </Field>
      </div>
      <DialogFooter className="mt-5">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSave}>
          {routine ? "Save" : "Schedule"}
        </Button>
      </DialogFooter>
    </form>
  );
}
