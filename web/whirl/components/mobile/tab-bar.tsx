"use client";

import {
  IconHistory,
  IconMessageCircleFilled,
  IconUserFilled,
  IconSettingsFilled,
  type Icon,
} from "@tabler/icons-react";

import { useIncognitoState } from "@whirl/lib/incognito";
import { useView } from "@whirl/lib/view";

/* The phone's navigation. A 20rem drawer is a desktop rail in a costume —
   it hides where you are, it takes a reach to the far corner to open, and
   nothing else on the home screen works that way. Four tabs say where you
   are without being asked.
 *
 * Chrome, not surface: it sits outside <main> in the shell's column, wearing
 * the same --background the rail wears on desktop, so the content pane still
 * reads as a panel with a frame around it. Desktop never renders it — the
 * rail is right there. */

type Tab = {
  key: "chat" | "history" | "agents" | "settings";
  label: string;
  icon: Icon;
};

const TABS: Tab[] = [
  { key: "chat", label: "Chat", icon: IconMessageCircleFilled },
  /* No filled cut of this one in Tabler, and the outline reads as history
     more clearly than any of the filled clocks do. */
  { key: "history", label: "History", icon: IconHistory },
  /* The agent layer: the team, one tap away on a phone. */
  { key: "agents", label: "Agents", icon: IconUserFilled },
  { key: "settings", label: "Settings", icon: IconSettingsFilled },
];

export function MobileTabBar() {
  const { settingsOpen, section, historyOpen, openHome, openHistory, openSettings } = useView();
  /* Incognito hides history the same way it hides the rail: the mode is a
     room with no record in it, and a tab straight into the transcript list
     would be the one door that undoes that. */
  const { enabled: incognito } = useIncognitoState();

  const active = settingsOpen
    ? section === "agents"
      ? "agents"
      : "settings"
    : historyOpen
        ? "history"
        : "chat";

  const go = (key: Tab["key"]) => {
    switch (key) {
      case "settings":
        return openSettings();
      case "agents":
        return openSettings("agents");
      case "history":
        return openHistory();
      case "chat":
        /* Tapping the tab you're already on goes back to the top of it,
           the way every tab bar does — here that means the open thread
           steps aside for a fresh one. */
        return openHome();
    }
  };

  return (
    <nav
      aria-label="Sections"
      className="mobile-tab-bar flex shrink-0 items-stretch gap-1 border-t border-border bg-background px-2 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] md:hidden"
    >
      {TABS.map((tab) => {
        if (tab.key === "history" && incognito) return null;
        const isActive = active === tab.key;
        const TabIcon = tab.icon;
        return (
          <button
            key={tab.key}
            type="button"
            aria-current={isActive ? "page" : undefined}
            onClick={() => go(tab.key)}
            /* Snaps between tabs rather than gliding a pill along the row:
               a tab bar is a place you land, not a thing you slide. */
            className={`flex flex-1 cursor-pointer flex-col items-center gap-1 rounded-xl py-1.5 transition-[color,background-color,scale] duration-150 active:scale-[0.94] ${
              isActive
                ? "text-foreground"
                : "text-foreground-soft active:bg-accent-pressed"
            }`}
          >
            <span className="relative flex">
              <TabIcon size={21} />
            </span>
            <span
              className={`text-[10.5px]/3 tracking-tight ${
                isActive ? "font-semibold" : "font-medium"
              }`}
            >
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
