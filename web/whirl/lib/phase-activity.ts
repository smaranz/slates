import type { MessagePhase, MessageStatus } from "./messages";

const COMPACT_KINDS = new Set([
  "thought",
  "search",
  "fetch",
  "calc",
  "mcp",
  "skill",
  "history",
  "agentTool",
]);

/** Phases that belong inside the completed activity disclosure. Rich artifact
 * and weather phases keep their purpose-built cards instead. */
export function isCompactPhase(phase: MessagePhase): boolean {
  if (COMPACT_KINDS.has(phase.kind)) return true;
  /* A chart in the making is a line of activity, not a card: the spec arrives
     whole, so a skeleton the size of the finished plot would only stand there
     holding empty space. It narrates like any other tool, then hands over to
     the card the moment the numbers land. */
  if (phase.kind === "chart") return phase.pending === true;
  return (
    phase.kind === "image" &&
    !phase.pending &&
    (phase.images?.length ?? 0) === 0
  );
}

export function compactPhases(phases: MessagePhase[]): MessagePhase[] {
  return phases.filter(isCompactPhase);
}

/**
 * Whether two phase lists hold the same phases.
 *
 * Phase objects are carried across snapshots by reference
 * (lib/message-identity.ts), but the little arrays a render plan slices them
 * into are rebuilt every time the reply grows a character. Comparing element
 * by element is what lets the settled rows and cards above a streaming tail
 * memoize — otherwise every chart, card and disclosure in the turn
 * re-renders on every typewriter tick.
 */
export function samePhases(
  previous: readonly MessagePhase[],
  next: readonly MessagePhase[],
): boolean {
  if (previous === next) return true;
  if (previous.length !== next.length) return false;
  for (let i = 0; i < previous.length; i += 1) {
    if (previous[i] !== next[i]) return false;
  }
  return true;
}

/** The latest phase is the thing the large pre-response indicator narrates.
 * A just-finished call remains current through the tiny gap before the next
 * one starts, avoiding a generic filler flash between chained tools. */
export function currentPhase(
  phases: MessagePhase[],
): MessagePhase | undefined {
  return [...phases]
    .reverse()
    .find(
      (phase) =>
        isCompactPhase(phase) ||
        phase.kind === "weather" ||
        phase.kind === "chart" ||
        phase.kind === "integrationSuggestion" ||
        phase.kind === "question",
    );
}

export function phaseAction(
  phase: MessagePhase | undefined,
  status: MessageStatus | undefined,
  thinking: boolean,
): string | null {
  if (!phase) {
    if (status === "searching") return "Searching the web";
    return thinking ? "Thinking" : null;
  }

  switch (phase.kind) {
    case "thought":
      return thinking ? "Thinking" : null;
    case "search":
      return "Searching the web";
    case "fetch":
      return "Reading sources";
    case "calc":
      return "Calculating";
    case "mcp":
      if (phase.action?.trim()) return phase.action.trim();
      /* No server yet means the tool identity hasn't streamed in — a
         generic "connected app" line reads as stuck. Working… holds the
         spot and morphs into the real status the moment it lands. */
      return phase.server ? `Using ${phase.server}` : "Working…";
    case "skill":
      return phase.name ? `Learning ${phase.name}` : "Learning a skill";
    case "history":
      return "Searching your chats";
    case "integrationSuggestion":
      return "Browsing integrations";
    case "question":
      return "Putting a question together";
    case "weather":
      return "Checking the weather";
    case "chart":
      return "Plotting the numbers";
    case "image":
      return "Painting an image";
    case "agentTool":
      return phase.label ?? "Working…";
    default:
      return null;
  }
}

export function completedLabel(phase: MessagePhase): string {
  switch (phase.kind) {
    case "thought": {
      const seconds = phase.durationMs
        ? Math.max(1, Math.round(phase.durationMs / 1000))
        : null;
      return seconds
        ? `Thought for ${seconds} second${seconds === 1 ? "" : "s"}`
        : "Thought it over";
    }
    case "search": {
      const count = phase.sources ?? phase.items?.length ?? 0;
      return `Searched ${count} source${count === 1 ? "" : "s"}`;
    }
    case "fetch": {
      const count = phase.sources ?? phase.items?.length ?? 0;
      return `Read ${count} page${count === 1 ? "" : "s"}`;
    }
    case "calc":
      return phase.error
        ? "Couldn't calculate"
        : phase.label
          ? `Calculated ${phase.label}`
          : "Calculated";
    case "mcp":
      if (phase.ok === false) {
        return `Couldn't reach ${phase.server ?? "that tool"}`;
      }
      if (phase.completed?.trim()) return phase.completed.trim();
      if (phase.tool === "mcp_list_tools") {
        return phase.server
          ? `Checked ${phase.server}`
          : "Checked a connected app";
      }
      if (phase.server && phase.tool) {
        return `Used ${phase.server} · ${phase.tool}`;
      }
      return phase.server ? `Used ${phase.server}` : "Used a connected app";
    case "skill":
      return phase.ok === false
        ? `Couldn't load ${phase.name ?? "that skill"}`
        : phase.name
          ? `Learned ${phase.name}`
          : "Learned a skill";
    case "history": {
      const count = phase.matches ?? 0;
      return count
        ? `Found ${count} past message${count === 1 ? "" : "s"}`
        : "Searched your chats";
    }
    case "chart":
      return phase.chart ? `Charted ${phase.chart.title}` : "Drew a chart";
    case "image":
      return phase.ok === false ? "Couldn't paint that" : "Painted an image";
    case "question":
      return "Asked you a question";
    case "agentTool":
      return phase.status === "error" ? `${phase.label ?? "A step"} (failed)` : (phase.label ?? "Finished a step");
    default:
      return "Finished a task";
  }
}

/** Prefer the phase snapshot; live listing metadata only repairs legacy rows. */
export function integrationPhaseAction(
  phase: MessagePhase | undefined,
  status: MessageStatus | undefined,
  thinking: boolean,
  legacyAction?: string,
): string | null {
  if (phase?.kind === "mcp") {
    const snapshot = phase.action?.trim();
    if (snapshot) return snapshot;
    const legacy = legacyAction?.trim();
    if (legacy) return legacy;
  }
  return phaseAction(phase, status, thinking);
}

/** Prefer the phase snapshot; live listing metadata only repairs legacy rows. */
export function integrationCompletedLabel(
  phase: MessagePhase,
  legacyCompleted?: string,
): string {
  if (phase.kind === "mcp" && phase.ok !== false) {
    const snapshot = phase.completed?.trim();
    if (snapshot) return snapshot;
    const legacy = legacyCompleted?.trim();
    if (legacy) return legacy;
  }
  return completedLabel(phase);
}
