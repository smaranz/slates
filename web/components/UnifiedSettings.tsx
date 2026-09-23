"use client";

import { useState } from "react";

import { useHiddenApps } from "@/lib/app-prefs";
import { useMode, type Mode } from "@/lib/mode";
import { GeneralSettings, UiSettings, UsageSettings } from "./AppSettings";
import MobileRuntimeProvider from "./MobileRuntime";
import SettingsView from "./SettingsView";
import ProfileView from "./counselor/ProfileView";
import { Icon, ICON } from "./ui";

/**
 * One settings screen for the whole of Slates.
 *
 * School and Counselor used to keep their own — a Settings tab in one, a
 * Profile tab in the other — and the overlap was the problem: the same name
 * and photo were editable in two places, and it was never obvious which one
 * owned a given preference. Neither half owns any of it. The Schoology
 * connection, the API keys, the student's name and their college record are
 * facts about the person using Slates, not about whichever side they happened
 * to open.
 *
 * So it lives at the home screen, above both, and is reached from there.
 *
 * General comes first — which apps Slates shows at all — then one tab per
 * app. Name, photo, and local data sit on School with the Schoology
 * connection; they are not a product of their own. An app switched off in
 * General takes its tab with it.
 */

const TABS: { id: "general" | Mode; label: string }[] = [
  { id: "general", label: "General" },
  { id: "school", label: "School" },
  { id: "counselor", label: "Counselor" },
  { id: "ui", label: "UI" },
  { id: "usage", label: "AI Usage" },
];

type Tab = (typeof TABS)[number]["id"];

export default function UnifiedSettings() {
  const { closeSettings } = useMode();
  const [picked, setTab] = useState<Tab>("general");
  const [hiddenApps] = useHiddenApps();
  const tabs = TABS.filter((t) => t.id === "general" || !hiddenApps.includes(t.id));
  // Hiding the app whose tab is open falls back to General rather than a blank.
  const tab = tabs.some((t) => t.id === picked) ? picked : "general";

  return (
    /* SettingsView reads the phone runtime for the mobile-host notice and the
       native permission prompts, so it needs that provider wherever it is
       rendered — not only inside the school shell it used to live in. */
    <MobileRuntimeProvider>
    <div className="shell settings-shell">
      <div className="main">
        <div className="settings-topbar">
          <button type="button" className="btn btn--quiet" style={{ height: 30 }} onClick={closeSettings}>
            <Icon path={ICON.chevronLeft} size={14} />
            Done
          </button>

          <span className="settings-heading">Settings</span>

          <div className="settings-tabs">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`settings-tab${tab === t.id ? " is-on" : ""}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Each was written as a full screen, so each keeps its own scroller. */}
        {tab === "general" ? (
          <GeneralSettings />
        ) : tab === "counselor" ? (
          <ProfileView />
        ) : tab === "ui" ? (
          <UiSettings />
        ) : tab === "usage" ? (
          <UsageSettings />
        ) : (
          <SettingsView />
        )}
      </div>
    </div>
    </MobileRuntimeProvider>
  );
}
