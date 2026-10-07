"use client";

import { useConvexAuth, useMutation, useQuery } from "@whirl/backend/react";

import { api } from "@whirl/backend/convex/_generated/api";
import type { Id } from "@whirl/backend/convex/_generated/dataModel";

/* Client bindings for hand-written skills — the settings Integrations
   section's data layer. Store skill installs live in lib/skills-data.ts;
   these are the bring-your-own kind, instructions and all. */

/** One custom skill, whole — it's the user's own text. */
export type CustomSkill = {
  id: Id<"customSkills">;
  name: string;
  description?: string;
  instructions: string;
  enabled: boolean;
  updatedAt: number;
};

/** The signed-in user's custom skills, plus all the mutators. `skills` is
 *  undefined while loading (and while signed out). */
export function useCustomSkills() {
  const { isAuthenticated } = useConvexAuth();
  const skills = useQuery(
    api.customSkills.listSkills,
    isAuthenticated ? {} : "skip",
  ) as CustomSkill[] | undefined;
  return {
    skills,
    addSkill: useMutation(api.customSkills.addSkill),
    updateSkill: useMutation(api.customSkills.updateSkill),
    setSkillEnabled: useMutation(api.customSkills.setSkillEnabled),
    removeSkill: useMutation(api.customSkills.removeSkill),
  };
}
