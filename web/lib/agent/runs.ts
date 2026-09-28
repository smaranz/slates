import type { LocalAgentStore } from "@cursor/sdk";

/**
 * Whether a persistent agent's runtime still counts an earlier turn as going.
 *
 * Slates runs one turn per agent at a time, so such a turn was cut off: the
 * host restarted or crashed partway through it. The SDK refuses every new
 * turn ("already has active run") until that one is expired, which a send
 * with `local.force` does.
 */
export async function hasCutOffTurn(store: Pick<LocalAgentStore, "agents" | "runs">, runtimeId: string): Promise<boolean> {
  const agent = await store.agents.get({ agentId: runtimeId }).catch(() => null);
  if (!agent?.activeRunId) return false;
  const run = await store.runs.get({ agentId: runtimeId, runId: agent.activeRunId }).catch(() => null);
  return !!run && /^(queued|creating|running)$/i.test(run.status);
}
