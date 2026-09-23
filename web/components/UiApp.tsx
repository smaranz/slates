"use client";

import { useEffect } from "react";

import { useMode } from "@/lib/mode";
import UiView from "./UiView";
import { Icon, ICON } from "./ui";

/**
 * The UI shelf as its own half of Slates.
 *
 * It carries no sidebar of its own: the shelf is already three panes wide and
 * a fourth rail of navigation would be furniture around a room with one thing
 * in it. What it does need is the way back, and the traffic-light inset the
 * desktop shell expects.
 */
export default function UiApp() {
  const { clear, openSettings } = useMode();

  useEffect(() => {
    if (navigator.userAgent.includes("Electron")) {
      document.documentElement.dataset.desktop = "1";
    }
  }, []);

  return (
    <div className="shell ui-mode">
      <div className="main">
        <header className="ui-top">
          <button type="button" className="ui-back" onClick={clear} aria-label="Back to the launcher">
            <Icon path={ICON.chevronLeft} size={13} />
            Slates
          </button>
          <span className="ui-top-title">UI</span>
          <span className="ui-top-sub">Component registries, read as code</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="ui-back" onClick={() => openSettings()}>
            <Icon path={ICON.settings} size={13} />
            Settings
          </button>
        </header>
        <UiView />
      </div>
    </div>
  );
}
