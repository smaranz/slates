/* Shared between the client shell (lib/view.tsx) and the server route
   (app/(shell)/settings/[[...section]]/page.tsx) — no "use client" here,
   or the server page couldn't read the list. */

/* Slates' Agent app: Whirl's own General, Personalization and Models, plus
   the agent layer — the team, its routines, and the skills they share.
   Account, billing and usage have nothing to manage here. */
export const SETTINGS_SECTIONS = [
  "general",
  "personalization",
  "agents",
  "routines",
  "skills",
  "models",
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export function isSettingsSection(value: string): value is SettingsSection {
  return (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/* Tab titles: served initially by the settings route's metadata, kept in
   sync on client navigations by the shell (navigation is pushState-based,
   so the server never gets a chance to swap them). */
export const SECTION_TITLES: Record<SettingsSection, string> = {
  general: "Settings",
  personalization: "Personalization settings",
  agents: "Agents",
  routines: "Routines",
  skills: "Skills",
  models: "Model settings",
};

/** General lives at the bare /settings; the rest get their own segment. */
export function settingsPath(section: SettingsSection): string {
  return section === "general" ? "/settings" : `/settings/${section}`;
}
