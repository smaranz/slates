"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { MessagePhase, MessageStatus } from "./messages";

const PHASE_HOLD_MS = 1100;
const SPINNER_HOLD_MS = 250;

export type PhaseNarration =
  | {
      mode: "hidden";
      key: "hidden";
      holdMs: 0;
    }
  | {
      mode: "final";
      key: string;
      holdMs: 0;
    }
  | {
      mode: "live";
      key: string;
      holdMs: number;
      phase: MessagePhase | undefined;
      status: MessageStatus | undefined;
      thinking: boolean;
    };

function phaseKey(
  phase: MessagePhase | undefined,
  status: MessageStatus | undefined,
  thinking: boolean,
): string {
  if (!phase) {
    if (status === "searching") return "searching";
    if (thinking) return "thinking";
    return "spinner";
  }
  if (phase.kind === "mcp") {
    return `mcp:${phase.server ?? ""}:${phase.tool ?? ""}`;
  }
  if (phase.kind === "skill") return `skill:${phase.name ?? ""}`;
  return phase.kind;
}

export function phaseNarrationTarget({
  phase,
  status,
  thinking,
  active,
  settled,
  phaseCount,
}: {
  phase: MessagePhase | undefined;
  status: MessageStatus | undefined;
  thinking: boolean;
  active: boolean;
  settled: boolean;
  phaseCount: number;
}): PhaseNarration {
  if (settled && phaseCount > 0) {
    return {
      mode: "final",
      key: `final:${phaseCount}`,
      holdMs: 0,
    };
  }
  if (!active || settled) {
    return { mode: "hidden", key: "hidden", holdMs: 0 };
  }

  const substantive = Boolean(phase || thinking || status === "searching");
  return {
    mode: "live",
    key: `live:${phaseKey(phase, status, thinking)}`,
    holdMs: substantive ? PHASE_HOLD_MS : SPINNER_HOLD_MS,
    phase,
    status,
    thinking,
  };
}

/**
 * Gives live activity enough time to be read. A burst keeps the currently
 * visible phase plus the newest queued phase, then settles into the final
 * summary. This bounds the delay while preventing sub-second tool calls from
 * flashing past unseen.
 */
export function useSteadyPhaseNarration(
  target: PhaseNarration,
  animate: boolean,
): PhaseNarration {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  const shownAtRef = useRef(0);
  const queueRef = useRef<PhaseNarration[]>([]);
  const timerRef = useRef<number | undefined>(undefined);

  const show = useCallback((next: PhaseNarration) => {
    shownRef.current = next;
    shownAtRef.current = Date.now();
    setShown(next);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current === undefined) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
  }, []);

  const schedule = useCallback(() => {
    if (timerRef.current !== undefined || queueRef.current.length === 0) {
      return;
    }
    const elapsed = Date.now() - shownAtRef.current;
    const wait = Math.max(shownRef.current.holdMs - elapsed, 0);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = undefined;
      const next = queueRef.current.shift();
      if (next) show(next);
    }, wait);
  }, [show]);

  useEffect(() => {
    if (!animate || target.mode === "hidden") {
      clearTimer();
      queueRef.current = [];
      if (
        shownRef.current.key !== target.key ||
        shownRef.current.mode !== target.mode
      ) {
        show(target);
      }
      return;
    }

    if (
      shownRef.current.key === target.key &&
      shownRef.current.mode === target.mode
    ) {
      queueRef.current = queueRef.current.filter(
        (item) => item.mode === "final",
      );
      schedule();
      return;
    }

    const queue = queueRef.current;
    if (target.mode === "final") {
      const finalIndex = queue.findIndex((item) => item.mode === "final");
      if (finalIndex >= 0) queue[finalIndex] = target;
      else queue.push(target);
    } else {
      const finalIndex = queue.findIndex((item) => item.mode === "final");
      if (finalIndex === 0) queue.unshift(target);
      else if (finalIndex > 0) queue[finalIndex - 1] = target;
      else if (queue.length > 0) queue[queue.length - 1] = target;
      else queue.push(target);
    }
    schedule();
  }, [animate, clearTimer, schedule, show, target]);

  useEffect(() => {
    schedule();
  }, [schedule, shown]);

  useEffect(() => {
    shownAtRef.current = Date.now();
    return () => {
      clearTimer();
      queueRef.current = [];
    };
  }, [clearTimer]);

  return shown;
}
