"use client";

import Image from "next/image";
import { motion } from "motion/react";
import { useEffect, useState } from "react";

import { useHiddenApps } from "@/lib/app-prefs";
import { useMode, type Mode } from "@/lib/mode";
import { Icon, ICON } from "./ui";

/**
 * The first thing you see: a door for each app, a mark on each, nothing else.
 *
 * Both names say what they are, so anything written underneath would only be
 * saying it again. The marks are line drawings rather than icons — three
 * columns for the board, three rings for the bands — and they draw themselves
 * in on hover, which is the whole of the interaction.
 */

const DOORS: { mode: Mode; title: string; accent: string; mark: (hovered: boolean) => React.ReactNode }[] = [
  { mode: "school", title: "School", accent: "var(--info)", mark: (h) => <ColumnsMark hovered={h} /> },
  { mode: "counselor", title: "Counselor", accent: "oklch(0.8 0.13 300)", mark: (h) => <RingsMark hovered={h} /> },
  { mode: "ui", title: "UI", accent: "oklch(0.78 0.15 165)", mark: (h) => <StackMark hovered={h} /> },
  { mode: "usage", title: "AI Usage", accent: "oklch(0.82 0.12 85)", mark: (h) => <MeterMark hovered={h} /> },
  { mode: "media", title: "Media Gen Studio", accent: "oklch(0.8 0.13 25)", mark: (h) => <MediaMark hovered={h} /> },
  { mode: "agent", title: "Agent", accent: "oklch(0.8 0.12 215)", mark: (h) => <AgentMark hovered={h} /> },
  { mode: "health", title: "Health", accent: "oklch(0.86 0.17 132)", mark: (h) => <HealthMark hovered={h} /> },
];

export default function Launcher() {
  const { choose, openSettings } = useMode();
  const [hovered, setHovered] = useState<Mode | null>(null);
  // Apps switched off in Settings › General don't get a door.
  const [hiddenApps] = useHiddenApps();
  const doors = DOORS.filter((d) => !hiddenApps.includes(d.mode));

  // The traffic lights sit over the top-left in the desktop shell, and this
  // screen has no sidebar to hold them off.
  useEffect(() => {
    if (navigator.userAgent.includes("Electron")) {
      document.documentElement.dataset.desktop = "1";
    }
  }, []);

  return (
    <div className="launcher">
      <motion.span
        className="launcher-mark"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        <Image src="/assets/slates-mark.png" alt="Slates" width={30} height={30} priority />
      </motion.span>

      {/* One settings screen for both halves, and this is the way to it. */}
      <button type="button" className="launcher-settings" onClick={openSettings}>
        <Icon path={ICON.settings} size={14} />
        Settings
      </button>

      <div className="launcher-grid">
        {doors.map((door, i) => (
          <motion.button
            key={door.mode}
            type="button"
            className="launcher-card"
            style={{ ["--accent" as string]: door.accent }}
            onClick={() => choose(door.mode)}
            onMouseEnter={() => setHovered(door.mode)}
            onMouseLeave={() => setHovered((m) => (m === door.mode ? null : m))}
            onFocus={() => setHovered(door.mode)}
            onBlur={() => setHovered((m) => (m === door.mode ? null : m))}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.06 + i * 0.06, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.985 }}
          >
            <span className="launcher-glyph">{door.mark(hovered === door.mode)}</span>
            <span className="launcher-card-title">{door.title}</span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

/** Three columns of the board, with cards stacked in the first. */
function ColumnsMark({ hovered }: { hovered: boolean }) {
  return (
    <svg viewBox="0 0 54 54" width="54" height="54" fill="none" aria-hidden>
      {[0, 1, 2].map((c) => (
        <motion.rect
          key={c}
          x={4 + c * 16}
          width="14"
          rx="3.5"
          stroke="currentColor"
          strokeWidth="1.5"
          initial={false}
          animate={{ y: hovered ? 5 : 7, height: hovered ? 44 : 40, opacity: c === 0 ? 0.95 : 0.38 }}
          transition={{ type: "spring", stiffness: 260, damping: 24, delay: c * 0.04 }}
        />
      ))}
      {[0, 1].map((r) => (
        <motion.rect
          key={r}
          x="7"
          width="8"
          height="7"
          rx="2.5"
          fill="var(--accent)"
          initial={false}
          animate={{ y: (hovered ? 10 : 12) + r * 10, opacity: hovered ? 1 : 0.7 }}
          transition={{ type: "spring", stiffness: 260, damping: 24, delay: r * 0.05 }}
        />
      ))}
    </svg>
  );
}

/** Three bands, with the student at the centre. */
/**
 * Three sheets, offset — a stack of components, which is what the shelf is.
 * They fan apart on hover rather than scaling, so the mark says "several
 * things you can take one from" instead of "a button".
 */
function StackMark({ hovered }: { hovered: boolean }) {
  return (
    <svg viewBox="0 0 54 54" width="54" height="54" fill="none" aria-hidden>
      {[0, 1, 2].map((i) => (
        <motion.rect
          key={i}
          x={11}
          y={12 + i * 10}
          width={32}
          height={13}
          rx={3.5}
          stroke={i === 0 ? "var(--accent)" : "currentColor"}
          strokeWidth={i === 0 ? 1.8 : 1.6}
          initial={false}
          animate={{
            y: hovered ? 12 + i * 12.5 : 12 + i * 10,
            opacity: i === 0 ? 1 : 0.55 - i * 0.12,
          }}
          transition={{ type: "spring", stiffness: 220, damping: 22, delay: i * 0.04 }}
        />
      ))}
    </svg>
  );
}

function RingsMark({ hovered }: { hovered: boolean }) {
  return (
    <svg viewBox="0 0 54 54" width="54" height="54" fill="none" aria-hidden>
      {[23, 15.5].map((r, i) => (
        <motion.circle
          key={r}
          cx="27"
          cy="27"
          r={r}
          stroke="currentColor"
          strokeWidth="1.6"
          initial={false}
          animate={{ scale: hovered ? 1.06 : 1, opacity: 0.4 + i * 0.15 }}
          transition={{ type: "spring", stiffness: 220, damping: 22, delay: i * 0.04 }}
          style={{ transformOrigin: "27px 27px" }}
        />
      ))}
      <motion.circle
        cx="27"
        cy="27"
        r="7"
        stroke="var(--accent)"
        strokeWidth="1.8"
        initial={false}
        animate={{ scale: hovered ? 1.06 : 1 }}
        transition={{ type: "spring", stiffness: 220, damping: 22 }}
        style={{ transformOrigin: "27px 27px" }}
      />
      <motion.circle
        cx="27"
        cy="27"
        r="2.8"
        fill="var(--accent)"
        initial={false}
        animate={{ scale: hovered ? [1, 1.3, 1] : 1 }}
        transition={{ duration: 1.5, repeat: hovered ? Number.POSITIVE_INFINITY : 0, ease: "easeInOut" }}
        style={{ transformOrigin: "27px 27px" }}
      />
    </svg>
  );
}

/** Usage meter — three bars that rise on hover. */
function MeterMark({ hovered }: { hovered: boolean }) {
  const heights = hovered ? [22, 34, 28] : [14, 22, 18];
  return (
    <svg viewBox="0 0 54 54" width="54" height="54" fill="none" aria-hidden>
      {[0, 1, 2].map((i) => (
        <motion.rect
          key={i}
          x={12 + i * 12}
          width="8"
          rx="2.5"
          stroke={i === 1 ? "var(--accent)" : "currentColor"}
          strokeWidth={i === 1 ? 1.8 : 1.6}
          initial={false}
          animate={{
            y: 42 - heights[i]!,
            height: heights[i],
            opacity: i === 1 ? 1 : 0.45,
          }}
          transition={{ type: "spring", stiffness: 260, damping: 22, delay: i * 0.04 }}
        />
      ))}
      <motion.line
        x1="10"
        x2="44"
        y1="44"
        y2="44"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        initial={false}
        animate={{ opacity: hovered ? 0.7 : 0.35 }}
      />
    </svg>
  );
}

function MediaMark({ hovered }: { hovered: boolean }) {
  const heights = hovered ? [13, 20, 15] : [7, 11, 8];
  return (
    <svg viewBox="0 0 54 54" width="54" height="54" fill="none" aria-hidden>
      <motion.rect
        x="4"
        y="5"
        width="46"
        height="44"
        rx="9"
        stroke="currentColor"
        strokeWidth="1.5"
        initial={false}
        animate={{ opacity: hovered ? 0.8 : 0.48 }}
      />
      <motion.path
        d="M15 18.5v17l14-8.5z"
        fill="var(--accent)"
        initial={false}
        animate={{ opacity: hovered ? 1 : 0.78, scale: hovered ? 1.06 : 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 22 }}
        style={{ transformOrigin: "22px 27px" }}
      />
      {[0, 1, 2].map((i) => (
        <motion.rect
          key={i}
          x={33 + i * 5}
          width="2.5"
          rx="1.25"
          fill="var(--accent)"
          initial={false}
          animate={{ y: 37 - heights[i]!, height: heights[i]! }}
          transition={{ type: "spring", stiffness: 260, damping: 22, delay: i * 0.04 }}
        />
      ))}
    </svg>
  );
}

/** A screen with a prompt — the computer the agents work on. The cursor blinks on hover. */
function AgentMark({ hovered }: { hovered: boolean }) {
  return (
    <svg viewBox="0 0 54 54" width="54" height="54" fill="none" aria-hidden>
      <motion.rect
        x="5"
        y="9"
        width="44"
        height="32"
        rx="7"
        stroke="currentColor"
        strokeWidth="1.5"
        initial={false}
        animate={{ opacity: hovered ? 0.8 : 0.48 }}
      />
      <motion.line x1="21" x2="33" y1="47" y2="47" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" initial={false} animate={{ opacity: hovered ? 0.7 : 0.4 }} />
      <motion.path
        d="M15 20.5l6 4.5-6 4.5"
        stroke="var(--accent)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={false}
        animate={{ x: hovered ? 2 : 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 22 }}
      />
      <motion.rect
        x="25"
        y="28"
        width="9"
        height="2.2"
        rx="1.1"
        fill="var(--accent)"
        initial={false}
        animate={{ opacity: hovered ? [1, 0.15, 1] : 0.85 }}
        transition={{ duration: 1, repeat: hovered ? Number.POSITIVE_INFINITY : 0, ease: "easeInOut" }}
      />
    </svg>
  );
}

/** A day's calorie ring, filling further on hover, with a heartbeat drawn across it. */
function HealthMark({ hovered }: { hovered: boolean }) {
  return (
    <svg viewBox="0 0 54 54" width="54" height="54" fill="none" aria-hidden>
      <circle cx="27" cy="27" r="21" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
      <motion.circle
        cx="27"
        cy="27"
        r="21"
        stroke="var(--accent)"
        strokeWidth="1.9"
        strokeLinecap="round"
        style={{ rotate: -90, transformOrigin: "27px 27px" }}
        initial={false}
        animate={{ pathLength: hovered ? 0.86 : 0.62 }}
        transition={{ type: "spring", stiffness: 140, damping: 20 }}
      />
      <motion.path
        d="M15 28h6l3-6 4.5 11 3-5H39"
        stroke="var(--accent)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={false}
        animate={{ pathLength: hovered ? [0, 1] : 1, opacity: hovered ? 1 : 0.75 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      />
    </svg>
  );
}
