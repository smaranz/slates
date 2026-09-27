export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Agent routines run on whichever machine hosts the portal, even with no window open.
  const { startScheduler } = await import("./lib/agent/scheduler");
  startScheduler();
}
