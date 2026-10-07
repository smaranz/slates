"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { IconLoader2 } from "@tabler/icons-react";
import { useConvexAuth } from "@whirl/backend/react";
import { AnimatePresence, motion } from "motion/react";

import { useIncognitoState } from "@whirl/lib/incognito";
import { syncLockedIds } from "@whirl/lib/locked/locked-ids";
import { clearThreadMessageCache } from "@whirl/lib/message-cache";
import { paneFlip } from "@whirl/lib/motion";
import { SECTION_TITLES } from "@whirl/lib/settings-sections";
import { useThreads } from "@whirl/lib/threads";
import { useView } from "@whirl/lib/view";
import { ChatView } from "./chat-view";
import { HistoryView } from "./mobile/history-view";
import { MobileTabBar } from "./mobile/tab-bar";
import { IncognitoJanitor } from "./incognito-toggle";
import { OpenSourceAnnouncement } from "./open-source/open-source-announcement";
import { PageSlide } from "./page-slide";
import { Sidebar } from "./sidebar";
import { LockDialogs } from "./locked/lock-dialogs";
import { Toaster } from "./toaster";
import {
  DeploymentWatcher,
  ResetNoticeDialog,
  UsageMultiplierBanner,
} from "./system-status";

/* The second face is nine settings sections and the whole integrations
   store, and it used to be imported — and mounted, and subscribed — on
   every page load, including the chat home nobody opens settings from.
   Split out, it costs nothing until it is wanted.

   Warmed on idle rather than left to load on click: the slide between faces
   is the app's most-repeated animation, and it should never wait on a
   network round trip. By the time anyone reaches for settings the chunk is
   already in the module registry, so `dynamic` resolves synchronously and
   the face is there on the first frame — the same as when it was static,
   minus the cost to first paint. */
const importSettings = () => import("./settings/settings-view");

/* Only ever seen by someone who opened a settings URL cold, before the warm
   below has had a chance to run — every in-app trip finds the chunk already
   there. Same spinner the thread view waits behind. */
function AwayFaceLoading() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <IconLoader2 size={20} className="animate-spin text-muted-foreground" />
    </div>
  );
}

const SettingsView = dynamic(
  () => importSettings().then((module) => module.SettingsView),
  { loading: AwayFaceLoading },
);

function useWarmAwayFace() {
  useEffect(() => {
    /* After first paint and only when the main thread is free — this must
       never compete with the chat face becoming interactive. */
    const warm = () => {
      void importSettings();
    };
    if (typeof requestIdleCallback !== "function") {
      const id = setTimeout(warm, 2000);
      return () => clearTimeout(id);
    }
    const id = requestIdleCallback(warm, { timeout: 4000 });
    return () => cancelIdleCallback(id);
  }, []);
}

/** Everything that isn't the chat: they share the page slide's second face. */
type AwayFaceName = "settings" | "integrations" | "history";

/* Settings, the integrations store and the phone's chat list share the page
   slide's second face. Which one shows is latched: while none is open (the
   face is sliding out), the last-open one keeps rendering, so the exit
   animation never swaps content mid-flight. Hops between them while VISIBLE
   ride the same quick pane flip the settings sections use — which is also
   what a phone's tab bar wants, since three of its four tabs live here. But
   a swap that happens off-screen (settings was latched, integrations opens
   from home) must be silent: the epoch key remounts AnimatePresence so the
   stale face vanishes instead of playing its exit over the incoming slide. */
function AwayFace({ target }: { target: AwayFaceName | null }) {
  const open = target !== null;

  const [face, setFace] = useState<AwayFaceName>(target ?? "settings");
  const [epoch, setEpoch] = useState(0);
  /* Whether page 2 was showing as of the last committed frame — a swap
     requested while it wasn't gets the silent treatment. */
  const wasOpen = useRef(open);
  /* Nothing on this face exists until it is first asked for: no sections
     mounted, no Convex subscriptions open, behind the chat the whole time.
     Latched rather than tracking `open`, because from the first visit
     onward the face has to stay mounted — that's what lets it slide out
     with its content intact, and keeps a section's state across trips. */
  const [everOpened, setEverOpened] = useState(open);
  if (open && !everOpened) setEverOpened(true);

  /* Derived-state-in-render, so the very first frame of an open already
     wears the right face — an effect would paint the stale one first. */
  if (target !== null && target !== face) {
    setFace(target);
    // This ref deliberately snapshots whether page 2 was visible before
    // this derived-state render; an effect would be one frame too late.
    // eslint-disable-next-line react-hooks/refs
    if (!wasOpen.current) setEpoch((n) => n + 1);
  }

  useEffect(() => {
    wasOpen.current = open;
  }, [open]);

  if (!everOpened) return null;

  return (
    <AnimatePresence key={epoch} mode="popLayout" initial={false}>
      <motion.div
        key={face}
        className="flex min-h-0 flex-1 flex-col"
        {...paneFlip}
      >
        {face === "settings" || face === "integrations" ? (
          <SettingsView />
        ) : (
          <HistoryView />
        )}
      </motion.div>
    </AnimatePresence>
  );
}

/* Both faces live here, permanently mounted, so the page slide can animate
   and the composer draft survives a settings trip. The URL decides which
   face is showing (lib/view.tsx); the route pages under app/(shell)/ render
   null — they exist to claim the URLs and carry per-route metadata, and
   arrive here as empty `children`. */
export function AppShell({ children }: { children?: React.ReactNode }) {
  const { settingsOpen, integrationsOpen, historyOpen, section, threadId } =
    useView();
  /* One answer for both the slide and the face inside it, so page 2 can
     never be showing while claiming to be nothing. */
  const awayFace: AwayFaceName | null = settingsOpen
    ? "settings"
    : integrationsOpen
      ? "integrations"
      : historyOpen
        ? "history"
        : null;
  useWarmAwayFace();
  const { isAuthenticated } = useConvexAuth();
  /* Shares the sidebar's subscription — no extra wire traffic. */
  const threads = useThreads(isAuthenticated);
  const activeThread = threadId
    ? threads?.find((thread) => thread.id === threadId)
    : undefined;

  /* Keep the "which threads are locked" note in step with the server, so a
     chat locked on another device draws its locked face on this one's next
     reload instead of flashing its cached transcript first. Cheap: the
     listing is already subscribed above, and the sync is a no-op unless the
     set actually changed. Locked threads also give up their cached
     transcript here — that snapshot predates the lock and is readable. */
  useEffect(() => {
    if (!threads) return;
    syncLockedIds(threads);
    for (const thread of threads) {
      if (thread.locked) clearThreadMessageCache(thread.id);
    }
  }, [threads]);

  /* pushState navigation never touches the server, so the tab title is
     ours to keep honest. The server-rendered metadata covers first paint. */
  const { enabled: incognito } = useIncognitoState();
  useEffect(() => {
    document.title = settingsOpen
      ? `${SECTION_TITLES[section]} · Agent`
      : historyOpen
        ? "Chats · Agent"
        : activeThread
          ? `${activeThread.title} · Agent`
          : incognito
            ? "Incognito · Agent"
            : "Agent · Slates";
  }, [
    settingsOpen,
    integrationsOpen,
    historyOpen,
    section,
    activeThread,
    incognito,
  ]);

  return (
    /* A column on a phone (pane above, tab bar below) and a row on a desktop
       (rail beside pane) — the two arrangements of the same two pieces.
       `app-frame` is what app/mobile.css hangs the touch shell off: the
       height that yields to an on-screen keyboard, and the document
       scrolling that gets switched off underneath it. */
    <div className="app-frame flex h-dvh w-full flex-col bg-background md:flex-row">
      <Sidebar />
      <main className="raised relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface md:my-2 md:mr-2 md:rounded-lg md:border md:border-border">
        <UsageMultiplierBanner />
        <PageSlide
          page={awayFace === null ? 1 : 2}
          className="min-h-0 flex-1"
          pageClassName="flex flex-col"
          one={<ChatView activeThread={activeThread} />}
          two={<AwayFace target={awayFace} />}
        />
      </main>
      <MobileTabBar />
      <Toaster />
      <LockDialogs />
      <IncognitoJanitor />
      <ResetNoticeDialog enabled={isAuthenticated} />
      <OpenSourceAnnouncement />
      <DeploymentWatcher />
      {children}
    </div>
  );
}
