import type { MessagePhase } from "./messages";
import { isCompactPhase } from "./phase-activity";

/** Pick the furthest append-only stream snapshot. Local HTTP text remains in
 * the candidate set while the persisted Convex body catches up, so switching
 * sources cannot briefly shrink a visible reply. */
export function furthestAssistantText(
  ...candidates: Array<string | undefined>
): string {
  return candidates.reduce<string>(
    (furthest, candidate) =>
      candidate !== undefined && candidate.length > furthest.length
        ? candidate
        : furthest,
    "",
  );
}

export function assistantActivityState({
  phases,
  terminal,
  canShowActivity,
  showText,
  richerActivityWorking,
}: {
  phases: MessagePhase[];
  terminal: boolean;
  canShowActivity: boolean;
  showText: boolean;
  richerActivityWorking: boolean;
}): {
  active: boolean;
  settled: boolean;
} {
  const compact = phases.filter(isCompactPhase);
  const compactWorking = compact.some((phase) => phase.pending);
  const compactTurnInProgress = compact.length > 0 && !richerActivityWorking;

  return {
    active:
      canShowActivity &&
      (compactWorking ||
        compactTurnInProgress ||
        (!showText && !richerActivityWorking)),
    settled: terminal || (showText && compact.length === 0),
  };
}
