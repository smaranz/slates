import type { MessagePhase } from "./messages";
import { isCompactPhase } from "./phase-activity";

type PositionedPhase = {
  phase: MessagePhase;
  index: number;
};

type Segment = {
  startOffset: number;
  text: string;
  phaseAfter?: PositionedPhase;
};

export type PhasePlanEntry = PositionedPhase;

export type MessageRenderItem =
  | { type: "text"; key: string; text: string; startOffset: number }
  | { type: "phase"; key: string; phase: MessagePhase; index: number }
  | { type: "group"; key: string; phases: PhasePlanEntry[] };

/* Thoughts can sit inside a tool run, but a thought-and-one-tool pair keeps
   the familiar flat presentation. Anything more — two tools, or a lone tool
   with thoughts on both sides — collapses into a stack. */
const TOOL_KINDS = new Set([
  "search",
  "fetch",
  "calc",
  "mcp",
  "skill",
  "history",
  "agentTool",
]);

function buildSegments(content: string, phases: MessagePhase[]) {
  const positioned = phases
    .map((phase, index) => ({
      phase,
      index,
      offset: phase.contentOffset,
    }))
    .filter(
      (
        entry,
      ): entry is PositionedPhase & {
        offset: number;
      } => typeof entry.offset === "number",
    )
    .sort((a, b) => a.offset - b.offset);
  const tail = phases
    .map((phase, index) => ({ phase, index }))
    .filter(({ phase }) => typeof phase.contentOffset !== "number");

  const segments: Segment[] = [];
  let cursor = 0;
  for (const { phase, index, offset } of positioned) {
    const clamped = Math.max(cursor, Math.min(offset, content.length));
    segments.push({
      startOffset: cursor,
      text: content.slice(cursor, clamped),
      phaseAfter: { phase, index },
    });
    cursor = clamped;
  }
  segments.push({
    startOffset: cursor,
    text: content.slice(cursor),
  });

  return { segments, tail };
}

/** Flatten a reply into its visual timeline. Phases land at contentOffset,
 * prose ends the current compact run, and rich phases remain standalone so
 * their purpose-built cards can render in place. */
export function buildMessageRenderPlan(
  content: string,
  phases: MessagePhase[],
): MessageRenderItem[] {
  const { segments, tail } = buildSegments(content, phases);
  const items: MessageRenderItem[] = [];
  let run: PhasePlanEntry[] = [];

  const flushRun = () => {
    if (run.length === 0) return;
    const toolCount = run.filter(({ phase }) =>
      TOOL_KINDS.has(phase.kind),
    ).length;
    /* Two tools is always a chain. A lone tool escapes the stack only as
       part of the classic thought-then-tool pair — once a third phase
       joins the run (thought, tool, thought again) it reads as loose
       rows, so it collapses too. */
    if (toolCount >= 2 || (toolCount >= 1 && run.length >= 3)) {
      items.push({
        type: "group",
        key: `group-${run[0].index}`,
        phases: run,
      });
    } else {
      for (const { phase, index } of run) {
        items.push({
          type: "phase",
          key: `phase-${index}`,
          phase,
          index,
        });
      }
    }
    run = [];
  };

  const pushPhase = (phase: MessagePhase, index: number) => {
    if (isCompactPhase(phase)) {
      run.push({ phase, index });
      return;
    }
    flushRun();
    items.push({
      type: "phase",
      key: `phase-${index}`,
      phase,
      index,
    });
  };

  for (const segment of segments) {
    if (segment.text.trim().length > 0) {
      flushRun();
      items.push({
        type: "text",
        key: `text-${segment.startOffset}`,
        text: segment.text,
        startOffset: segment.startOffset,
      });
    }
    if (segment.phaseAfter) {
      pushPhase(segment.phaseAfter.phase, segment.phaseAfter.index);
    }
  }
  for (const { phase, index } of tail) pushPhase(phase, index);
  flushRun();

  return items;
}
