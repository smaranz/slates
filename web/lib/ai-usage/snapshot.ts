import "server-only";

import { activeApiSecret, cliResolves, monthlyPlanUsd, publicPlans, readEvents } from "./store";
import {
  AGENT_LABEL,
  AGENT_PROVIDERS,
  ALL_AGENTS,
  PROVIDER_LABEL,
  type AgentRow,
  type ConnectionRow,
  type DayBucket,
  type ModelRow,
  type PublicPlan,
  type UsageAgent,
  type UsageProvider,
  type UsageUnitTotals,
  type UsageRange,
  type UsageSnapshot,
} from "./types";

export type { UsageSnapshot };

function rangeStart(range: UsageRange, now: number): number {
  if (range === "all") return 0;
  if (range === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  const days = range === "7d" ? 7 : 30;
  return now - days * 24 * 60 * 60 * 1000;
}

function providerStatus(provider: UsageProvider, plans: PublicPlan[]): "active" | "standby" | "missing" {
  const matching = plans.filter((p) => p.provider === provider);
  if (matching.some((p) => p.active)) return "active";

  if (provider === "claude-code") {
    return cliResolves("claude") || matching.length ? "standby" : "missing";
  }
  if (provider === "cursor") {
    return cliResolves("cursor-agent") || matching.length ? "standby" : "missing";
  }
  if (activeApiSecret(provider) || matching.length) return "standby";
  return "missing";
}

function dayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function emptyUnitTotals(): UsageUnitTotals {
  return { tokens: 0, characters: 0, images: 0, seconds: 0 };
}

export function buildSnapshot(range: UsageRange = "30d"): UsageSnapshot {
  const now = Date.now();
  const start = rangeStart(range, now);
  const events = readEvents().filter((e) => e.at >= start);
  const plans = publicPlans();

  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let listUsd = 0;
  const unitTotals = emptyUnitTotals();

  const agentMap = new Map<UsageAgent, { input: number; output: number; cost: number; calls: number; unitTotals: UsageUnitTotals }>();
  for (const a of ALL_AGENTS) agentMap.set(a, { input: 0, output: 0, cost: 0, calls: 0, unitTotals: emptyUnitTotals() });

  const modelMap = new Map<string, { tokens: number; cost: number; calls: number; unitTotals: UsageUnitTotals }>();
  const dayMap = new Map<string, DayBucket>();

  for (const e of events) {
    const quantity = e.inputTokens + e.outputTokens;
    unitTotals[e.unit] += quantity;
    if (e.unit === "tokens") {
      inputTokens += e.inputTokens;
      outputTokens += e.outputTokens;
    }
    costUsd += e.costUsd;
    listUsd += e.listUsd;

    const ag = agentMap.get(e.agent) ?? { input: 0, output: 0, cost: 0, calls: 0, unitTotals: emptyUnitTotals() };
    ag.unitTotals[e.unit] += quantity;
    if (e.unit === "tokens") {
      ag.input += e.inputTokens;
      ag.output += e.outputTokens;
    }
    ag.cost += e.costUsd;
    ag.calls += 1;
    agentMap.set(e.agent, ag);

    const mo = modelMap.get(e.model) ?? { tokens: 0, cost: 0, calls: 0, unitTotals: emptyUnitTotals() };
    mo.unitTotals[e.unit] += quantity;
    if (e.unit === "tokens") mo.tokens += quantity;
    mo.cost += e.costUsd;
    mo.calls += 1;
    modelMap.set(e.model, mo);

    const key = dayKey(e.at);
    const day = dayMap.get(key) ?? { day: key, tokens: 0, costUsd: 0, calls: 0, unitTotals: emptyUnitTotals() };
    day.unitTotals[e.unit] += quantity;
    if (e.unit === "tokens") day.tokens += quantity;
    day.costUsd += e.costUsd;
    day.calls += 1;
    dayMap.set(key, day);
  }

  const byAgent: AgentRow[] = ALL_AGENTS.map((agent) => {
    const row = agentMap.get(agent)!;
    const providers = AGENT_PROVIDERS[agent].map((provider) => ({
      provider,
      label: PROVIDER_LABEL[provider],
      status: providerStatus(provider, plans),
    }));
    return {
      agent,
      label: AGENT_LABEL[agent],
      inputTokens: row.input,
      outputTokens: row.output,
      tokens: row.input + row.output,
      unitTotals: row.unitTotals,
      costUsd: row.cost,
      calls: row.calls,
      providers,
    };
  });

  const byModel: ModelRow[] = [...modelMap.entries()]
    .map(([model, v]) => ({ model, tokens: v.tokens, unitTotals: v.unitTotals, costUsd: v.cost, calls: v.calls }))
    .sort((a, b) => b.tokens - a.tokens || b.costUsd - a.costUsd)
    .slice(0, 20);

  const days = [...dayMap.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-30);

  const recent = [...events].sort((a, b) => b.at - a.at).slice(0, 25);

  const connections: ConnectionRow[] = byAgent.map(({ agent, label, providers }) => ({
    agent,
    label,
    providers,
  }));

  return {
    range,
    totals: {
      inputTokens,
      outputTokens,
      tokens: inputTokens + outputTokens,
      unitTotals,
      costUsd,
      listUsd,
      calls: events.length,
    },
    monthlyUsd: monthlyPlanUsd(plans),
    byAgent,
    byModel,
    recent,
    days,
    plans,
    connections,
  };
}
