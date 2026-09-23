"use client";

import { useEffect, useState } from "react";

import type { AccountCapacity, CapacitySnapshot } from "@/lib/ai-usage/coding/capacity";
import { TOOL_LABEL } from "@/lib/ai-usage/coding/types";
import { Spinner } from "../ui";
import { TOOL_COLOR, ToolMark, tokens, usd } from "./UsageApp";

/**
 * Max capacity — what every plan could do in a month if each five-hour and
 * weekly window were run to the top, and how much of that you're using.
 *
 * Each window is sized from its own meter: what was spent since it opened,
 * divided by how full it says it is. See lib/ai-usage/coding/capacity.ts.
 */

function pct(n: number): string {
  if (n >= 99.5) return "100%";
  return n >= 10 ? `${Math.round(n)}%` : `${n.toFixed(1)}%`;
}

function perMonth(n: number): string {
  return n >= 10 ? `×${Math.round(n)}` : `×${n.toFixed(1)}`;
}

function AccountRow({ a, onMeasured }: { a: AccountCapacity; onMeasured: () => void }) {
  const [measuring, setMeasuring] = useState(false);
  const [measureError, setMeasureError] = useState<string | null>(null);

  async function measure() {
    if (!a.measureHomeId) return;
    setMeasuring(true);
    setMeasureError(null);
    try {
      const res = await fetch("/api/usage/coding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "calibrate", homeId: a.measureHomeId }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Measuring didn't work.");
      onMeasured();
    } catch (err) {
      setMeasureError(err instanceof Error ? err.message : "Measuring didn't work.");
    } finally {
      setMeasuring(false);
    }
  }

  const share = a.monthUsd ? Math.min(100, (a.used30Usd / a.monthUsd) * 100) : null;
  return (
    <article className="ucap-acct" style={{ ["--tool" as string]: TOOL_COLOR[a.tool] }}>
      <header className="ucap-head">
        <span className="uacct-mark">
          <ToolMark tool={a.tool} size={15} />
        </span>
        <span className="ucap-title">
          <strong title={a.label}>
            {a.label}
            {a.estimated && (
              <span className="uest" title="Sized from another of your plans, not measured">
                est.
              </span>
            )}
          </strong>
          <span>
            {TOOL_LABEL[a.tool]}
            {a.plan ? ` · ${a.plan}` : ""}
          </span>
        </span>
        {a.monthTokens != null ? (
          <span className="ucap-max">
            <strong>{tokens(a.monthTokens)}</strong>
            <span>{usd(a.monthUsd ?? 0)} of API value / month</span>
          </span>
        ) : null}
      </header>

      {a.monthTokens != null && share != null && (
        <div className="ucap-share">
          <div className="ucap-share-line">
            <span>
              Used in the last 30 days: <b>{tokens(a.used30Tokens)}</b> · {usd(a.used30Usd)}
            </span>
            <span className="ucap-share-pct">{pct(share)} of max</span>
          </div>
          <span className="ulimit-bar" aria-hidden>
            <span style={{ width: `${Math.max(share, 0.5)}%`, background: TOOL_COLOR[a.tool] }} />
          </span>
        </div>
      )}

      {a.windows.length > 0 && (
        <div className="utable ucap-table" role="table">
          <div className="utr utr--head" role="row">
            <span role="columnheader">Window</span>
            <span role="columnheader">Now</span>
            <span role="columnheader">One full window</span>
            <span role="columnheader">Per month</span>
            <span role="columnheader">Month if maxed</span>
          </div>
          {a.windows.map((w) => (
            <div key={w.id} className={`utr${a.binding.includes(w.label) ? " is-binding" : ""}`} role="row">
              <span role="cell" className="ucap-window">
                {w.label}
                {a.binding.includes(w.label) && <span className="upill">ceiling</span>}
              </span>
              <span role="cell" data-label="Now">
                {pct(w.usedPct)}
              </span>
              <span
                role="cell"
                data-label="Full"
                title={w.live ? "Measured from the window open now" : `Measured when a window was ${pct(w.measuredPct)} full`}
              >
                {tokens(w.tokens)} · {usd(w.usd)}
              </span>
              <span role="cell" data-label="Windows">
                {perMonth(w.perMonth)}
              </span>
              <span role="cell" className="utd-strong" data-label="Month">
                {tokens(w.monthTokens)} · {usd(w.monthUsd)}
              </span>
            </div>
          ))}
        </div>
      )}

      {a.note && <p className="ulimits-note">{a.note}</p>}
      {measureError && <p className="ulimits-note ucap-error">{measureError}</p>}
      {a.measureHomeId && (
        <footer className="uacct-actions">
          <button type="button" className="btn btn--quiet" onClick={measure} disabled={measuring}>
            {measuring ? <Spinner size={12} /> : null}
            {measuring ? "Measuring… about a minute" : a.windows.length ? "Measure again" : "Measure"}
          </button>
        </footer>
      )}
    </article>
  );
}

export default function CapacityView({ refreshToken }: { refreshToken: number }) {
  const [data, setData] = useState<CapacitySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bump, setBump] = useState(0);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/usage/coding?view=capacity");
        if (!res.ok) throw new Error("Couldn't size your plans.");
        const next = (await res.json()) as CapacitySnapshot;
        if (alive) {
          setData(next);
          setError(null);
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Couldn't size your plans.");
      }
    }, 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [refreshToken, bump]);

  if (error && !data) return <div className="usage-error">{error}</div>;
  if (!data) {
    return (
      <div className="usage-loading">
        <Spinner size={18} />
        Sizing every plan from its limits…
      </div>
    );
  }

  const { totals } = data;
  const share = totals.monthUsd ? Math.min(100, (totals.used30Usd / totals.monthUsd) * 100) : null;

  return (
    <>
      <section className="ucap-hero card card--pad">
        <div className="ucap-hero-main">
          <span className="ustat-label">If you maxed every plan</span>
          <strong className="ucap-hero-value">{totals.estimated ? `${tokens(totals.monthTokens)} tokens / month` : "Not measured yet"}</strong>
          <span className="ucap-hero-sub">
            {totals.estimated
              ? `Worth about ${usd(totals.monthUsd)} a month at API prices, across ${totals.estimated} ${totals.estimated === 1 ? "plan" : "plans"}.`
              : "Each plan is sized from its limit meters once a window is a few percent used."}
          </span>
        </div>
        {share != null && (
          <div className="ucap-hero-share">
            <span className="ustat-label">You&rsquo;re using</span>
            <strong className="ucap-hero-value">{pct(share)}</strong>
            <span className="ucap-hero-sub">
              {tokens(totals.used30Tokens)} · {usd(totals.used30Usd)} in the last 30 days
            </span>
          </div>
        )}
      </section>

      <div className="ucap-list">
        {data.accounts.map((a) => (
          <AccountRow key={a.key} a={a} onMeasured={() => setBump((n) => n + 1)} />
        ))}
      </div>

      <p className="ufoot">
        Each window is sized from its own meter: what you spent since it opened, divided by how full it reads. A month
        holds 144 five-hour windows and about 4.3 weekly ones; the window that allows the least is the plan&rsquo;s ceiling,
        marked <em>ceiling</em>. Readings from a fuller window are kept and preferred, so the numbers firm up as you use
        each plan. Tokens include cache reads, which plans count at a discount, so compare plans by API value.
      </p>
    </>
  );
}
