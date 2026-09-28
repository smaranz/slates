"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { TOOL_LABEL } from "@/lib/ai-usage/coding/types";
import type { SwitchAccount, SwitchOutcome, SwitchState, SwitchTool, SwitchToolState } from "@/lib/ai-usage/switch/types";
import { usageFetch } from "@/lib/desktop-bridge";
import { Icon, ICON, Spinner } from "../ui";
import { ago, Limits, TOOL_COLOR, ToolMark } from "./UsageApp";

/**
 * Switch accounts: which account Claude Code, agy and the Devin app are signed
 * in as, one click to put another in its place, and every account's limits so
 * you can see which one has room left. The idea is Janus's, for three tools.
 */

type Action = "save" | "activate" | "remove" | "sign-in" | "devin-key";

const EMPTY: Record<SwitchTool, string> = {
  claude: "Claude Code isn't signed in on this Mac. Add account opens its sign-in in Terminal.",
  antigravity: "agy isn't signed in on this Mac. Add account opens it in Terminal to sign in.",
  devin: "Devin isn't signed in. Sign in in the Devin app and it shows up here.",
};

const FOOT: Record<SwitchTool, string> = {
  claude: "Add account keeps who's signed in, then opens Claude Code's sign-in in Terminal for the next one.",
  antigravity: "Add account keeps who's signed in, then opens agy in Terminal to sign in as the next one.",
  devin: "To add an account, sign out in Devin and in as the other one; the first is saved when you switch. Switching quits Devin and opens it again.",
};

async function post(body: Record<string, unknown>): Promise<Response> {
  return usageFetch("/api/usage/coding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export default function SwitchView({ refreshToken }: { refreshToken: number }) {
  const [state, setState] = useState<SwitchState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<SwitchOutcome | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ tool: SwitchTool; id: string; message: string } | null>(null);
  const [confirmDevin, setConfirmDevin] = useState<string | null>(null);
  const [watching, setWatching] = useState<SwitchTool | null>(null);
  const watchFrom = useRef<string | null>(null);
  const [, setTick] = useState(0);

  const load = useCallback(async (mode: "quick" | "limits" | "force") => {
    try {
      const res = mode === "force" ? await post({ action: "switch-refresh" }) : await usageFetch(`/api/usage/coding?view=switch${mode === "limits" ? "&limits=1" : ""}`);
      const data = (await res.json()) as SwitchState & { error?: string };
      if (!res.ok) throw new Error(data.error || "Couldn't read your sign-ins.");
      setState(data);
      setError(null);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read your sign-ins.");
      return null;
    }
  }, []);

  // The list first, since it's quick; the limits fill in after.
  useEffect(() => {
    const t = setTimeout(async () => {
      await load("quick");
      await load("limits");
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  // The header's Refresh asks every provider again.
  const firstToken = useRef(refreshToken);
  useEffect(() => {
    if (refreshToken === firstToken.current) return;
    const t = setTimeout(() => void load("force"), 0);
    return () => clearTimeout(t);
  }, [refreshToken, load]);

  // Countdowns move while you look.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // After a sign-in starts in Terminal, watch for it to land (up to three minutes).
  useEffect(() => {
    if (!watching) return;
    let n = 0;
    const t = setInterval(async () => {
      const next = await load("quick");
      const live = next?.tools.find((x) => x.tool === watching)?.liveEmail ?? null;
      if ((live && live !== watchFrom.current) || ++n > 45) {
        setWatching(null);
        void load("limits");
      }
    }, 4_000);
    return () => clearInterval(t);
  }, [watching, load]);

  async function act(tool: SwitchTool, action: Action, id?: string, force = false) {
    setBusy(`${tool}:${id ?? ""}:${action}`);
    setError(null);
    setOutcome(null);
    setBlocked(null);
    try {
      const res = await post(action === "devin-key" ? { action: "switch-devin-key" } : { action: `switch-${action}`, tool, id, force });
      const data = (await res.json()) as SwitchOutcome & { error?: string; blocked?: boolean };
      if (res.status === 409 && data.blocked && id) {
        setBlocked({ tool, id, message: data.error ?? "" });
        return;
      }
      if (!res.ok) throw new Error(data.error || "That didn't work.");
      setOutcome(data);
      if (action === "sign-in") {
        watchFrom.current = state?.tools.find((x) => x.tool === tool)?.liveEmail ?? null;
        setWatching(tool);
      }
      await load("quick");
      void load("limits");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="uswitch">
      <p className="uswitch-intro">
        Choose the account Claude Code, agy and the Devin app sign in as. Saved logins stay in this Mac&rsquo;s keychain; switching puts another
        in place and keeps the one it replaces, so nothing has to be signed into twice.
      </p>

      {outcome && (
        <div className="uswitch-outcome" role="status">
          <Icon path={ICON.check} size={14} />
          <div>
            <strong>{outcome.headline}</strong>
            {outcome.notes.map((n) => (
              <p key={n}>{n}</p>
            ))}
          </div>
          <button type="button" className="ulink-close" aria-label="Dismiss" onClick={() => setOutcome(null)}>
            <Icon path={ICON.close} size={12} />
          </button>
        </div>
      )}
      {error && <div className="usage-error">{error}</div>}

      {!state ? (
        <div className="usage-loading">
          <Spinner size={18} />
          Reading who each tool is signed in as…
        </div>
      ) : (
        state.tools.map((t) => (
          <ToolSection
            key={t.tool}
            tool={t}
            busy={busy}
            watching={watching === t.tool}
            blocked={blocked?.tool === t.tool ? blocked : null}
            confirmDevin={t.tool === "devin" ? confirmDevin : null}
            onAct={(action, id, force) => void act(t.tool, action, id, force)}
            onConfirmDevin={setConfirmDevin}
            onDismissBlocked={() => setBlocked(null)}
          />
        ))
      )}
    </div>
  );
}

function ToolSection({
  tool,
  busy,
  watching,
  blocked,
  confirmDevin,
  onAct,
  onConfirmDevin,
  onDismissBlocked,
}: {
  tool: SwitchToolState;
  busy: string | null;
  watching: boolean;
  blocked: { id: string; message: string } | null;
  confirmDevin: string | null;
  onAct: (action: Action, id?: string, force?: boolean) => void;
  onConfirmDevin: (id: string | null) => void;
  onDismissBlocked: () => void;
}) {
  const live = tool.accounts.find((a) => a.live);
  return (
    <section className="usec uswitch-tool" style={{ ["--tool" as string]: TOOL_COLOR[tool.tool] }}>
      <div className="usec-head">
        <span className="uacct-mark">
          <ToolMark tool={tool.tool} size={15} />
        </span>
        <h2>{TOOL_LABEL[tool.tool]}</h2>
        <span className="usec-sub">{live ? `Signed in as ${live.label ?? live.email}` : "Not signed in"}</span>
        <span className="uspacer" />
        {tool.tool !== "devin" && (
          <button type="button" className="btn btn--quiet" disabled={!!busy} onClick={() => onAct("sign-in")}>
            {busy === `${tool.tool}::sign-in` ? <Spinner size={12} /> : <Icon path={ICON.plus} size={12} />}
            Add account
          </button>
        )}
      </div>

      {tool.running && tool.tool !== "devin" && (
        <p className="uswitch-warn">
          {tool.running} Quit it before switching: it keeps the account it started with.
        </p>
      )}
      {watching && (
        <p className="uswitch-wait">
          <Spinner size={12} /> Waiting for the new sign-in in Terminal…
        </p>
      )}
      {tool.keyAccess === "ask" && (
        <div className="uswitch-confirm">
          <p>
            Devin keeps its sign-in encrypted with a key in your keychain. Allow Slates to read it and every Devin account shows live
            limits, and Slates can tell for certain who&rsquo;s signed in. Until then these are the limits Devin last cached. macOS asks once;
            choose Always Allow.
          </p>
          <div>
            <button type="button" className="btn btn--primary" disabled={!!busy} onClick={() => onAct("devin-key")}>
              {busy === "devin::devin-key" ? <Spinner size={12} /> : null}
              {busy === "devin::devin-key" ? "Answer the macOS prompt…" : "Allow"}
            </button>
          </div>
        </div>
      )}

      {tool.accounts.length === 0 ? (
        <p className="usage-empty">{EMPTY[tool.tool]}</p>
      ) : (
        <div className="uaccts">
          {tool.accounts.map((a) => (
            <AccountRow
              key={a.id}
              tool={tool.tool}
              account={a}
              busy={busy}
              blocked={blocked?.id === a.id ? blocked.message : null}
              confirming={confirmDevin === a.id}
              onAct={onAct}
              onConfirmDevin={onConfirmDevin}
              onDismissBlocked={onDismissBlocked}
            />
          ))}
        </div>
      )}
      <p className="uswitch-foot">{FOOT[tool.tool]}</p>
    </section>
  );
}

function AccountRow({
  tool,
  account: a,
  busy,
  blocked,
  confirming,
  onAct,
  onConfirmDevin,
  onDismissBlocked,
}: {
  tool: SwitchTool;
  account: SwitchAccount;
  busy: string | null;
  blocked: string | null;
  confirming: boolean;
  onAct: (action: Action, id?: string, force?: boolean) => void;
  onConfirmDevin: (id: string | null) => void;
  onDismissBlocked: () => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const switching = busy === `${tool}:${a.id}:activate`;
  return (
    <article className={`uacct uswitch-acct${a.live ? " is-live" : ""}`}>
      <header className="uacct-head">
        <span className="uacct-mark">
          <ToolMark tool={tool} size={15} />
        </span>
        <div className="uacct-title">
          <strong title={a.label ?? a.email}>{a.label ?? a.email}</strong>
          <span title={a.email}>{a.label ? a.email : a.live ? "In use now" : a.lastActiveAt ? `Last used ${ago(a.lastActiveAt)}` : "Saved"}</span>
        </div>
        <span className="uacct-badges">
          {a.plan && <span className="upill">{a.plan}</span>}
          {a.live && <span className="upill upill--live">Signed in</span>}
          {!a.saved && <span className="upill">Not saved</span>}
        </span>
      </header>

      <Limits limits={a.limits ?? undefined} />

      {blocked && (
        <div className="uswitch-confirm" role="alert">
          <p>{blocked}</p>
          <div>
            <button type="button" className="btn btn--quiet" onClick={onDismissBlocked}>
              Cancel
            </button>
            <button type="button" className="btn btn--danger" disabled={!!busy} onClick={() => onAct("activate", a.id, true)}>
              Switch anyway
            </button>
          </div>
        </div>
      )}
      {confirming && (
        <div className="uswitch-confirm" role="alert">
          <p>Devin quits and opens again signed in as {a.email}. Anything running in it stops.</p>
          <div>
            <button type="button" className="btn btn--quiet" onClick={() => onConfirmDevin(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!!busy}
              onClick={() => {
                onConfirmDevin(null);
                onAct("activate", a.id);
              }}
            >
              Quit Devin and switch
            </button>
          </div>
        </div>
      )}

      <footer className="uacct-actions">
        {a.live ? (
          !a.saved && (
            <button type="button" className="btn btn--quiet" disabled={!!busy} onClick={() => onAct("save")}>
              {busy === `${tool}::save` ? <Spinner size={12} /> : null}
              Save
            </button>
          )
        ) : (
          <button
            type="button"
            className="btn btn--primary"
            disabled={!!busy || confirming || !!blocked}
            onClick={() => (tool === "devin" ? onConfirmDevin(a.id) : onAct("activate", a.id))}
          >
            {switching ? <Spinner size={12} /> : <Icon path={ICON.swap} size={12} />}
            Switch to this
          </button>
        )}
        <span className="uspacer" />
        {a.saved &&
          (confirmRemove ? (
            <button type="button" className="btn btn--danger" disabled={!!busy} onClick={() => onAct("remove", a.id)} onBlur={() => setConfirmRemove(false)} autoFocus>
              Remove?
            </button>
          ) : (
            <button type="button" className="btn btn--quiet" onClick={() => setConfirmRemove(true)}>
              Remove
            </button>
          ))}
      </footer>
    </article>
  );
}
