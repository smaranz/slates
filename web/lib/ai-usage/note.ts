import "server-only";

import type { LanguageModelUsage } from "ai";

import { estimatePrice } from "./rates";
import { activePlanId, appendEvent } from "./store";
import type { UsageAgent, UsageEvent, UsageProvider, UsageUnit } from "./types";
import { backendToProvider } from "./types";

/**
 * Append one usage event. Never throws into the request path — a ledger miss
 * is not worth failing a tutor reply over.
 */

function uid(): string {
  return `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export interface NoteUsageInput {
  agent: UsageAgent;
  model: string;
  backend: UsageProvider | string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  unit?: UsageUnit;
  /** Override covered; defaults to true for claude-code / cursor. */
  covered?: boolean;
  planId?: string | null;
}

export function noteUsage(input: NoteUsageInput): void {
  try {
    const backend = backendToProvider(String(input.backend));
    const covered =
      input.covered ?? (backend === "claude-code" || backend === "cursor");
    const unit = input.unit ?? "tokens";
    const inputTokens = Math.max(0, Math.floor(input.inputTokens ?? 0));
    const outputTokens = Math.max(0, Math.floor(input.outputTokens ?? 0));
    const reasoningTokens = Math.max(0, Math.floor(input.reasoningTokens ?? 0));
    const cacheReadTokens = Math.max(0, Math.floor(input.cacheReadTokens ?? 0));

    const price = estimatePrice({
      model: input.model,
      inputTokens,
      outputTokens,
      unit,
      covered,
    });

    const event: UsageEvent = {
      id: uid(),
      at: Date.now(),
      agent: input.agent,
      model: input.model,
      backend,
      planId: input.planId !== undefined ? input.planId : activePlanId(backend),
      inputTokens,
      outputTokens,
      reasoningTokens,
      cacheReadTokens,
      costUsd: price.costUsd,
      listUsd: price.listUsd,
      covered: price.covered,
      unit: price.unit,
    };
    appendEvent(event);
  } catch (err) {
    console.error("[ai-usage] noteUsage failed", err);
  }
}

/** Record from an AI SDK LanguageModelUsage object. */
export function noteFromUsage(
  agent: UsageAgent,
  model: string,
  backend: UsageProvider | string,
  usage: LanguageModelUsage | null | undefined
): void {
  if (!usage) {
    noteUsage({ agent, model, backend, inputTokens: 0, outputTokens: 0 });
    return;
  }
  noteUsage({
    agent,
    model,
    backend,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? 0,
    cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
  });
}

/**
 * Fire-and-forget for streamText's PromiseLike totalUsage — never await this
 * on the request path.
 */
export function noteStreamUsage(
  agent: UsageAgent,
  model: string,
  backend: UsageProvider | string,
  totalUsage: PromiseLike<LanguageModelUsage>
): void {
  void Promise.resolve(totalUsage)
    .then((u) => noteFromUsage(agent, model, backend, u))
    .catch(() => {});
}
