"use client";

import { useState } from "react";

import {
  APPS,
  REFRESH_CHOICES,
  useHiddenApps,
  useHiddenRegistries,
  useUsageRefreshMinutes,
} from "@/lib/app-prefs";
import { UI_REGISTRIES } from "@/lib/ui-registries";
import SlatesKeys from "./usage/SlatesKeys";
import { Toggle } from "./ui";

/**
 * The settings tabs that aren't School's or Counselor's: which apps Slates
 * shows at all, and what the UI shelf and AI Usage keep as preferences. Each
 * used to be either nowhere (the shelf) or tucked inside its own page (the
 * usage keys), which is the scattering the one settings screen exists to end.
 */

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="scroll centered" style={{ paddingBottom: 32 }}>
      <div className="col" style={{ maxWidth: 760, gap: 16 }}>
        {children}
      </div>
    </div>
  );
}

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: "20px 22px" }}>
      <span className="card-title">{title}</span>
      {note && <p className="app-settings-note">{note}</p>}
      <div style={{ marginTop: 14 }}>{children}</div>
    </div>
  );
}

function Row({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <li className="app-settings-row">
      <span className="app-settings-text">
        <strong>{title}</strong>
        {sub && <span>{sub}</span>}
      </span>
      {children}
    </li>
  );
}

/* ── General ───────────────────────────────────────────────────────────── */

export function GeneralSettings() {
  const [hidden, setVisible] = useHiddenApps();
  const visibleCount = APPS.filter((a) => !hidden.includes(a.mode)).length;

  return (
    <Page>
      <Card
        title="Apps"
        note="Which apps get a door on the home screen. A hidden app keeps everything it saved, and its settings tab comes back when you turn it on again."
      >
        <ul className="app-settings-list">
          {APPS.map((app) => {
            const on = !hidden.includes(app.mode);
            const last = on && visibleCount === 1;
            return (
              <Row key={app.mode} title={app.title} sub={last ? `${app.blurb} · the last app stays on` : app.blurb}>
                <Toggle
                  on={on}
                  label={`Show ${app.title}`}
                  onClick={() => {
                    if (!last) setVisible(app.mode, !on);
                  }}
                />
              </Row>
            );
          })}
        </ul>
      </Card>
    </Page>
  );
}

/* ── UI ────────────────────────────────────────────────────────────────── */

const MCP_COMMAND = "claude mcp add slates-ui -- npx tsx <slates>/web/scripts/ui-mcp.mts";

export function UiSettings() {
  const [hidden, setShown] = useHiddenRegistries();
  const [copied, setCopied] = useState(false);

  return (
    <Page>
      <Card title="Libraries on the shelf" note="Turn a library off to keep its components out of the shelf and its search.">
        <ul className="app-settings-list">
          {UI_REGISTRIES.map((r) => {
            const on = !hidden.includes(r.id);
            return (
              <Row key={r.id} title={r.name} sub={`~${r.approx} · ${r.blurb}`}>
                <Toggle on={on} label={`Show ${r.name}`} onClick={() => setShown(r.id, !on)} />
              </Row>
            );
          })}
        </ul>
      </Card>

      <Card
        title="Coding agents"
        note="The same libraries are served to coding agents over a local MCP server, slates-ui: search_components, get_component (full source, dependencies, and the install command), install_command, and list_registries. It reads every library, whatever the shelf shows."
      >
        <div className="app-settings-code">
          <code>{MCP_COMMAND}</code>
          <button
            type="button"
            className="btn btn--quiet"
            style={{ height: 26, padding: "0 10px", fontSize: 11 }}
            onClick={() => {
              void navigator.clipboard?.writeText(MCP_COMMAND).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </Card>
    </Page>
  );
}

/* ── AI Usage ──────────────────────────────────────────────────────────── */

export function UsageSettings() {
  const [minutes, setMinutes] = useUsageRefreshMinutes();

  return (
    <Page>
      <Card
        title="Auto-refresh"
        note="How often AI Usage rescans the coding logs and re-checks plan limits while it's open. Refresh in the page does the same thing on demand."
      >
        <div className="settings-tabs app-settings-choices" role="radiogroup" aria-label="Auto-refresh interval">
          {REFRESH_CHOICES.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={minutes === n}
              className={`settings-tab${minutes === n ? " is-on" : ""}`}
              onClick={() => setMinutes(n)}
            >
              {n === 0 ? "Off" : `${n} min`}
            </button>
          ))}
        </div>
      </Card>

      <Card title="Slates API keys" note="The keys the tutor, counselor and voice use.">
        <SlatesKeys />
      </Card>
    </Page>
  );
}
