import { redirect } from "next/navigation";

import { isSettingsSection } from "@whirl/lib/settings-sections";

/* Claims /agent/settings and /agent/settings/<section>; the shell draws the
   section. A section that doesn't exist goes back to General. */
export default async function AgentSettingsPage({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section } = await params;
  if (section && (section.length > 1 || !isSettingsSection(section[0] ?? ""))) redirect("/agent/settings");
  return null;
}
