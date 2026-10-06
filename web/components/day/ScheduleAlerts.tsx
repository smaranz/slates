"use client";

import { useEffect } from "react";

import { alertsDue, type ScheduleAlert } from "@/lib/day/alerts";

/**
 * The Schedule's alerts on the Mac: a notification and a chime as each block
 * starts, and a quarter of an hour before F45 a notification, a loud alarm
 * and a spoken reminder. Mounted with the Mac app's inbox, so it runs in
 * whichever room is open; on the phone or in a browser it does nothing. It
 * only runs while the app is open (the app quits with its window), and an
 * alert missed by more than a couple of minutes, asleep or closed, stays
 * missed.
 */

const ON_KEY = "slates.schedule.alerts";
const SOUNDED_KEY = "slates.schedule.alertedAt";
const MINUTE = 60_000;

export function onTheMacApp(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent.includes("Electron");
}

export function alertsOn(): boolean {
  try {
    return window.localStorage.getItem(ON_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setAlertsOn(on: boolean): void {
  try {
    window.localStorage.setItem(ON_KEY, on ? "1" : "0");
  } catch {
    // Storage is off; alerts stay on, the default.
  }
}

function soundedAt(): number {
  try {
    return Number(window.localStorage.getItem(SOUNDED_KEY)) || 0;
  } catch {
    return 0;
  }
}

function markSounded(at: number): void {
  try {
    window.localStorage.setItem(SOUNDED_KEY, String(at));
  } catch {
    // Without storage a reload could repeat the last alert; nothing worse.
  }
}

/* ── sounds ────────────────────────────────────────────────────────────── */

/** A pitch in Hz, then when it starts and how long it rings, in seconds. */
type Note = readonly [hz: number, at: number, length: number];

/** Two soft notes: the next thing is starting. */
const CHIME: readonly Note[] = [
  [880, 0, 0.5],
  [1318.5, 0.16, 0.8],
];

/** Three bursts of three hard beeps, to be heard across the room: F45 soon. */
const ALARM: readonly Note[] = [0, 1, 2].flatMap((burst) => [0, 1, 2].map((beep): Note => [1046.5, burst * 0.9 + beep * 0.2, 0.14]));

/** Plays the notes and says how many seconds they take. */
function play(notes: readonly Note[], loud: boolean): number {
  const audio = new AudioContext();
  void audio.resume();
  const start = audio.currentTime + 0.05;
  for (const [hz, at, length] of notes) {
    const tone = audio.createOscillator();
    const gain = audio.createGain();
    tone.type = loud ? "square" : "sine";
    tone.frequency.value = hz;
    gain.gain.setValueAtTime(0.0001, start + at);
    gain.gain.exponentialRampToValueAtTime(loud ? 0.6 : 0.25, start + at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + at + length);
    tone.connect(gain).connect(audio.destination);
    tone.start(start + at);
    tone.stop(start + at + length + 0.05);
  }
  const seconds = Math.max(...notes.map(([, at, length]) => at + length));
  window.setTimeout(() => void audio.close(), (seconds + 0.5) * 1000);
  return seconds;
}

/** The chime a block's alert makes, to hear what turning alerts on means. */
export function chime(): void {
  play(CHIME, false);
}

function sound(alerts: ScheduleAlert[]): void {
  for (const alert of alerts) {
    try {
      const note = new Notification(alert.title, { body: alert.body, silent: true });
      note.onclick = () => window.focus();
    } catch {
      // Notifications are off for Slates in System Settings; the sound still plays.
    }
  }
  const f45 = alerts.find((alert) => alert.kind === "f45");
  if (!f45) {
    play(CHIME, false);
    return;
  }
  const seconds = play(ALARM, true);
  window.setTimeout(() => {
    const words = new SpeechSynthesisUtterance(`${f45.title}. Time to head out.`);
    words.volume = 1;
    window.speechSynthesis.speak(words);
  }, seconds * 1000 + 300);
}

/* ── the clock ─────────────────────────────────────────────────────────── */

export default function ScheduleAlerts() {
  useEffect(() => {
    if (!onTheMacApp()) return;
    if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();

    let lastCheck = Date.now();
    let timer = 0;
    const check = () => {
      window.clearTimeout(timer);
      const now = Date.now();
      const due = alertsOn() ? alertsDue(lastCheck, soundedAt(), now) : [];
      lastCheck = now;
      if (due.length) {
        markSounded(due.at(-1)!.at);
        sound(due);
      }
      // Just past the next minute, which is when anything comes due.
      timer = window.setTimeout(check, MINUTE - (now % MINUTE) + 250);
    };
    timer = window.setTimeout(check, MINUTE - (lastCheck % MINUTE) + 250);

    // Timers sleep with the Mac and slow down in the background: look again as soon as it's back.
    const onShow = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", onShow);
    };
  }, []);

  return null;
}
