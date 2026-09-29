import "server-only";

import { newId, skills } from "@/lib/agent/store";
import type { Skill } from "@/lib/agent/types";

/**
 * The skill library every agent and the tutor share: saved procedures a
 * helper follows the next time the same kind of task comes up.
 *
 * Shown the way Hermes Agent shows skills, by progressive disclosure: every
 * turn carries each skill's name and one line on when to use it, and the
 * steps are only read when a helper opens one. Helpers write them as well as
 * read them: a new way of doing something that worked becomes a skill, and a
 * skill that turned out wrong is patched where it's wrong.
 */

const NAME_LIMIT = 60;
const DESCRIPTION_LIMIT = 200;
const INSTRUCTIONS_LIMIT = 20_000;
const INDEX_LIMIT = 40;

const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

export function describeSkill(skill: Skill): string {
  return tidy(skill.description || skill.instructions.split("\n").find((line) => line.trim()) || "").slice(0, 140);
}

export function findSkill(name: string, list = skills.all()): Skill | undefined {
  const wanted = tidy(name).replace(/^\//, "").toLowerCase();
  return list.find((skill) => skill.name.toLowerCase() === wanted);
}

/** One line per skill, most used first, for the top of a turn. */
export function skillIndex(): string {
  const list = skills
    .all()
    .slice()
    .sort((a, b) => (b.uses ?? 0) - (a.uses ?? 0) || b.updatedAt - a.updatedAt)
    .slice(0, INDEX_LIMIT);
  return list.map((skill) => `- ${skill.name}: ${describeSkill(skill)}`).join("\n");
}

export function viewSkill(name: string): string {
  const all = skills.all();
  const skill = findSkill(name, all);
  if (!skill) {
    return all.length ? `No skill is called "${tidy(name)}". The skills are: ${all.map((s) => s.name).join(", ")}.` : "No skills are saved yet.";
  }
  skill.uses = (skill.uses ?? 0) + 1;
  skills.save(all);
  return `# ${skill.name}\n${skill.description ? `\n${skill.description}\n` : ""}\n${skill.instructions}`;
}

export function saveSkill(input: { name: string; description?: string; instructions: string }, by: string): { skill: Skill; created: boolean } {
  const name = tidy(input.name).replace(/^\//, "").slice(0, NAME_LIMIT);
  const instructions = input.instructions.trim().slice(0, INSTRUCTIONS_LIMIT);
  if (!name || !instructions) throw new Error("A skill needs a name and instructions.");
  const description = tidy(input.description ?? "").slice(0, DESCRIPTION_LIMIT) || undefined;
  const all = skills.all();
  const existing = findSkill(name, all);
  if (existing) {
    Object.assign(existing, { name, instructions, description: description ?? existing.description, updatedAt: Date.now(), by });
    skills.save(all);
    return { skill: existing, created: false };
  }
  const skill: Skill = { id: newId("skl"), name, description, instructions, updatedAt: Date.now(), by, uses: 0 };
  skills.save([...all, skill]);
  return { skill, created: true };
}

/** Change one piece of a skill in place: `oldText` has to appear in it exactly once. */
export function patchSkill(input: { name: string; oldText: string; newText: string }, by: string): Skill {
  const all = skills.all();
  const skill = findSkill(input.name, all);
  if (!skill) throw new Error(`No skill is called "${tidy(input.name)}". Use save_skill to make it.`);
  const { oldText, newText } = input;
  if (!oldText) throw new Error("old_text is empty: give the exact piece of the skill to change.");
  const at = skill.instructions.indexOf(oldText);
  if (at < 0) throw new Error(`"${oldText.slice(0, 80)}" isn't in the skill word for word. Read it with get_skill and copy the piece exactly.`);
  if (skill.instructions.indexOf(oldText, at + oldText.length) >= 0) throw new Error("That piece appears more than once in the skill. Include more of the text around it.");
  const instructions = `${skill.instructions.slice(0, at)}${newText}${skill.instructions.slice(at + oldText.length)}`.slice(0, INSTRUCTIONS_LIMIT);
  if (!instructions.trim()) throw new Error("That would leave the skill empty.");
  Object.assign(skill, { instructions, updatedAt: Date.now(), by });
  skills.save(all);
  return skill;
}
