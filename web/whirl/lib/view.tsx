"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";

import {
  isSettingsSection,
  settingsPath,
  type SettingsSection,
} from "./settings-sections";

export type { SettingsSection };

/* Which face the shell is showing (chats vs settings vs the integrations
   store), which thread the chat face is on, and the active settings
   section — all derived from the URL. /settings, /settings/<section>,
   /integrations, and /thread/<id> are real routes, so deep links, refresh,
   and the back button all work, and back/forward runs the same page slide.

   Navigation goes through the native History API, which Next syncs into
   usePathname: the face flips the same frame the user clicks, with no
   server round-trip. That's safe precisely because the route pages render
   null — there's nothing to fetch; the shell layout
   (app/(shell)/layout.tsx) already has both faces mounted. */
/** Where the Agent app lives inside Slates; Whirl's own routes hang off it. */
export const BASE_PATH = "/agent";

function local(pathname: string): string {
  if (pathname === BASE_PATH) return "/";
  return pathname.startsWith(`${BASE_PATH}/`) ? pathname.slice(BASE_PATH.length) : pathname;
}

export function useView() {
  const pathname = local(usePathname());
  const router = useRouter();

  const settingsOpen =
    pathname === "/settings" || pathname.startsWith("/settings/");
  const segment = settingsOpen ? (pathname.split("/")[2] ?? "") : "";
  const section: SettingsSection = isSettingsSection(segment)
    ? segment
    : "general";

  /* The integrations store rides the same page slide as settings — it's
     the content pane's other "away from chats" face. */
  const integrationsOpen = pathname === "/integrations";

  /* Chat history as a page of its own. It exists for the phone, where the
     tab bar replaced the rail that used to hold the list — but it is a real
     route like the others, so the back button and a deep link both work,
     and a desktop visit renders the same page beside the rail. */
  const historyOpen = pathname === "/history";

  /* The chat face's current thread; null on home. Junk like
     /thread/a/b just reads as no thread — the route page canonicalizes. */
  const threadSegment = pathname.startsWith("/thread/")
    ? pathname.slice("/thread/".length)
    : "";
  const threadId =
    threadSegment && !threadSegment.includes("/") ? threadSegment : null;

  const openSettings = useCallback((target: SettingsSection = "general") => {
    window.history.pushState(null, "", BASE_PATH + settingsPath(target));
  }, []);

  const closeSettings = useCallback(() => {
    window.history.pushState(null, "", BASE_PATH);
  }, []);

  const openIntegrations = useCallback(() => {
    window.history.pushState(null, "", `${BASE_PATH}/integrations`);
  }, []);

  const openHistory = useCallback(() => {
    window.history.pushState(null, "", `${BASE_PATH}/history`);
  }, []);

  const openThread = useCallback((id: string) => {
    window.history.pushState(null, "", `${BASE_PATH}/thread/${id}`);
  }, []);

  const openHome = useCallback(() => {
    window.history.pushState(null, "", BASE_PATH);
  }, []);

  /* Where every upgrade prompt lands. Pricing is a real page outside the
     shell — pushState would swap the URL without mounting it, so this one
     goes through the router. */
  const openPricing = useCallback(() => {
    // Slates has nothing to sell; an upgrade prompt just goes home.
    router.push(BASE_PATH);
  }, [router]);

  return {
    settingsOpen,
    integrationsOpen,
    historyOpen,
    section,
    threadId,
    openSettings,
    closeSettings,
    openIntegrations,
    openHistory,
    openThread,
    openHome,
    openPricing,
    setSection: openSettings,
  };
}
