import { sameEmail } from "./core";
import type { SwitchOutcome, SwitchTool } from "./types";

/**
 * Moving a tool's sign-in in and out of the vault, in Janus's order: get hold
 * of the replacement first, save the login being displaced, and only then
 * overwrite what's live. A failure at any step leaves the tool signed in as
 * whoever it was signed in as. The vault and the tools are passed in, so this
 * runs against fakes in tests.
 */

export interface StoredSession {
  /** The login itself; kept in the keychain. */
  secret: Record<string, string>;
  /** What else travels with the account; kept in a file only you can read. */
  extra: Record<string, unknown>;
}

export interface SavedAccount {
  id: string;
  email: string;
  plan: string | null;
  addedAt: number;
  lastActiveAt: number | null;
}

export interface ToolRoster {
  accounts: SavedAccount[];
  activeId: string | null;
}

export interface Vault {
  roster(tool: SwitchTool): Promise<ToolRoster>;
  saveRoster(tool: SwitchTool, roster: ToolRoster): Promise<void>;
  load(tool: SwitchTool, id: string): Promise<StoredSession | null>;
  store(tool: SwitchTool, id: string, session: StoredSession): Promise<void>;
  discard(tool: SwitchTool, id: string): Promise<void>;
}

export interface LiveLogin {
  email: string;
  plan: string | null;
  session: StoredSession;
}

export interface Adapter {
  name: string;
  readLive(): Promise<LiveLogin | null>;
  /** Makes a saved login the live one; puts the previous one back itself if it fails halfway. */
  install(session: StoredSession): Promise<void>;
  /** What's open that would keep the old login, in words, or null. */
  running(): Promise<string | null>;
  /** An app that holds its login while open: quit for the switch and opened again after. */
  app?: { quit(): Promise<void>; open(): Promise<void> };
  /** Starts signing in as someone else; returns what the student should do next. */
  signIn?(): Promise<string>;
  /** Said after a switch, for tools that read their login when they start. */
  restartNote?: string;
}

export class SwitchBlocked extends Error {
  constructor(readonly running: string) {
    super(`${running} Quit it first, or it keeps the old account and can put it back when it renews its login.`);
    this.name = "SwitchBlocked";
  }
}

export function createSwitcher(deps: {
  vault: Vault;
  adapters: Record<SwitchTool, Adapter>;
  now?: () => number;
  newId?: () => string;
}) {
  const { vault, adapters } = deps;
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);

  /**
   * Files a live login under its account. One Slates doesn't know yet is
   * added rather than skipped: its login exists nowhere else.
   */
  async function keep(tool: SwitchTool, roster: ToolRoster, live: LiveLogin): Promise<{ account: SavedAccount; added: boolean }> {
    let account = roster.accounts.find((a) => sameEmail(a.email, live.email));
    const added = !account;
    if (!account) {
      account = { id: newId(), email: live.email, plan: live.plan, addedAt: now(), lastActiveAt: null };
      roster.accounts.push(account);
    } else if (live.plan) {
      account.plan = live.plan;
    }
    // The login is stored before the list names it, so the list never points at nothing.
    await vault.store(tool, account.id, live.session);
    return { account, added };
  }

  return {
    async saveCurrent(tool: SwitchTool): Promise<SwitchOutcome> {
      const adapter = adapters[tool];
      const live = await adapter.readLive();
      if (!live) throw new Error(`Nothing is signed in to ${adapter.name} on this Mac.`);
      const roster = await vault.roster(tool);
      const { account, added } = await keep(tool, roster, live);
      account.lastActiveAt = now();
      roster.activeId = account.id;
      await vault.saveRoster(tool, roster);
      return { headline: added ? `Now keeping ${live.email}.` : `Saved ${live.email}.`, notes: [] };
    },

    async activate(tool: SwitchTool, id: string, force = false): Promise<SwitchOutcome> {
      const adapter = adapters[tool];
      const roster = await vault.roster(tool);
      const target = roster.accounts.find((a) => a.id === id);
      if (!target) throw new Error("That account isn't on the list any more.");

      // Measured against the tool itself, not the list: signing in outside
      // Slates makes the list's idea of who's active out of date.
      const before = await adapter.readLive();
      if (before && sameEmail(before.email, target.email)) throw new Error(`Already signed in as ${target.email}.`);

      // Fetched before anything is disturbed; if it's missing, nothing has changed.
      const replacement = await vault.load(tool, id);
      if (!replacement) throw new Error("This account has no saved sign-in. Sign in as it and save it again.");

      const running = await adapter.running();
      if (running && !adapter.app && !force) throw new SwitchBlocked(running);

      const notes: string[] = [];
      const quit = !!running && !!adapter.app;
      if (quit) await adapter.app!.quit();
      try {
        // An app writes its last state as it closes, so it's read again once it has.
        const live = quit ? await adapter.readLive() : before;
        if (live) {
          const { account, added } = await keep(tool, roster, live);
          account.lastActiveAt = now();
          await vault.saveRoster(tool, roster);
          notes.push(added ? `${live.email} wasn't on the list, so it was saved first.` : `Saved ${live.email} first.`);
        }
        await adapter.install(replacement);
        target.lastActiveAt = now();
        roster.activeId = target.id;
        await vault.saveRoster(tool, roster);
      } finally {
        if (quit) {
          await adapter.app!.open().then(
            () => notes.push(`${adapter.name} opened again.`),
            () => notes.push(`Open ${adapter.name} again yourself.`)
          );
        }
      }
      if (running && !quit) notes.push(`${running} Restart it, or it may switch back when it renews its login.`);
      else if (!quit && adapter.restartNote) notes.push(adapter.restartNote);
      return { headline: `Switched to ${target.email}.`, notes };
    },

    async remove(tool: SwitchTool, id: string): Promise<SwitchOutcome> {
      const roster = await vault.roster(tool);
      const account = roster.accounts.find((a) => a.id === id);
      if (!account) throw new Error("That account isn't on the list any more.");
      roster.accounts = roster.accounts.filter((a) => a.id !== id);
      if (roster.activeId === id) roster.activeId = null;
      await vault.saveRoster(tool, roster);
      await vault.discard(tool, id);
      const live = await adapters[tool].readLive();
      return {
        headline: `Removed ${account.email}.`,
        notes: live && sameEmail(live.email, account.email) ? ["It's still signed in; Slates just stops keeping a copy to switch back to."] : [],
      };
    },

    /** Saves who's signed in, so they can be switched back to, then starts a sign-in as someone else. */
    async signInAnother(tool: SwitchTool): Promise<SwitchOutcome> {
      const adapter = adapters[tool];
      if (!adapter.signIn) throw new Error(`Sign out of ${adapter.name} and in as the other account, then save it here.`);
      const notes: string[] = [];
      const live = await adapter.readLive();
      if (live) {
        const roster = await vault.roster(tool);
        const { account } = await keep(tool, roster, live);
        account.lastActiveAt = now();
        roster.activeId = account.id;
        await vault.saveRoster(tool, roster);
        notes.push(`Saved ${live.email}, so you can switch back to it.`);
      }
      return { headline: await adapter.signIn(), notes };
    },

    /**
     * Who's signed in, and the saved copy of them brought up to date. Logins
     * renew themselves as they're used, and a saved copy holding a renewal
     * that's since been replaced would be a dead end to switch back to.
     */
    async live(tool: SwitchTool): Promise<{ live: LiveLogin | null; roster: ToolRoster }> {
      const live = await adapters[tool].readLive();
      const roster = await vault.roster(tool);
      const account = live ? roster.accounts.find((a) => sameEmail(a.email, live.email)) : undefined;
      if (live && account) {
        const stored = await vault.load(tool, account.id);
        if (!stored || JSON.stringify(stored.secret) !== JSON.stringify(live.session.secret)) await vault.store(tool, account.id, live.session);
        if (roster.activeId !== account.id || (live.plan && account.plan !== live.plan)) {
          roster.activeId = account.id;
          if (live.plan) account.plan = live.plan;
          await vault.saveRoster(tool, roster);
        }
      }
      return { live, roster };
    },
  };
}

export type Switcher = ReturnType<typeof createSwitcher>;
