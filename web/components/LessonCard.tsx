"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";

import type { LessonStage, LessonStatus } from "@/lib/lesson/types";
import { Icon, ICON } from "./ui";

/**
 * A teaching video being made, and then watched.
 *
 * The card sits in the frame the finished video will occupy, so nothing jumps
 * when it arrives. What fills that frame in the meantime is the lesson itself
 * taking shape: one storyboard panel per scene, lighting up as its narration
 * is recorded, then the whole strip sweeping while the render runs. Every
 * piece of it is driven by real progress — the panel count is the script's
 * actual scene count, not a guess.
 */

const POLL_MS = 1500;

/** Ordered, so a stage can be compared against the one the strip is showing. */
const STAGES: LessonStage[] = ["script", "narration", "images", "composing", "rendering"];

/** Panels drawn before the script comes back and says how many there really are. */
const ASSUMED_SCENES = 5;

export default function LessonCard({
  id,
  topic,
  onSettled,
}: {
  id: string;
  topic: string;
  /** Fired once when the lesson reaches a terminal stage. */
  onSettled?: () => void;
}) {
  const [status, setStatus] = useState<LessonStatus | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let live = true;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const res = await fetch(`/api/lesson?id=${encodeURIComponent(id)}`, { cache: "no-store" });
        if (!live) return;
        if (res.status === 404) {
          setGone(true);
          onSettled?.();
          return;
        }
        const body = (await res.json()) as LessonStatus;
        if (!live) return;
        setStatus(body);
        if (body.stage === "done" || body.stage === "error" || body.stage === "cancelled") {
          onSettled?.();
          return;
        }
        timer = window.setTimeout(poll, POLL_MS);
      } catch {
        if (live) timer = window.setTimeout(poll, POLL_MS);
      }
    };

    void poll();
    return () => {
      live = false;
      if (timer) window.clearTimeout(timer);
    };
    // onSettled is intentionally not a dependency: it changes identity on every
    // parent render, and re-running this would restart the poll each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (gone) return <Note>This video isn&apos;t on disk any more.</Note>;

  if (status?.stage === "error") {
    return (
      <Note tone="var(--bad)">
        <span style={{ fontWeight: 600 }}>Couldn&apos;t make that video</span>
        {status.error ? <span style={{ color: "var(--muted)" }}> — {status.error}</span> : null}
      </Note>
    );
  }

  if (status?.stage === "cancelled") return <Note>Stopped making that video.</Note>;

  if (status?.stage === "done") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10, width: "100%", maxWidth: 560 }}>
        <video
          src={`/api/lesson/video?id=${encodeURIComponent(id)}`}
          controls
          preload="metadata"
          style={{
            width: "100%",
            aspectRatio: "16 / 9",
            borderRadius: "var(--radius-xs)",
            border: "1px solid var(--line)",
            background: "#000",
          }}
        />
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--faint)" }}>
          <Icon path={ICON.check} size={11} style={{ color: "var(--good)" }} />
          {status.title ?? topic}
          {status.durationSec ? ` · ${clock(status.durationSec)}` : ""}
        </span>
      </div>
    );
  }

  return <Building status={status} topic={topic} />;
}

/**
 * The wait, drawn as the thing being waited for.
 *
 * Panels fill left to right as each scene's narration comes back, so the
 * animation is reporting rather than decorating — if it stalls, something has
 * genuinely stalled.
 */
function Building({ status, topic }: { status: LessonStatus | null; topic: string }) {
  const stage = status?.stage ?? "script";
  const total = status?.scenes ?? ASSUMED_SCENES;
  const reached = STAGES.indexOf(stage);

  // "Recording narration (3/6)" is the only place the per-scene count lives.
  const recorded = Number(status?.note.match(/\((\d+)\s*\/\s*\d+\)/)?.[1] ?? 0);
  const filled =
    stage === "narration" ? recorded : reached > STAGES.indexOf("narration") ? total : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10, width: "100%", maxWidth: 560 }}>
      <div
        style={{
          position: "relative",
          aspectRatio: "16 / 9",
          overflow: "hidden",
          borderRadius: "var(--radius-xs)",
          border: "1px solid var(--line)",
          background: "var(--sunken)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 22,
          padding: 24,
        }}
      >
        {/* A slow glow drifting behind everything, so the card is never fully
            static even between stages — the render alone can hold one state
            for half a minute. */}
        <motion.div
          aria-hidden
          animate={{ x: ["-30%", "30%", "-30%"], opacity: [0.5, 0.85, 0.5] }}
          transition={{ duration: 9, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
          style={{
            position: "absolute",
            inset: "-40%",
            background:
              "radial-gradient(closest-side, oklch(0.55 0.11 250 / 0.35), transparent 70%)",
            pointerEvents: "none",
          }}
        />

        {/* Panels share the row rather than each claiming a fixed width: a
            twelve-scene lesson at 46px apiece is wider than the card. */}
        <div style={{ position: "relative", display: "flex", gap: 8, width: "100%", maxWidth: 420 }}>
          {Array.from({ length: total }, (_, i) => (
            <Panel key={i} index={i} filled={i < filled} rendering={stage === "rendering"} />
          ))}
        </div>

        <motion.span
          key={status?.note ?? "start"}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0, backgroundPosition: ["200% center", "-200% center"] }}
          transition={{
            opacity: { duration: 0.25 },
            y: { duration: 0.25 },
            backgroundPosition: { duration: 2.4, ease: "linear", repeat: Number.POSITIVE_INFINITY },
          }}
          style={{
            position: "relative",
            fontSize: 13.5,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            textAlign: "center",
            backgroundImage: "linear-gradient(90deg, var(--muted), var(--text), var(--muted))",
            backgroundSize: "200% 100%",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
          }}
        >
          {status?.note ?? "Writing the lesson"}
        </motion.span>

        <div style={{ position: "relative", display: "flex", gap: 5 }}>
          {STAGES.map((s, i) => (
            <span
              key={s}
              style={{
                width: i <= reached ? 18 : 6,
                height: 3,
                borderRadius: 999,
                background: i <= reached ? "var(--info)" : "var(--line-strong)",
                transition: "width 0.5s ease, background 0.5s ease",
              }}
            />
          ))}
        </div>
      </div>

      <span className="truncate" style={{ fontSize: 11.5, color: "var(--faint)" }}>
        {status?.title ?? topic}
      </span>
    </div>
  );
}

/**
 * One scene. Dim until its narration exists, then it pops in and holds; during
 * the render every panel breathes in sequence, which is the one stage with no
 * per-item progress to report.
 */
function Panel({ index, filled, rendering }: { index: number; filled: boolean; rendering: boolean }) {
  return (
    <motion.span
      initial={false}
      animate={
        rendering
          ? { opacity: [0.35, 1, 0.35], scale: 1 }
          : { opacity: filled ? 1 : 0.28, scale: filled ? 1 : 0.92 }
      }
      transition={
        rendering
          ? { duration: 1.6, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut", delay: index * 0.14 }
          : { type: "spring", stiffness: 320, damping: 22 }
      }
      style={{
        flex: "1 1 0",
        minWidth: 0,
        maxWidth: 46,
        height: 26,
        borderRadius: 5,
        border: "1px solid var(--line-strong)",
        background: filled || rendering ? "var(--info)" : "transparent",
      }}
    />
  );
}

function Note({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return (
    <div
      style={{
        marginTop: 10,
        maxWidth: 560,
        padding: "10px 14px",
        borderRadius: "var(--radius-xs)",
        border: "1px solid var(--line)",
        background: "var(--sunken)",
        fontSize: 12.5,
        lineHeight: 1.45,
        color: tone ?? "var(--muted)",
      }}
    >
      {children}
    </div>
  );
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
