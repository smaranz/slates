/**
 * Starts the routine clock with the server.
 *
 * The engine (and the Cursor SDK behind it) loads on the first tick rather
 * than at startup, so a problem there can never keep the portal from coming
 * up — it only costs routines until it's fixed.
 */

const state = globalThis as typeof globalThis & { __slatesAgentClock?: ReturnType<typeof setInterval> };

export function startScheduler(): void {
  if (state.__slatesAgentClock || process.env.SLATES_AGENT_SCHEDULER === "off") return;
  const tick = async () => {
    try {
      const { tickRoutines } = await import("./engine");
      tickRoutines();
    } catch (error) {
      console.error("[agent] routine tick failed:", error instanceof Error ? error.message : error);
    }
  };
  state.__slatesAgentClock = setInterval(tick, 30_000);
  state.__slatesAgentClock.unref?.();
  setTimeout(tick, 15_000).unref?.();
}
