"use client";

import { AgentFace } from "@whirl/components/agent-face";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  IconAlertTriangleFilled,
  IconCheck,
  IconCopy,
  IconPlayerStopFilled,
  IconRefresh,
} from "@tabler/icons-react";
import { useQuery } from "@whirl/backend/react";
import { api } from "@whirl/backend/convex/_generated/api";

import { PaywallView } from "@whirl/components/analytics/paywall-view";
import {
  clearAssistantStream,
  rememberDisplayedAssistantText,
} from "@whirl/lib/assistant-stream";
import {
  assistantActivityState,
  furthestAssistantText,
} from "@whirl/lib/assistant-state";
import {
  isTerminal,
  parseMessageError,
  type ChatMessage,
  type MessageError,
} from "@whirl/lib/messages";
import { buildMessageRenderPlan } from "@whirl/lib/message-render-plan";
import { useIsImageModelKey } from "@whirl/lib/model-catalog";
import { isCompactPhase } from "@whirl/lib/phase-activity";
import { useTypewriter } from "@whirl/lib/use-typewriter";
import { useView } from "@whirl/lib/view";
import { ArtifactActivityScope } from "./artifacts/artifact-activity";
import { CheckpointMenu } from "./checkpoint-menu";
import { GeneratedImageSlot } from "./generated-image";
import { Markdown } from "./markdown";
import { MessageActionButton } from "./message-action-button";
import { MessageStats } from "./message-stats";
import { PhaseActivity } from "./phase-activity";
import { PhaseCards } from "./phase-cards";

/* One assistant turn. Text arrives two ways — the reactive getStreamBody
   query while the (server-driven) turn is in flight, or the finished row
   itself — and either way a typewriter meters the reveal so bursts never
   lurch. Errors ride in as sentinel strings on the content; they render as
   flat banners instead of prose.

   Key instances by `${id}:${streamId}` — a retry swaps the stream and the
   typewriter should start over. */

const GATE_COPY: Record<string, string> = {
  usage: "You're out of included usage for now.",
  messages: "You've hit your message limit for now.",
  reasoning: "Thinking is a paid feature.",
  can_search: "Web search is a paid feature.",
  files: "File uploads on this model need a paid plan.",
  auto: "That model needs a paid plan.",
  basic: "That model needs a paid plan.",
  max: "That model needs a paid plan.",
  image: "Image generation needs a paid plan.",
  compact: "This conversation has outgrown the free plan.",
};

export function AssistantMessage({
  message,
  onRetry,
  onBranch,
  onRollback,
}: {
  message: ChatMessage;
  /** Reset this reply and run it again — absent (debug page, other tabs'
   *  live turns) hides the retry affordances. */
  onRetry?: () => void;
  /** Copy the thread up to here into a fresh one — absent hides the
   *  checkpoint menu entirely. */
  onBranch?: () => void;
  /** Delete everything after this reply — absent (nothing follows, or a
   *  reply is mid-flight) hides the rollback item. */
  onRollback?: () => void;
}) {
  const terminal = isTerminal(message.status);

  /* Whether this mount caught the message mid-flight — old messages paint
     instantly, live ones type. Captured once: a retry remounts (the
     transcript keys on streamId), so a terminal message can't come back
     to life inside one mount. */
  const [sawLive] = useState(!terminal);

  /* The reply body, live from the server-driven stream. Every tab is "just
     another tab" now — the same subscription serves the sender, other
     windows, and reloads alike. */
  const persisted = useQuery(
    api.messages.getStreamBody,
    !terminal && message.streamId ? { streamId: message.streamId } : "skip",
  ) as { text: string; status: string } | undefined;

  /* Keep both snapshots in play during the terminal handoff — the finished
     row and the stream body can lead each other by a render or two. */
  const sourceText = terminal
    ? message.content
    : furthestAssistantText(persisted?.text, message.content);
  const stopped = message.status === "stopped";
  const { text, caughtUp } = useTypewriter(sourceText, sawLive, stopped);

  /* Stop is handled outside this component. Keep its action layer informed
     of the exact committed typewriter frame so it can freeze here instead
     of persisting the network buffer that has not been shown yet. */
  useLayoutEffect(() => {
    if (!message.streamId || terminal) return;
    rememberDisplayedAssistantText(message.streamId, text);
  }, [message.streamId, terminal, text]);

  /* Release the stream record when this mount stops being the live view of
     it — settling, retrying onto a fresh stream, or unmounting entirely.
     The cleanup shape matters: hopping threads (or heading home) mid-reply
     unmounts before terminal ever lands here, and clearing only on the
     settled render stranded the full painted text in the module Map for
     the rest of the session, one reply at a time. */
  useEffect(() => {
    const streamId = message.streamId;
    if (!streamId || terminal) return;
    return () => clearAssistantStream(streamId);
  }, [terminal, message.streamId]);

  const streamFailed =
    persisted?.status === "error" || persisted?.status === "timeout";
  const error: MessageError | null =
    message.status === "error"
      ? parseMessageError(message.content)
      : streamFailed
        ? { kind: "generic" }
        : null;

  /* Artifact cards report "visibly working" up here (including stretches
     only their live rows know about), so the pending shimmer below never
     doubles up with a card's own progress bar. */
  const workingIdsRef = useRef<Set<string>>(new Set());
  const [workingCards, setWorkingCards] = useState(0);
  const reportWorking = useCallback((id: string, working: boolean) => {
    const ids = workingIdsRef.current;
    if (working) ids.add(id);
    else ids.delete(id);
    setWorkingCards(ids.size);
  }, []);

  const streamingNow = !terminal && !error;
  const showText = !error && text.length > 0;
  /* Replies from painting models — the Image tier or an imageOutput
     catalog model — land in the attachment slot; its shimmer square holds
     the space, so the pending verb below stays quiet. */
  const paintingModel = useIsImageModelKey(message.model);
  const imageTurn =
    !error &&
    (paintingModel ||
      (message.attachments ?? []).some(
        (attachment) =>
          attachment.type.startsWith("image/") && attachment.url,
      ));
  /* A paint in flight shows its own shimmer square (phase-cards.tsx) —
     the pending verb below would double it up. */
  const paintingNow = (message.phases ?? []).some(
    (phase) => phase.kind === "image" && phase.pending,
  );
  const richPhaseWorking = (message.phases ?? []).some(
    (phase) =>
      phase.pending &&
      (phase.kind === "document" ||
        phase.kind === "html" ||
        phase.kind === "image"),
  );
  /* Once compact tool work begins, its activity stays in progress through
     inter-call gaps. Only the terminal message update settles the summary;
     rich cards may temporarily own the progress surface themselves. */
  const richerActivityWorking =
    workingCards > 0 || imageTurn || paintingNow || richPhaseWorking;
  const {
    active: activityActive,
    settled: activitySettled,
  } = assistantActivityState({
    phases: message.phases ?? [],
    terminal,
    canShowActivity: streamingNow,
    showText,
    richerActivityWorking,
  });
  const renderableText = error ? "" : text;
  const renderPlan = useMemo(
    () => buildMessageRenderPlan(renderableText, message.phases ?? []),
    [message.phases, renderableText],
  );
  const hasCompactItems = renderPlan.some(
    (item) =>
      item.type === "group" ||
      (item.type === "phase" && isCompactPhase(item.phase)),
  );
  /* The live indicator is ONE persistent element (the slot after the plan
     below) so phase-to-phase changes morph in place. Keyed plan items
     remount as the plan restructures (phase-0 + phase-1 collapse into
     group-0, a single grows into a group), which replaced the icon and
     label instantly on every transition. The last compact run renders
     through the slot — live and settled, so the final morph stays in
     place too — for as long as only prose follows it; anything later (a
     rich card, a newer run) sends it back to the plan as a settled row. */
  let lastNonTextIndex = -1;
  for (let i = renderPlan.length - 1; i >= 0; i--) {
    if (renderPlan[i].type !== "text") {
      lastNonTextIndex = i;
      break;
    }
  }
  const lastNonTextItem =
    lastNonTextIndex >= 0 ? renderPlan[lastNonTextIndex] : undefined;
  const ownedIndex =
    lastNonTextItem &&
    (lastNonTextItem.type === "group" ||
      (lastNonTextItem.type === "phase" && isCompactPhase(lastNonTextItem.phase)))
      ? lastNonTextIndex
      : -1;
  const ownedItem = ownedIndex >= 0 ? renderPlan[ownedIndex] : undefined;
  const ownedPhases =
    ownedItem?.type === "group"
      ? ownedItem.phases.map(({ phase }) => phase)
      : ownedItem?.type === "phase"
        ? [ownedItem.phase]
        : undefined;
  const ownedIsTrailing = ownedIndex === renderPlan.length - 1;

  /* Stable key = stable element: React matches it across renders even as
     its position in the children array shifts, so the indicator survives
     every plan restructure and its AnimatePresence gets to morph. */
  const liveActivity = (
    <div
      key="live-activity"
      className={
        ownedIndex > 0 && renderPlan[ownedIndex - 1]?.type === "text"
          ? "mt-1.5 w-full min-w-0"
          : "w-full min-w-0"
      }
    >
      <PhaseActivity
        phases={ownedPhases ?? message.phases ?? []}
        status={message.status}
        thinking={message.thinking === true}
        active={(ownedItem ? ownedIsTrailing : true) && activityActive}
        settled={
          ownedItem ? !ownedIsTrailing || activitySettled : activitySettled
        }
        animate={sawLive}
      />
    </div>
  );

  const planChildren = renderPlan.map((item, index) => {
    if (index === ownedIndex) return liveActivity;
    if (item.type === "text") {
      const trailing =
        item.startOffset + item.text.length >= renderableText.length;
      return (
        <Markdown
          key={item.key}
          streaming={(streamingNow || !caughtUp) && trailing}
        >
          {item.text}
        </Markdown>
      );
    }

    const afterText = index > 0 && renderPlan[index - 1]?.type === "text";
    const wrapperClass = afterText
      ? "mt-1.5 w-full min-w-0"
      : "w-full min-w-0";
    if (item.type === "group") {
      return (
        <div key={item.key} className={wrapperClass}>
          <PhaseActivity
            phases={item.phases.map(({ phase }) => phase)}
            status={message.status}
            thinking={message.thinking === true}
            active={false}
            settled
            animate={sawLive}
          />
        </div>
      );
    }
    if (isCompactPhase(item.phase)) {
      return (
        <div key={item.key} className={wrapperClass}>
          <PhaseActivity
            phases={[item.phase]}
            status={message.status}
            thinking={message.thinking === true}
            active={false}
            settled
            animate={sawLive}
          />
        </div>
      );
    }
    return (
      <div key={item.key} className={wrapperClass}>
        <PhaseCards
          phases={[item.phase]}
          animate={sawLive}
          /* Thread position: phases from later messages always outrank
             earlier ones, and the index breaks ties within a turn. */
          order={message.createdAt + item.index / 1000}
          messageTerminal={terminal}
          messageId={message.id}
          phaseIndex={item.index}
        />
      </div>
    );
  });
  /* No compact run owns the slot yet (fresh turn, or a prose-only reply):
     the indicator still mounts — in the same keyed array, so the spinner
     morphs into the first phase instead of being replaced. */
  if (!ownedItem && !hasCompactItems) planChildren.push(liveActivity);

  return (
    <div
      data-quotable="assistant"
      className="group/msg flex w-full min-w-0 flex-col items-start"
    >
      {/* The agent layer: who's answering. In a group chat several do. */}
      {message.agent && (
        <div className="mb-1.5 flex items-center gap-2 text-[13px]/4 font-medium text-foreground-soft">
          <AgentFace name={message.agent.name} hue={message.agent.hue} size={20} />
          {message.agent.name}
        </div>
      )}
      <ArtifactActivityScope report={reportWorking}>
        {planChildren}
      </ArtifactActivityScope>
      {imageTurn && <GeneratedImageSlot message={message} />}
      {error && <ErrorBanner error={error} onRetry={onRetry} />}
      {message.status === "stopped" && (
        <div className="mt-2 flex items-center gap-1.5 text-[13px]/4 font-medium text-muted-foreground">
          <IconPlayerStopFilled size={12} />
          Stopped
        </div>
      )}
      {!terminal && showText && (
        /* The completed hover controls are mt-1.5 + h-7. Reserve that exact
           footprint while prose streams so their terminal-state mount cannot
           change the message height or kick the scroll anchor. */
        <div aria-hidden className="mt-1.5 h-7" />
      )}
      {terminal && !error && (
        <MessageActions
          message={message}
          onRetry={onRetry}
          onBranch={onBranch}
          onRollback={onRollback}
        />
      )}
    </div>
  );
}

function ErrorBanner({
  error,
  onRetry,
}: {
  error: MessageError;
  onRetry?: () => void;
}) {
  const { openPricing } = useView();
  const gate = error.kind === "gate";
  const headline = gate
    ? (GATE_COPY[error.feature] ?? "That needs a paid plan.")
    : error.kind === "overload"
      ? "Whirl is a little overloaded right now."
      : "Something went wrong.";
  const subline = gate
    ? "Upgrade to keep going, or switch things up."
    : error.kind === "overload"
      ? "Give it a moment and try again."
      : (error.detail ?? "The reply didn't make it. Try again?");

  return (
    <div className="flex w-full max-w-md flex-col gap-3 rounded-2xl bg-well px-4 py-3.5 shadow-[inset_0_0_0_1px_var(--well-outline),inset_0_1px_0_0_var(--well-highlight)]">
      {/* A gate banner is a paywall like any other — it's where most people
          meet one first, one message past the ceiling. */}
      {gate && <PaywallView source="thread_gate_banner" gate={error.feature} />}
      <div className="flex items-start gap-2.5">
        <IconAlertTriangleFilled
          size={17}
          className="mt-0.5 shrink-0 text-muted-foreground"
        />
        <div className="min-w-0">
          <div className="text-[14px]/5 font-medium">{headline}</div>
          <div className="mt-0.5 text-[13px]/5 text-muted-foreground">
            {subline}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 pl-[27.5px]">
        {gate ? (
          <button
            type="button"
            onClick={openPricing}
            className="cursor-pointer rounded-full bg-primary px-3 py-1.5 text-[13px]/4 font-medium text-primary-foreground transition-[background-color,scale] duration-150 hover:bg-(--primary-hover) active:scale-[0.96]"
          >
            See plans
          </button>
        ) : (
          onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="cursor-pointer rounded-full bg-primary px-3 py-1.5 text-[13px]/4 font-medium text-primary-foreground transition-[background-color,scale] duration-150 hover:bg-(--primary-hover) active:scale-[0.96]"
            >
              Try again
            </button>
          )
        )}
      </div>
    </div>
  );
}

function MessageActions({
  message,
  onRetry,
  onBranch,
  onRollback,
}: {
  message: ChatMessage;
  onRetry?: () => void;
  onBranch?: () => void;
  onRollback?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const text = message.content;
  const canCopy = text.length > 0;
  const hasStats =
    message.outputTokens !== undefined ||
    message.durationMs !== undefined ||
    message.usageCost !== undefined;
  if (!canCopy && !onRetry && !onBranch && !hasStats) return null;

  return (
    /* has-data-popup-open keeps the row lit while the checkpoint menu is
       up — the pointer is off in the portal by then. */
    <div className="mt-1.5 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/msg:opacity-100 focus-within:opacity-100 has-data-popup-open:opacity-100 coarse:opacity-100">
      {canCopy && (
        <MessageActionButton
          label="Copy message"
          tooltip={copied ? "Copied" : "Copy message"}
          onClick={() => {
            navigator.clipboard
              .writeText(text)
              .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
              .catch(() => {});
          }}
        >
          {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
        </MessageActionButton>
      )}
      {onRetry && (
        <MessageActionButton label="Retry message" onClick={onRetry}>
          <IconRefresh size={15} />
        </MessageActionButton>
      )}
      {onBranch && <CheckpointMenu onBranch={onBranch} onRollback={onRollback} />}
      <MessageStats
        outputTokens={message.outputTokens}
        durationMs={message.durationMs}
        usageCost={message.usageCost}
      />
    </div>
  );
}
