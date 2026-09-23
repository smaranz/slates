"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useUsageRefreshMinutes } from "@/lib/app-prefs";
import { useMode } from "@/lib/mode";
import {
  LINKABLE_TOOLS,
  TOOL_LABEL,
  TOOL_ORDER,
  type AccountLimits,
  type AccountRow,
  type CodingDay,
  type CodingRange,
  type CodingRequestPage,
  type CodingSnapshot,
  type CodingTool,
  type LinkableTool,
} from "@/lib/ai-usage/coding/types";
import { AnthropicLogo, CursorLogo, GeminiLogo, Icon, ICON, OpenAILogo, OpenCodeLogo, Spinner } from "../ui";
import CapacityView from "./CapacityView";

/**
 * AI Usage — every coding CLI on this machine, every account, every request.
 *
 * Reads Claude Code, Codex, Gemini CLI and opencode from their own logs and
 * prices each request at API rates, so a subscription reads as "what these
 * tokens would have cost". Accounts are linked by giving the CLI a second
 * home, which is why nothing here ever signs you out of the one you use.
 */

const RANGES: { id: CodingRange; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "month", label: "This month" },
  { id: "all", label: "All time" },
];

export const TOOL_COLOR: Record<CodingTool, string> = {
  claude: "oklch(0.74 0.13 45)",
  codex: "oklch(0.78 0.1 200)",
  antigravity: "oklch(0.72 0.14 265)",
  cursor: "oklch(0.86 0.02 250)",
  gemini: "oklch(0.7 0.08 250)",
  // The logo's warm grey — distinct from Cursor's cooler near-white.
  opencode: "oklch(0.66 0.012 30)",
  slates: "oklch(0.84 0.12 85)",
};

const PAGE = 50;

// ── formatting ────────────────────────────────────────────────────────────

export function usd(n: number): string {
  if (n === 0) return "$0";
  if (n >= 1000) return `$${Math.round(n).toLocaleString()}`;
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(4)}`;
}

export function tokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k`;
  return String(Math.round(n));
}

function count(n: number): string {
  return n.toLocaleString();
}

function when(at: number): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === new Date().toDateString()) return time;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

function ago(at: number): string {
  const s = Math.max(0, (Date.now() - at) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function resetsIn(at: number | null): string | null {
  if (!at) return null;
  const s = (at - Date.now()) / 1000;
  if (s <= 0) return "resetting";
  const mins = Math.max(1, Math.round(s / 60));
  if (mins < 60) return `resets in ${mins}m`;
  if (s < 86400) return `resets in ${Math.floor(mins / 60)}h ${mins % 60}m`;
  const d = new Date(at);
  return `resets ${d.toLocaleDateString(undefined, { weekday: "short" })} ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function shortPath(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts.slice(-2).join("/") || p;
}

function meterColor(pct: number): string {
  if (pct >= 90) return "var(--bad)";
  if (pct >= 70) return "var(--warn)";
  return "var(--good)";
}

// ── pieces ────────────────────────────────────────────────────────────────

export function ToolMark({ tool, size = 14 }: { tool: CodingTool; size?: number }) {
  const style = { color: TOOL_COLOR[tool] };
  if (tool === "claude") return <AnthropicLogo size={size} style={style} />;
  if (tool === "codex") return <OpenAILogo size={size} style={style} />;
  if (tool === "gemini" || tool === "antigravity") return <GeminiLogo size={size} style={style} />;
  if (tool === "cursor") return <CursorLogo size={size} style={style} />;
  if (tool === "slates") return <Image src="/assets/slates-mark.png" alt="" width={size} height={size} />;
  // opencode's own mark is monochrome, so it wears the text colour, not its chart colour.
  return <OpenCodeLogo size={size} style={{ color: "var(--text)" }} />;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="ustat">
      <div className="ustat-label">{label}</div>
      <div className="ustat-value">{value}</div>
      {hint ? <div className="ustat-hint">{hint}</div> : null}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { id: T; label: React.ReactNode }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="useg" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          className={value === o.id ? "is-on" : undefined}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── chart ─────────────────────────────────────────────────────────────────

function Chart({ days, hourly, metric }: { days: CodingDay[]; hourly: boolean; metric: "cost" | "tokens" }) {
  const [hover, setHover] = useState<number | null>(null);
  const value = (d: CodingDay) => (metric === "cost" ? d.costUsd : d.tokens);
  const max = Math.max(...days.map(value), metric === "cost" ? 0.01 : 1);
  const label = (d: CodingDay) => {
    if (hourly) {
      return new Date(2000, 0, 1, Number(d.day.slice(11))).toLocaleTimeString(undefined, { hour: "numeric" });
    }
    const [y, m, dd] = d.day.split("-").map(Number);
    return new Date(y!, m! - 1, dd!).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };
  const shown = hover != null ? days[hover] : null;
  const total = days.reduce((s, d) => s + value(d), 0);
  const ticks = days.length <= 8 ? days.map((_, i) => i) : [0, Math.floor((days.length - 1) / 2), days.length - 1];

  return (
    <div className="uchart">
      <div className="uchart-readout" aria-live="polite">
        {shown ? (
          <>
            <strong>{metric === "cost" ? usd(shown.costUsd) : tokens(shown.tokens)}</strong>
            <span>
              {label(shown)} · {count(shown.requests)} requests
            </span>
            {metric === "cost" && (
              <span className="uchart-split">
                {TOOL_ORDER.filter((t) => shown.byTool[t]).map((t) => (
                  <span key={t}>
                    <i style={{ background: TOOL_COLOR[t] }} />
                    {TOOL_LABEL[t]} {usd(shown.byTool[t]!)}
                  </span>
                ))}
              </span>
            )}
          </>
        ) : (
          <>
            <strong>{metric === "cost" ? usd(total) : tokens(total)}</strong>
            <span>{hourly ? "today, by hour" : `over ${days.length} days`} · hover a bar for detail</span>
          </>
        )}
      </div>
      <div className="uchart-bars" onMouseLeave={() => setHover(null)}>
        {days.map((d, i) => {
          const v = value(d);
          const h = v > 0 ? Math.max(2, (v / max) * 100) : 0;
          // Stacked by tool for cost; tokens aren't split per tool, so they stay one colour.
          const parts =
            metric === "cost" && d.costUsd > 0
              ? TOOL_ORDER.filter((t) => d.byTool[t]).map((t) => ({ t, pct: (d.byTool[t]! / d.costUsd) * 100 }))
              : [{ t: null as CodingTool | null, pct: 100 }];
          return (
            <div
              key={d.day}
              className={`uchart-col${hover === i ? " is-hover" : ""}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              tabIndex={0}
              aria-label={`${label(d)}: ${metric === "cost" ? usd(d.costUsd) : tokens(d.tokens)}`}
            >
              <div className="uchart-stack" style={{ height: `${h}%` }}>
                {v > 0 &&
                  parts.map((p, j) => (
                    <span key={j} style={{ height: `${p.pct}%`, background: p.t ? TOOL_COLOR[p.t] : "var(--usage-accent)" }} />
                  ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="uchart-axis" aria-hidden>
        {ticks.map((i, n) => (
          <span
            key={i}
            className={n === 0 ? "is-first" : n === ticks.length - 1 && ticks.length > 1 ? "is-last" : undefined}
            style={{ left: `${((i + 0.5) / days.length) * 100}%` }}
          >
            {label(days[i]!)}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── accounts ──────────────────────────────────────────────────────────────

function Limits({ limits }: { limits: AccountLimits | undefined }) {
  if (!limits) {
    return (
      <div className="ulimits ulimits--loading">
        <Spinner size={12} /> Checking plan limits…
      </div>
    );
  }
  return (
    <div className="ulimits">
      {limits.windows.map((w) => (
        <div key={w.id} className="ulimit">
          <span className="ulimit-label" title={w.label}>
            {w.label}
          </span>
          <span className="ulimit-bar" aria-hidden>
            <span style={{ width: `${w.usedPct}%`, background: meterColor(w.usedPct) }} />
          </span>
          <span className="ulimit-pct">{Math.round(w.usedPct)}%</span>
          <span className="ulimit-reset">{resetsIn(w.resetsAt) ?? ""}</span>
        </div>
      ))}
      {(limits.note || limits.source === "log") && (
        <p className="ulimits-note">
          {limits.note}
          {limits.source === "log" && limits.fetchedAt ? ` Logged ${ago(limits.fetchedAt)}.` : ""}
        </p>
      )}
    </div>
  );
}

function AccountCard({
  row,
  limits,
  busy,
  selected,
  onSelect,
  onAction,
  onSaveMeta,
}: {
  row: AccountRow;
  limits: AccountLimits | undefined;
  busy: boolean;
  selected: boolean;
  onSelect: () => void;
  onAction: (action: "open" | "relogin" | "unlink", homeId: string) => void;
  onSaveMeta: (label: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [label, setLabel] = useState(row.label);

  const owned = row.homes.find((h) => h.owned) ?? null;
  const home = owned ?? row.homes[0] ?? null;
  const plan = row.plan ?? limits?.plan ?? null;
  const linkable = row.canLink;

  function startEdit() {
    setLabel(row.label);
    setEditing(true);
  }

  return (
    <article
      className={`uacct${selected ? " is-selected" : ""}${row.waiting ? " is-waiting" : ""}`}
      style={{ ["--tool" as string]: TOOL_COLOR[row.tool] }}
    >
      <header className="uacct-head">
        <span className="uacct-mark">
          <ToolMark tool={row.tool} size={15} />
        </span>
        <button
          type="button"
          className="uacct-title"
          onClick={onSelect}
          aria-pressed={selected}
          title={selected ? "Show every account" : "Show only this account"}
        >
          <strong title={row.label}>{row.label}</strong>
          <span title={row.email ?? undefined}>{row.email && row.email !== row.label ? row.email : TOOL_LABEL[row.tool]}</span>
        </button>
        <span className="uacct-badges">
          {plan && <span className="upill">{plan}</span>}
          {row.inCli && (
            <span className="upill upill--live" title="Signed into the everyday CLI on this Mac">
              In CLI
            </span>
          )}
        </span>
      </header>

      {row.waiting ? (
        <div className="uacct-waiting">
          <Spinner size={13} />
          <div>
            <strong>Waiting for sign-in</strong>
            <p>Finish signing in in the Terminal window. This card fills in by itself.</p>
          </div>
        </div>
      ) : linkable && home ? (
        <Limits limits={limits} />
      ) : null}

      {!row.waiting && row.tracksTokens && (
        <dl className="uacct-stats">
          <div>
            <dt>Requests</dt>
            <dd>{count(row.requests)}</dd>
          </div>
          <div>
            <dt>Tokens</dt>
            <dd>{tokens(row.tokens)}</dd>
          </div>
          <div>
            <dt>API value</dt>
            <dd>{usd(row.costUsd)}</dd>
          </div>
        </dl>
      )}

      {!row.waiting && (!row.tracksTokens || row.lastUsedAt) && (
        <p className="uacct-value">
          {!row.tracksTokens
            ? "Antigravity keeps no token counts on this Mac, so only its limits show here."
            : `Last used ${ago(row.lastUsedAt!)}.`}
        </p>
      )}

      {editing ? (
        <form
          className="uacct-edit"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await onSaveMeta(label)) setEditing(false);
          }}
        >
          <label>
            Name
            <input className="input" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} placeholder={row.email ?? ""} />
          </label>
          <div className="uacct-edit-actions">
            <button type="button" className="btn btn--quiet" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy}>
              Save
            </button>
          </div>
        </form>
      ) : (
        <footer className="uacct-actions">
          {row.waiting && owned ? (
            <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => onAction("relogin", owned.id)}>
              Reopen sign-in
            </button>
          ) : home && linkable ? (
            <>
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                onClick={() => onAction("open", home.id)}
                title={row.command ?? undefined}
              >
                <Icon path={ICON.external} size={12} />
                Open in Terminal
              </button>
            </>
          ) : null}
          <span className="uspacer" />
          <button type="button" className="btn btn--quiet" onClick={startEdit}>
            Edit
          </button>
          {owned &&
            (confirmRemove ? (
              <button
                type="button"
                className="btn btn--danger"
                disabled={busy}
                onClick={() => onAction("unlink", owned.id)}
                onBlur={() => setConfirmRemove(false)}
                autoFocus
              >
                Remove?
              </button>
            ) : (
              <button type="button" className="btn btn--quiet" onClick={() => setConfirmRemove(true)}>
                Remove
              </button>
            ))}
        </footer>
      )}
    </article>
  );
}

function LinkPanel({
  busy,
  onLink,
  onClose,
}: {
  busy: boolean;
  onLink: (tool: LinkableTool, label: string) => void;
  onClose: () => void;
}) {
  const [tool, setTool] = useState<LinkableTool>("claude");
  const [label, setLabel] = useState("");
  return (
    <form
      className="ulink card"
      onSubmit={(e) => {
        e.preventDefault();
        onLink(tool, label);
      }}
    >
      <div className="ulink-head">
        <strong>Link another account</strong>
        <button type="button" className="ulink-close" onClick={onClose} aria-label="Close">
          <Icon path={ICON.close} size={13} />
        </button>
      </div>
      <p className="ulink-copy">
        Terminal opens a {TOOL_LABEL[tool]} sign-in in its own profile, so the account you use now stays signed in.
        {tool === "antigravity" ? " Open the link agy prints, sign in, then quit it." : ""}
        {tool === "cursor" ? " Cursor shows usage for whichever account its app is signed into, so sign the app in as this account once to bring its history in." : ""}{" "}
        Once it&rsquo;s linked,{" "}
        <em>Open in Terminal</em> on its card runs {TOOL_LABEL[tool]} as that account.
      </p>
      <Segmented
        label="Tool"
        value={tool}
        onChange={setTool}
        options={LINKABLE_TOOLS.map((t) => ({
          id: t,
          label: (
            <>
              <ToolMark tool={t} size={12} />
              {TOOL_LABEL[t]}
            </>
          ),
        }))}
      />
      <div className="ulink-fields">
        <label>
          <span>
            Name <em>optional</em>
          </span>
          <input className="input" value={label} maxLength={40} placeholder={`Second ${TOOL_LABEL[tool]}`} onChange={(e) => setLabel(e.target.value)} />
        </label>
      </div>
      <div className="ulink-actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? <Spinner size={12} /> : <Icon path={ICON.external} size={12} />}
          Open sign-in in Terminal
        </button>
      </div>
    </form>
  );
}

// ── the screen ────────────────────────────────────────────────────────────

export default function UsageApp() {
  const { clear, openSettings } = useMode();
  const [range, setRange] = useState<CodingRange>("30d");
  const [view, setView] = useState<"usage" | "capacity">("usage");
  const [tool, setTool] = useState<CodingTool | "all">("all");
  const [account, setAccount] = useState<string | null>(null);
  const [metric, setMetric] = useState<"cost" | "tokens">("cost");

  const [snap, setSnap] = useState<CodingSnapshot | null>(null);
  const [limits, setLimits] = useState<Record<string, AccountLimits> | null>(null);
  const [page, setPage] = useState<CodingRequestPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [refreshMinutes] = useUsageRefreshMinutes();
  const loadSeq = useRef(0);

  useEffect(() => {
    if (navigator.userAgent.includes("Electron")) document.documentElement.dataset.desktop = "1";
  }, []);

  const query = useCallback(
    (extra: Record<string, string> = {}) => {
      const p = new URLSearchParams({ range, ...extra });
      if (tool !== "all") p.set("tool", tool);
      if (account) p.set("account", account);
      return p.toString();
    },
    [range, tool, account]
  );

  const load = useCallback(
    async (force = false) => {
      const seq = ++loadSeq.current;
      setError(null);
      try {
        const [s, r] = await Promise.all([
          fetch(`/api/usage/coding?${query(force ? { force: "1" } : {})}`).then((res) => {
            if (!res.ok) throw new Error("Couldn't read usage logs.");
            return res.json() as Promise<CodingSnapshot>;
          }),
          fetch(`/api/usage/coding?${query({ view: "requests", offset: "0", limit: String(PAGE) })}`).then(
            (res) => res.json() as Promise<CodingRequestPage>
          ),
        ]);
        if (seq !== loadSeq.current) return;
        setSnap(s);
        setPage(r);
      } catch (err) {
        if (seq === loadSeq.current) setError(err instanceof Error ? err.message : "Couldn't read usage logs.");
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    [query]
  );

  const loadLimits = useCallback(async (fresh = false) => {
    try {
      const res = fresh
        ? await fetch("/api/usage/coding", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "refresh-limits" }),
          })
        : await fetch("/api/usage/coding?view=limits");
      if (res.ok) setLimits((await res.json()) as Record<string, AccountLimits>);
    } catch {
      // Cards keep saying "checking" until the next try.
    }
  }, []);

  // Loads start from timers rather than the effect body, so a filter change
  // renders once before its fetch begins.
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    const first = setTimeout(() => void loadLimits(), 0);
    return () => clearTimeout(first);
  }, [loadLimits]);

  /*
   * New requests land in the logs as you work, so the page re-reads everything
   * — a fresh scan and fresh plan limits, the same as the Refresh button — on
   * the interval chosen in Settings › AI Usage (every 3 minutes unless changed).
   * Hidden windows skip their turn; there's nobody to read the numbers.
   */
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    if (!refreshMinutes) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refreshRef.current();
    }, refreshMinutes * 60_000);
    return () => clearInterval(t);
  }, [refreshMinutes]);

  // A pending sign-in polls fast regardless, so its card fills in promptly.
  const waiting = snap?.accounts.some((a) => a.waiting) ?? false;
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => void load(), 4_000);
    return () => clearInterval(t);
  }, [load, waiting]);

  // A finished sign-in is a new login to read limits for.
  const readyKeys = useRef("");
  useEffect(() => {
    const keys = (snap?.accounts ?? [])
      .filter((a) => !a.waiting)
      .map((a) => a.key)
      .join(",");
    if (readyKeys.current && keys !== readyKeys.current) void loadLimits(true);
    readyKeys.current = keys;
  }, [snap, loadLimits]);

  async function post(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/usage/coding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "That didn't work.");
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setRefreshing(true);
    await Promise.all([load(true), loadLimits(true)]);
    setRefreshing(false);
  }
  useEffect(() => {
    refreshRef.current = refresh;
  });

  async function more() {
    if (!page) return;
    setMoreBusy(true);
    try {
      const res = await fetch(`/api/usage/coding?${query({ view: "requests", offset: String(page.rows.length), limit: String(PAGE) })}`);
      const next = (await res.json()) as CodingRequestPage;
      setPage({ total: next.total, rows: [...page.rows, ...next.rows] });
    } finally {
      setMoreBusy(false);
    }
  }

  const accountsShown = useMemo(() => (snap?.accounts ?? []).filter((a) => tool === "all" || a.tool === tool), [snap, tool]);
  const selectedAccount = snap?.accounts.find((a) => a.key === account) ?? null;
  const toolRows = snap?.tools ?? [];
  const toolTabs = TOOL_ORDER.filter((x) => toolRows.some((r) => r.tool === x) || snap?.accounts.some((a) => a.tool === x));
  const maxModel = Math.max(0.0001, ...(snap?.models ?? []).map((m) => m.costUsd));
  const maxProject = Math.max(0.0001, ...(snap?.projects ?? []).map((p) => p.costUsd));
  const t = snap?.totals;
  const promptTokens = t ? t.input + t.cacheRead + t.cacheWrite : 0;
  const cachedPct = t && promptTokens ? (t.cacheRead / promptTokens) * 100 : null;

  return (
    <div className="shell usage-mode">
      <div className="main">
        <header className="ui-top">
          <button type="button" className="ui-back" onClick={clear} aria-label="Back to the launcher">
            <Icon path={ICON.chevronLeft} size={13} />
            Slates
          </button>
          <span className="ui-top-title">AI Usage</span>
          <span className="ui-top-sub">Every coding tool, every account</span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="ui-back"
            onClick={refresh}
            disabled={refreshing}
            aria-label="Refresh"
            title={refreshMinutes ? `Refreshes on its own every ${refreshMinutes} min` : "Auto-refresh is off"}
          >
            {refreshing ? <Spinner size={12} /> : <Icon path={[ICON.sync, ICON.sync2, ICON.sync3]} size={13} />}
            <span className="ui-back-text">Refresh</span>
          </button>
          <button type="button" className="ui-back" onClick={() => openSettings()} aria-label="Settings">
            <Icon path={ICON.settings} size={13} />
            <span className="ui-back-text">Settings</span>
          </button>
        </header>

        <div className="scroll usage-scroll">
          <div className="upage">
            <div className="utoolbar">
              <div className="utoolbar-start">
                <Segmented
                  label="View"
                  value={view}
                  onChange={setView}
                  options={[
                    { id: "usage", label: "Usage" },
                    { id: "capacity", label: "Max capacity" },
                  ]}
                />
                {view === "usage" && <Segmented label="Range" value={range} onChange={setRange} options={RANGES} />}
              </div>
              {view === "usage" && toolTabs.length > 1 && (
                <div className="useg useg--tools" role="tablist" aria-label="Tool">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tool === "all"}
                    className={tool === "all" ? "is-on" : undefined}
                    onClick={() => {
                      setTool("all");
                      setAccount(null);
                    }}
                  >
                    All tools
                  </button>
                  {toolTabs.map((x) => (
                    <button
                      key={x}
                      type="button"
                      role="tab"
                      aria-selected={tool === x}
                      className={tool === x ? "is-on" : undefined}
                      onClick={() => {
                        setTool(x);
                        if (selectedAccount && selectedAccount.tool !== x) setAccount(null);
                      }}
                    >
                      <ToolMark tool={x} size={12} />
                      {TOOL_LABEL[x]}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {view === "usage" && selectedAccount && (
              <div className="ufilter">
                <span>
                  Showing only <strong>{selectedAccount.label}</strong>
                </span>
                <button type="button" className="btn btn--quiet" onClick={() => setAccount(null)}>
                  Show all accounts
                </button>
              </div>
            )}

            {error && <div className="usage-error">{error}</div>}

            {view === "capacity" ? (
              <CapacityView refreshToken={snap?.generatedAt ?? 0} />
            ) : loading && !snap ? (
              <div className="usage-loading">
                <Spinner size={18} />
                Reading your Claude Code, Codex and Gemini logs. The first time takes a moment.
              </div>
            ) : snap && t ? (
              <>
                <section className="ustats" aria-label="Totals">
                  <Stat label="API value" value={usd(t.costUsd)} hint="These tokens at pay-as-you-go prices" />
                  <Stat label="Requests" value={count(t.requests)} hint={`${usd(t.avgUsd)} per request on average`} />
                  <Stat
                    label="Tokens"
                    value={tokens(t.tokens)}
                    hint={`${tokens(t.input)} in · ${tokens(t.output)} out · ${tokens(t.cacheRead + t.cacheWrite)} cached`}
                  />
                  <Stat
                    label="Cached"
                    value={cachedPct == null ? "—" : `${cachedPct >= 99.95 ? "100" : cachedPct.toFixed(1)}%`}
                    hint="Of input served from cache, billed at about a tenth"
                  />
                </section>

                <section className="usec">
                  <div className="usec-head">
                    <h2>Accounts</h2>
                    <span className="usec-sub">
                      {accountsShown.length} {accountsShown.length === 1 ? "account" : "accounts"}
                    </span>
                    <span className="uspacer" />
                    {!linking && (
                      <button type="button" className="btn btn--primary" onClick={() => setLinking(true)}>
                        <Icon path={ICON.plus} size={12} />
                        Link account
                      </button>
                    )}
                  </div>
                  {linking && (
                    <LinkPanel
                      busy={busy}
                      onClose={() => setLinking(false)}
                      onLink={async (tl, label) => {
                        if (await post({ action: "link", tool: tl, label })) {
                          setLinking(false);
                          void load();
                        }
                      }}
                    />
                  )}
                  {accountsShown.length === 0 ? (
                    <p className="usage-empty">No signed-in CLIs found. Sign into Claude Code, Codex or Gemini, or link an account.</p>
                  ) : (
                    <div className="uaccts">
                      {accountsShown.map((row) => (
                        <AccountCard
                          key={row.key}
                          row={row}
                          limits={limits?.[row.key]}
                          busy={busy}
                          selected={account === row.key}
                          onSelect={() => setAccount((a) => (a === row.key ? null : row.key))}
                          onAction={async (action, homeId) => {
                            if (await post({ action, homeId })) {
                              if (action === "unlink" && account === row.key) setAccount(null);
                              void load();
                            }
                          }}
                          onSaveMeta={async (label) => {
                            const ok = await post({ action: "meta", key: row.key, label });
                            if (ok) void load();
                            return ok;
                          }}
                        />
                      ))}
                    </div>
                  )}
                </section>

                <section className="usec card card--pad">
                  <div className="usec-head">
                    <h2>{range === "today" ? "Today" : "By day"}</h2>
                    <span className="uspacer" />
                    <Segmented
                      label="Metric"
                      value={metric}
                      onChange={setMetric}
                      options={[
                        { id: "cost", label: "Cost" },
                        { id: "tokens", label: "Tokens" },
                      ]}
                    />
                  </div>
                  <Chart days={snap.days} hourly={range === "today"} metric={metric} />
                  {toolRows.length > 1 && (
                    <div className="ulegend">
                      {toolRows.map((r) => (
                        <span key={r.tool}>
                          <i style={{ background: TOOL_COLOR[r.tool] }} />
                          {TOOL_LABEL[r.tool]}
                          <b>{usd(r.costUsd)}</b>
                        </span>
                      ))}
                    </div>
                  )}
                </section>

                <div className="ugrid2">
                  <section className="usec card card--pad">
                    <div className="usec-head">
                      <h2>Models</h2>
                    </div>
                    {snap.models.length === 0 ? (
                      <p className="usage-empty">No requests in this range.</p>
                    ) : (
                      <div className="utable utable--models" role="table">
                        <div className="utr utr--head" role="row">
                          <span role="columnheader">Model</span>
                          <span role="columnheader">Requests</span>
                          <span role="columnheader">Per req.</span>
                          <span role="columnheader">Cost</span>
                        </div>
                        {snap.models.map((m) => (
                          <div key={`${m.tool}:${m.model}`} className="utr" role="row">
                            <span role="cell" className="utd-name">
                              <ToolMark tool={m.tool} size={12} />
                              <span className="umono utd-ellipsis" title={m.model}>
                                {m.model}
                              </span>
                              {m.estimated && (
                                <span className="uest" title="Not on any price list yet, so priced like others in its family">
                                  est.
                                </span>
                              )}
                            </span>
                            <span role="cell" data-label="Requests">
                              {count(m.requests)}
                            </span>
                            <span role="cell" data-label="Per req.">
                              {usd(m.costUsd / m.requests)}
                            </span>
                            <span role="cell" className="utd-strong">
                              {usd(m.costUsd)}
                            </span>
                            <span className="ubar" aria-hidden>
                              <span style={{ width: `${(m.costUsd / maxModel) * 100}%`, background: TOOL_COLOR[m.tool] }} />
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="usec card card--pad">
                    <div className="usec-head">
                      <h2>Projects</h2>
                    </div>
                    {snap.projects.length === 0 ? (
                      <p className="usage-empty">No project folders in this range.</p>
                    ) : (
                      <ul className="uprojects">
                        {snap.projects.map((p) => (
                          <li key={p.project} title={p.project}>
                            <span className="uproject-name">{shortPath(p.project)}</span>
                            <span className="uproject-meta">
                              {count(p.requests)} req · <b>{usd(p.costUsd)}</b>
                            </span>
                            <span className="ubar" aria-hidden>
                              <span style={{ width: `${(p.costUsd / maxProject) * 100}%` }} />
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>

                <section className="usec card card--pad">
                  <div className="usec-head">
                    <h2>Requests</h2>
                    <span className="usec-sub">{page ? `${count(page.total)} in range` : ""}</span>
                  </div>
                  {!page || page.rows.length === 0 ? (
                    <p className="usage-empty">No requests in this range.</p>
                  ) : (
                    <>
                      <div className="utable utable--reqs" role="table">
                        <div className="utr utr--head" role="row">
                          <span role="columnheader">Time</span>
                          <span role="columnheader">Account</span>
                          <span role="columnheader">Model</span>
                          <span role="columnheader">Input</span>
                          <span role="columnheader">Output</span>
                          <span role="columnheader">Cache</span>
                          <span role="columnheader">Cost</span>
                        </div>
                        {page.rows.map((r) => (
                          <div key={r.id} className="utr" role="row">
                            <span role="cell" className="utd-time">
                              {when(r.at)}
                            </span>
                            <span role="cell" className="utd-name utd-account">
                              <ToolMark tool={r.tool} size={12} />
                              <span className="utd-ellipsis" title={r.project ?? undefined}>
                                {r.accountLabel}
                              </span>
                            </span>
                            <span role="cell" className="umono utd-ellipsis utd-model" title={r.model}>
                              {r.model}
                            </span>
                            <span role="cell" data-label="In">
                              {tokens(r.input)}
                            </span>
                            <span role="cell" data-label="Out">
                              {tokens(r.output)}
                            </span>
                            <span role="cell" data-label="Cache" title={`${count(r.cacheRead)} read · ${count(r.cacheWrite)} written`}>
                              {tokens(r.cacheRead + r.cacheWrite)}
                            </span>
                            <span role="cell" className="utd-strong utd-cost">
                              {usd(r.costUsd)}
                            </span>
                          </div>
                        ))}
                      </div>
                      {page.rows.length < page.total && (
                        <div className="umore">
                          <button type="button" className="btn btn--quiet" onClick={more} disabled={moreBusy}>
                            {moreBusy ? <Spinner size={12} /> : null}
                            Show {Math.min(PAGE, page.total - page.rows.length)} more
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </section>

                <p className="ufoot">
                  Costs are what the same tokens would cost on each provider&rsquo;s API, cache reads and writes included. Prices
                  come from{" "}
                  {snap.pricing.source === "models.dev"
                    ? "models.dev"
                    : snap.pricing.source === "litellm"
                      ? "LiteLLM's public price sheet"
                      : "Slates' built-in table"}
                  , with Anthropic&rsquo;s list prices for Claude and long-context rates where a request crosses them; models
                  marked <em>est.</em> aren&rsquo;t listed anywhere yet and are priced like others in their family. Logs from the
                  everyday CLI are credited to whoever was signed in at the time, from when Slates first saw them.
                </p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
