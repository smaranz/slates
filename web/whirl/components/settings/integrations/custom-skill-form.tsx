"use client";

import { useState } from "react";

import { Button } from "@whirl/components/ui/button";
import { Input } from "@whirl/components/ui/input";
import { Spinner } from "@whirl/components/ui/spinner";
import type { CustomSkill } from "@whirl/lib/custom-skills";
import { errorText } from "@whirl/lib/integrations-data";
import { showToast } from "@whirl/lib/toasts";

/* Write or edit one custom skill. `skill` undefined => add mode. The
   instructions are the skill — the model pulls them in whenever the name or
   description sounds relevant to the conversation. */

const MAX_NAME_LENGTH = 60;
const MAX_DESCRIPTION_LENGTH = 240;
const MAX_INSTRUCTIONS_LENGTH = 100_000;

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-medium text-muted-foreground">
      {children}
    </span>
  );
}

export function CustomSkillForm({
  skill,
  onSave,
  onCancel,
}: {
  skill?: CustomSkill;
  onSave: (args: {
    name: string;
    description?: string;
    instructions: string;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(skill?.name ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const [instructions, setInstructions] = useState(skill?.instructions ?? "");
  const [saving, setSaving] = useState(false);

  const trimmedName = name.trim();
  const trimmedInstructions = instructions.trim();
  const canSubmit = trimmedName.length > 0 && trimmedInstructions.length > 0;

  const handleSave = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    try {
      await onSave({
        name: trimmedName,
        description: description.trim() || undefined,
        instructions: trimmedInstructions,
      });
      onCancel();
    } catch (error) {
      showToast(errorText(error, "Couldn't save that skill. Try again."));
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <FieldLabel>Name</FieldLabel>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Weekly report format"
          maxLength={MAX_NAME_LENGTH}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <FieldLabel>Description</FieldLabel>
        <Input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Optional — when should Whirl reach for this?"
          maxLength={MAX_DESCRIPTION_LENGTH}
        />
        <p className="text-[11.5px] text-muted-foreground/70">
          Whirl sees the name and description every chat and pulls in the full
          instructions when they seem relevant.
        </p>
      </label>

      <label className="flex flex-col gap-1.5">
        <FieldLabel>Instructions</FieldLabel>
        <textarea
          value={instructions}
          onChange={(event) =>
            setInstructions(
              event.target.value.slice(0, MAX_INSTRUCTIONS_LENGTH),
            )
          }
          rows={6}
          maxLength={MAX_INSTRUCTIONS_LENGTH}
          placeholder="e.g. When I ask for a weekly report, structure it as: wins, blockers, next week. Keep it under 300 words."
          className="w-full resize-y rounded-lg bg-well px-3 py-2.5 text-[13px]/5 shadow-[inset_0_0_0_1px_var(--well-outline),inset_0_1px_0_0_var(--well-highlight)] outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      <div className="mt-1 flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!canSubmit || saving}
          className="min-w-[84px]"
          onClick={() => void handleSave()}
        >
          {saving ? <Spinner /> : skill ? "Save" : "Add skill"}
        </Button>
      </div>
    </div>
  );
}
