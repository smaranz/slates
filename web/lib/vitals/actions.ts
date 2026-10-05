import { ownerOf, protectedFrom, quitPlan, stopPlan } from "./group";
import { forgetSlow, readTable } from "./mac";
import type { VitalsActionResult } from "./types";

/**
 * Stopping a dev server and quitting an app, after the student confirmed it
 * in the room. Both read the process table again first, so they act on what
 * is running now rather than on the reading the room was showing, and refuse
 * anything Slates itself runs in.
 */

const uid = () => process.getuid?.() ?? -1;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function signal(target: number, sig: NodeJS.Signals) {
  try {
    process.kill(target, sig);
  } catch {
    /* already gone */
  }
}

async function gone(pids: number[], ms: number): Promise<number[]> {
  const deadline = Date.now() + ms;
  let left = pids.filter(alive);
  while (left.length && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 150));
    left = left.filter(alive);
  }
  return left;
}

const list = (ports: number[]) => (ports.length === 1 ? `port ${ports[0]}` : `ports ${ports.slice(0, -1).join(", ")} and ${ports.at(-1)}`);

/** Stop dev servers the way Ctrl-C in their terminal would, then firmly if that didn't take. */
export async function stopServers(pids: number[]): Promise<VitalsActionResult> {
  const { procs, listening } = await readTable();
  const guard = protectedFrom(procs, process.pid);
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const plans = pids.slice(0, 32).map((pid) => stopPlan(pid, procs, { uid: uid(), protectedPids: guard.pids, listening: new Set(listening.keys()) }));
  const refusal = plans.find((p) => p.kind === "refuse");
  if (plans.every((p) => p.kind === "refuse")) return { ok: false, message: refusal?.kind === "refuse" ? refusal.reason : "Nothing to stop." };

  const targets = new Set<number>();
  const ports: number[] = [];
  pids.forEach((pid, i) => {
    const plan = plans[i];
    if (!plan || plan.kind === "refuse") return;
    ports.push(...(listening.get(pid) ?? []));
    plan.pids.forEach((p) => targets.add(p));
    if (plan.kind === "group") signal(-plan.pgid, "SIGINT");
    else plan.pids.forEach((p) => signal(p, "SIGTERM"));
  });
  const freed = [...targets].reduce((sum, pid) => sum + (byPid.get(pid)?.mem ?? 0), 0);

  let left = await gone([...targets], 3_000);
  if (left.length) {
    left.forEach((pid) => signal(pid, "SIGTERM"));
    left = await gone(left, 3_000);
  }
  forgetSlow();
  ports.sort((a, b) => a - b);
  if (left.length) return { ok: false, message: `Asked it to stop, but ${left.length === 1 ? "a process is" : `${left.length} processes are`} still running.` };
  const count = plans.filter((p) => p.kind !== "refuse").length;
  return {
    ok: true,
    message: `${count === 1 ? "Stopped" : `Stopped ${count} servers`}${ports.length ? `, and ${list(ports)} ${ports.length === 1 ? "is" : "are"} free` : ""}.`,
    freed,
    ports,
  };
}

/** Quit an app by asking its own process to end (SIGTERM). */
export async function quitApp(key: string): Promise<VitalsActionResult> {
  const { procs } = await readTable();
  const guard = protectedFrom(procs, process.pid);
  const plan = quitPlan(key, procs, { uid: uid(), protectedBundles: guard.bundles });
  if (plan.kind === "refuse") return { ok: false, message: plan.reason };

  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const freed = procs.filter((p) => ownerOf(p, byPid).key === key).reduce((sum, p) => sum + p.mem, 0);
  plan.pids.forEach((pid) => signal(pid, "SIGTERM"));
  const left = await gone(plan.pids, 6_000);
  forgetSlow();
  if (left.length) return { ok: false, message: `${plan.name} hasn't closed yet. Give it a moment, or quit it from the Dock.` };
  return { ok: true, message: `${plan.name} quit.`, freed };
}
