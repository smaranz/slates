"use client";

import { useState } from "react";
import { IconBookFilled, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";

import { ConfirmDialog } from "@whirl/components/confirm-dialog";
import { Button } from "@whirl/components/ui/button";
import { useRoster } from "@whirl/lib/agents";
import { useCustomSkills, type CustomSkill } from "@whirl/lib/custom-skills";
import { showToast } from "@whirl/lib/toasts";
import { CustomSkillForm } from "../integrations/custom-skill-form";
import { SettingsCard, SettingsGroupHeader, SettingsHeader, SettingsRow } from "../settings-rows";

/* Settings › Skills: how-tos every agent (and the School tutor) can open
   when a task calls for one. Agents write and improve them as they learn;
   you can too. @mention one in the composer to make an agent use it. */
export function SkillsSection() {
  const { skills, addSkill, updateSkill, removeSkill } = useCustomSkills();
  const roster = useRoster();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [removing, setRemoving] = useState<CustomSkill | null>(null);

  const meta = new Map((roster?.skills ?? []).map((s) => [s.id, s]));

  return (
    <>
      <SettingsHeader title="Skills" description="How-tos your agents and the tutor share. They write their own as they learn, and you can add yours." />
      <section>
        <SettingsGroupHeader
          title="Saved skills"
          description="@mention one in the composer to have an agent follow it."
          control={
            <Button size="sm" onClick={() => setEditing("new")} disabled={editing === "new"}>
              <IconPlus size={14} stroke={2.2} />
              New skill
            </Button>
          }
        />
        <SettingsCard>
          {editing === "new" && (
            <div className="p-4">
              <CustomSkillForm
                onSave={async (args) => {
                  await addSkill(args);
                  showToast(`${args.name} saved.`);
                }}
                onCancel={() => setEditing(null)}
              />
            </div>
          )}
          {skills === undefined ? (
            <p className="p-4 text-sm text-muted-foreground">Loading skills…</p>
          ) : skills.length === 0 && editing !== "new" ? (
            <p className="p-4 text-sm text-muted-foreground">No skills yet. Your agents save one when they work out how to do something worth repeating.</p>
          ) : (
            skills.map((skill) =>
              editing === skill.id ? (
                <div key={skill.id} className="p-4">
                  <CustomSkillForm
                    skill={skill}
                    onSave={async (args) => {
                      await updateSkill({ id: skill.id, name: args.name, description: args.description ?? "", instructions: args.instructions });
                      showToast(`${args.name} saved.`);
                    }}
                    onCancel={() => setEditing(null)}
                  />
                </div>
              ) : (
                <SettingsRow
                  key={skill.id}
                  icon={IconBookFilled}
                  title={skill.name}
                  description={
                    <>
                      {skill.description || "No description"}
                      <span className="text-muted-foreground/70">
                        {meta.get(skill.id)?.by ? ` · by ${meta.get(skill.id)!.by}` : ""}
                        {meta.get(skill.id)?.uses ? ` · used ${meta.get(skill.id)!.uses}×` : ""}
                      </span>
                    </>
                  }
                  control={
                    <div className="flex items-center gap-0.5">
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${skill.name}`} onClick={() => setEditing(skill.id)}>
                        <IconPencil size={15} />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${skill.name}`} onClick={() => setRemoving(skill)}>
                        <IconTrash size={15} />
                      </Button>
                    </div>
                  }
                />
              ),
            )
          )}
        </SettingsCard>
      </section>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Delete ${removing?.name ?? "skill"}?`}
        message="Agents and the tutor won't be able to open it anymore."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (!removing) return;
          removeSkill({ id: removing.id })
            .then(() => showToast(`${removing.name} deleted.`))
            .catch(() => showToast("Couldn't delete that skill."));
        }}
      />
    </>
  );
}
