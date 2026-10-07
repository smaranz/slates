"use client";

import { StoreTabs } from "@whirl/components/integrations/store-tabs";
import { SETTINGS_SECTIONS } from "@whirl/lib/settings-sections";
import { useSettingsSections } from "@whirl/lib/deployment-features";
import { useView } from "@whirl/lib/view";

/* Section navigation for a phone. On a desktop the nine sections are rows in
   the rail; there is no rail here, and the tab bar's Settings tab can only
   land you in one of them — so the rest have to be reachable from inside.
 *
 * Chips in a scroller rather than a second full-page index: it keeps every
 * section one tap away instead of two, it's the control the store already
 * uses, and it doesn't need a back affordance invented for it. The strip
 * keeps the selected chip in view itself. */

const LABELS: Record<(typeof SETTINGS_SECTIONS)[number], string> = {
  general: "General",
  personalization: "Personalization",
  agents: "Agents",
  routines: "Routines",
  skills: "Skills",
  models: "Models",
};

export function SectionStrip() {
  const { section, setSection } = useView();
  const sections = useSettingsSections();

  return (
    <StoreTabs
      value={section}
      onChange={setSection}
      tabs={sections.map((key) => ({ value: key, label: LABELS[key] }))}
      glide={false}
      /* Bleeds into the pane's px-4 so the row of chips runs edge to edge
         and reads as scrollable, with the padding restored inside. */
      className="-mx-4 mb-5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] md:hidden"
    />
  );
}
