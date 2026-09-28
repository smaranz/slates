import "server-only";

import { accountKey, accountMeta, DEFAULT_HOMES, noteDefaultOwners } from "../coding/accounts";
import { forgetLimits } from "../coding/limits";
import { sameEmail } from "./core";
import { accountLimits, forgetSwitchLimits, peekLimits } from "./limits";
import { createSwitcher } from "./switcher";
import { ADAPTERS, allowDevinKey, devinKeyAccess } from "./tools";
import { SWITCH_TOOLS, type SwitchAccount, type SwitchOutcome, type SwitchState, type SwitchTool, type SwitchToolState } from "./types";
import { vault } from "./vault";

export { SwitchBlocked } from "./switcher";

const switcher = createSwitcher({ vault, adapters: ADAPTERS });

/** One vault operation at a time, so a switch and a state read can't interleave their writes. */
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

export function isSwitchTool(v: unknown): v is SwitchTool {
  return typeof v === "string" && (SWITCH_TOOLS as string[]).includes(v);
}

async function toolState(tool: SwitchTool, withLimits: boolean, force: boolean): Promise<SwitchToolState> {
  const [{ live, roster }, running] = await Promise.all([serial(() => switcher.live(tool)), ADAPTERS[tool].running()]);
  const meta = accountMeta();
  const label = (email: string) => meta[accountKey(tool, email)]?.label ?? null;

  const rows: { row: SwitchAccount; saved: (typeof roster.accounts)[number] | null }[] = roster.accounts.map((a) => ({
    row: { id: a.id, email: a.email, label: label(a.email), plan: a.plan, saved: true, live: sameEmail(live?.email, a.email), lastActiveAt: a.lastActiveAt, limits: null },
    saved: a,
  }));
  if (live && !rows.some((r) => r.row.live)) {
    rows.push({ row: { id: "live", email: live.email, label: label(live.email), plan: live.plan, saved: false, live: true, lastActiveAt: null, limits: null }, saved: null });
  }
  // Whoever's signed in first, then the most recently used.
  rows.sort((a, b) => Number(b.row.live) - Number(a.row.live) || (b.row.lastActiveAt ?? 0) - (a.row.lastActiveAt ?? 0));

  await Promise.all(
    rows.map(async ({ row, saved }) => {
      const who = row.live || !saved ? { email: row.email } : saved;
      row.limits = withLimits ? await accountLimits(tool, who, row.live, force) : peekLimits(tool, who, row.live);
      if (!row.plan && row.limits?.plan) row.plan = row.limits.plan;
    })
  );
  return { tool, liveEmail: live?.email ?? null, accounts: rows.map((r) => r.row), running, ...(tool === "devin" ? { keyAccess: devinKeyAccess() } : {}) };
}

export async function switchState(opts: { limits: boolean; force?: boolean }): Promise<SwitchState> {
  const tools = await Promise.all(SWITCH_TOOLS.map((t) => toolState(t, opts.limits, !!opts.force)));
  return { tools, generatedAt: Date.now() };
}

export type SwitchAction = "save" | "activate" | "remove" | "sign-in";

/** Reads Devin's key once the student is ready to answer macOS's prompt for it. */
export async function allowDevin(): Promise<SwitchOutcome> {
  if (!(await allowDevinKey())) throw new Error("macOS didn't allow it. Try again and choose Always Allow.");
  forgetSwitchLimits("devin");
  return { headline: "Slates can read Devin's sign-in now.", notes: ["Devin's limits come from its server from here on, for every saved account."] };
}

export async function switchAction(action: SwitchAction, tool: SwitchTool, id?: string, force = false): Promise<SwitchOutcome> {
  const outcome = await serial(() => {
    if (action === "save") return switcher.saveCurrent(tool);
    if (action === "sign-in") return switcher.signInAnother(tool);
    if (!id) throw new Error("Pick an account.");
    return action === "activate" ? switcher.activate(tool, id, force) : switcher.remove(tool, id);
  });
  // Who a default home belongs to decides whose usage its logs count as, so note it now, not at the next scan.
  noteDefaultOwners();
  forgetSwitchLimits(tool);
  const home = DEFAULT_HOMES.find((h) => h.tool === tool);
  if (home) forgetLimits(home.id);
  return outcome;
}
