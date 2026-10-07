"use client";

import { useEffect } from "react";

import type { SentFile } from "@/lib/agent/types";
import { canSaveToComputer, saveToComputer } from "@/lib/desktop-bridge";
import ScheduleAlerts from "./day/ScheduleAlerts";
import "./scrollbars.css";

/**
 * The Mac app's inbox: a file an agent sends lands in Downloads › Slates with
 * a notification, whichever part of Slates is open, and ones sent while the
 * app was closed (a routine at 7am, say) are picked up when it next opens.
 * Anywhere without the desktop bridge this does nothing; the file is still in
 * the agent's chat to open. The Schedule's alerts and the always-visible
 * scrollbars ride along, since they need the same place: loaded on every
 * page of the Mac app.
 */

const ON_KEY = "slates.desktop.receiveFiles";
const SINCE_KEY = "slates.desktop.receivedSince";
/** Catching up goes back at most this far, and takes at most a handful. */
const CATCH_UP_MS = 7 * 86_400_000;
const CATCH_UP_MAX = 10;

export function receivingFiles(): boolean {
  try {
    return window.localStorage.getItem(ON_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setReceivingFiles(on: boolean): void {
  try {
    window.localStorage.setItem(ON_KEY, on ? "1" : "0");
    // Turning it back on starts from now rather than delivering everything missed while it was off.
    if (on) window.localStorage.setItem(SINCE_KEY, String(Date.now()));
  } catch {
    // Storage is off; the default (on) holds.
  }
}

export default function DesktopInbox() {
  useEffect(() => {
    if (!canSaveToComputer()) return;
    let since = Number(window.localStorage.getItem(SINCE_KEY)) || 0;
    if (!since) {
      // The first run starts from now: nobody wants a week of old files at once.
      since = Date.now();
      window.localStorage.setItem(SINCE_KEY, String(since));
    }

    let busy = false;
    let again = false;
    const catchUp = async () => {
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      try {
        do {
          again = false;
          if (!receivingFiles()) return;
          const response = await fetch(`/api/agent/outbox?since=${since}`, { cache: "no-store" });
          if (!response.ok) return;
          const { files } = (await response.json()) as { files: SentFile[] };
          const due = files
            .filter((file) => file.at > since && Date.now() - file.at < CATCH_UP_MS)
            .sort((a, b) => a.at - b.at)
            .slice(-CATCH_UP_MAX);
          for (const file of due) {
            await saveToComputer(`/api/agent/outbox?id=${encodeURIComponent(file.id)}&download=1`, file.name, {
              notify: { title: `${file.from} sent you a file`, body: `${file.name} is in Downloads › Slates. Click to open it.` },
            })?.catch((error: unknown) => console.warn(`[inbox] couldn't save ${file.name}:`, error));
            since = Math.max(since, file.at);
            window.localStorage.setItem(SINCE_KEY, String(since));
          }
        } while (again);
      } catch {
        // The host is unreachable for now; the next event or reconnect tries again.
      } finally {
        busy = false;
      }
    };

    let source: EventSource | null = null;
    let retry: number | undefined;
    const connect = () => {
      source = new EventSource("/api/agent/stream?only=file");
      // "hello" on every (re)connect covers anything sent while the connection was down.
      source.onmessage = () => void catchUp();
      source.onerror = () => {
        source?.close();
        retry = window.setTimeout(connect, 5_000);
      };
    };
    connect();
    return () => {
      window.clearTimeout(retry);
      source?.close();
    };
  }, []);

  return <ScheduleAlerts />;
}
