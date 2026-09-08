"use client";

import Image from "next/image";
import { motion } from "motion/react";
import { useEffect, useState } from "react";

import { useMode, type Mode } from "@/lib/mode";

/**
 * The first thing you see: two doors, a mark on each, nothing else.
 *
 * Both names say what they are, so anything written underneath would only be
 * saying it again. The marks are line drawings rather than icons — three
 * columns for the board, three rings for the bands — and they draw themselves
 * in on hover, which is the whole of the interaction.
 */

const DOORS: { mode: Mode; title: string; accent: string; mark: (hovered: boolean) => React.ReactNode }[] = [
  { mode: "school", title: "School", accent: "var(--info)", mark: (h) => <ColumnsMark hovered={h} /> },
  { mode: "counselor", title: "Counselor", accent: "oklch(0.8 0.13 300)", mark: (h) => <RingsMark hovered={h} /> },
];

export default function Launcher() {
  const { choose } = useMode();
  const [hovered, setHovered] = useState<Mode | null>(null);

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

      <div className="launcher-grid">
        {DOORS.map((door, i) => (
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
