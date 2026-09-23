"use client";

import { useCallback, useEffect, useState } from "react";

import type { PublicPlan, UsageProvider, UsageSnapshot } from "@/lib/ai-usage/types";
import { PROVIDER_LABEL } from "@/lib/ai-usage/types";

/**
 * The keys Slates' own agents use — tutor, counselor, voice. Several can stay
 * saved per provider and one is marked in use; agents pick it up on their
 * next call without editing .env. Separate from the coding accounts above,
 * which belong to the CLIs.
 */

const LINK_PROVIDERS: { id: UsageProvider; kinds: ("api" | "subscription")[] }[] = [
  { id: "openai", kinds: ["api", "subscription"] },
  { id: "openrouter", kinds: ["api"] },
  { id: "elevenlabs", kinds: ["api", "subscription"] },
  { id: "claude-code", kinds: ["subscription"] },
  { id: "cursor", kinds: ["subscription"] },
];

export default function SlatesKeys() {
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [provider, setProvider] = useState<UsageProvider>("openai");
  const [kind, setKind] = useState<"api" | "subscription">("api");
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [monthly, setMonthly] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/usage?range=30d");
      if (res.ok) setPlans(((await res.json()) as UsageSnapshot).plans);
    } catch {
      // The section just stays empty.
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  function pickProvider(next: UsageProvider) {
    setProvider(next);
    const row = LINK_PROVIDERS.find((p) => p.id === next);
    if (row && !row.kinds.includes(kind)) setKind(row.kinds[0]!);
  }

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string; snapshot?: UsageSnapshot };
      if (!res.ok) throw new Error(data.error || "Update failed.");
      if (data.snapshot) setPlans(data.snapshot.plans);
      else await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onLink(e: React.FormEvent) {
    e.preventDefault();
    const ok = await post({
      action: "link",
      provider,
      label: label.trim() || PROVIDER_LABEL[provider],
      kind,
      secret: kind === "api" ? secret : undefined,
      monthlyUsd: kind === "subscription" && monthly ? Number(monthly) : null,
    });
    if (ok) {
      setLabel("");
      setSecret("");
      setMonthly("");
    }
  }

  const kinds = LINK_PROVIDERS.find((p) => p.id === provider)?.kinds ?? ["api"];
  const grouped: Record<string, PublicPlan[]> = {};
  for (const p of plans) (grouped[p.provider] ??= []).push(p);

  return (
    <div className="ukeys">
      {error && <div className="usage-error">{error}</div>}
      {plans.length === 0 ? (
        <p className="usage-empty">No keys yet. Slates uses the ones in .env until you link one.</p>
      ) : (
        Object.entries(grouped).map(([prov, list]) => (
          <div key={prov} className="ukeys-group">
            <div className="ukeys-provider">{PROVIDER_LABEL[prov as UsageProvider]}</div>
            <ul className="ukeys-list">
              {list.map((p) => (
                <li key={p.id}>
                  <div className="ukeys-name">
                    <strong>
                      {p.label}
                      {p.active ? <span className="upill">in use</span> : null}
                    </strong>
                    <span>
                      {p.kind === "api" ? "API key" : "Subscription"}
                      {p.keyHint ? ` · ${p.keyHint}` : ""}
                      {p.monthlyUsd != null ? ` · $${p.monthlyUsd}/mo` : ""}
                    </span>
                  </div>
                  <div className="ukeys-actions">
                    {!p.active && (
                      <button
                        type="button"
                        className="btn btn--quiet"
                        disabled={busy}
                        onClick={() =>
                          void post(
                            p.source === "env"
                              ? { action: "use-env", provider: p.provider }
                              : p.source === "cli"
                                ? { action: "use-cli", provider: p.provider }
                                : { action: "activate", id: p.id }
                          )
                        }
                      >
                        Use
                      </button>
                    )}
                    {p.removable && (
                      <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => void post({ action: "remove", id: p.id })}>
                        Remove
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      <form className="ukeys-form" onSubmit={onLink}>
        <label>
          Provider
          <select className="input" value={provider} onChange={(e) => pickProvider(e.target.value as UsageProvider)}>
            {LINK_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {PROVIDER_LABEL[p.id]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Kind
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as "api" | "subscription")}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k === "api" ? "API key" : "Subscription"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Label
          <input className="input" value={label} maxLength={40} placeholder="Work OpenAI" onChange={(e) => setLabel(e.target.value)} />
        </label>
        {kind === "api" ? (
          <label>
            API key
            <input
              className="input"
              type="password"
              value={secret}
              placeholder="sk-…"
              onChange={(e) => setSecret(e.target.value)}
              required
              autoComplete="off"
            />
          </label>
        ) : (
          <label>
            Monthly USD
            <input className="input" type="number" min={0} step={1} value={monthly} placeholder="20" onChange={(e) => setMonthly(e.target.value)} />
          </label>
        )}
        <button type="submit" className="btn btn--primary" disabled={busy}>
          Add key
        </button>
      </form>
    </div>
  );
}
