export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // The desktop app's AI Usage portal on a Mac whose Slates runs elsewhere; the host runs the routines.
  if (process.env.SLATES_USAGE_ONLY === "1") return;
  // Agent routines run on whichever machine hosts the portal, even with no window open.
  const { startScheduler } = await import("./lib/agent/scheduler");
  startScheduler();
}
