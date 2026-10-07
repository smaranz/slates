"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";

import { paneFlip } from "@whirl/lib/motion";
import { useView } from "@whirl/lib/view";
import { AgentsSection } from "./agents/agents-section";
import { RoutinesSection } from "./agents/routines-section";
import { SkillsSection } from "./agents/skills-section";
import { GeneralSection } from "./general-section";
import { ModelsSection } from "./models-section";
import { PersonalizationSection } from "./personalization-section";
import { SectionStrip } from "./section-strip";

const SECTION_VIEWS = {
  general: GeneralSection,
  personalization: PersonalizationSection,
  agents: AgentsSection,
  routines: RoutinesSection,
  skills: SkillsSection,
  models: ModelsSection,
} as const;

/* The settings face of the content pane. Section swaps ride the shared
   pane flip, so hopping between sidebar rows feels like the rest of the app
   rather than a hard cut. */
export function SettingsView() {
  const { settingsOpen, section, closeSettings } = useView();

  /* Escape backs out to chats — unless a dialog or menu is up, which owns
     the key. */
  useEffect(() => {
    if (!settingsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (
        document.querySelector("[data-popup-open], [role='dialog'], [role='menu']")
      )
        return;
      closeSettings();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settingsOpen, closeSettings]);

  const Section = SECTION_VIEWS[section];

  return (
    <div className="flex min-h-0 flex-1 overflow-y-auto px-4 [scrollbar-gutter:stable_both-edges] md:px-6">
      {/* h-fit, or the flex stretch pins this box at pane height and the
          pb-16 lands mid-content — clipping the last card's bottom edge. */}
      <div className="mx-auto h-fit w-full max-w-2xl pt-[max(1rem,env(safe-area-inset-top))] pb-10 md:pt-10 md:pb-16">
        {/* Outside the AnimatePresence: the strip is the thing doing the
            switching, so it must not flip along with what it switches. */}
        <SectionStrip />
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={section} {...paneFlip}>
            <Section />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
