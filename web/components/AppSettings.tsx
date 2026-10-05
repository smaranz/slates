"use client";

import { useEffect, useState } from "react";

import {
  REFRESH_CHOICES,
  useDeviceApps,
  useHiddenApps,
  useHiddenRegistries,
  useHostApps,
  useUsageRefreshMinutes,
} from "@/lib/app-prefs";
import { UI_REGISTRIES } from "@/lib/ui-registries";
import { MCP_COMMAND } from "@/lib/media/mcp-command";
import SlatesKeys from "./usage/SlatesKeys";
import { Toggle } from "./ui";

/**
 * The settings tabs that aren't School's or Counselor's: which apps Slates
 * shows at all, the UI shelf and AI Usage preferences, and Media's ElevenLabs
 * connection and coding-agent tools. Each used to be either nowhere (the
 * shelf) or tucked inside its own page (the usage keys), which is the
 * scattering the one settings screen exists to end.
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
  const { unavailable } = useHostApps();
  const apps = useDeviceApps();
  const visibleCount = apps.filter((a) => !hidden.includes(a.mode)).length;

  return (
    <Page>
      <Card
        title="Apps"
        note="Which apps get a door on the home screen. A hidden app keeps everything it saved, and its settings tab comes back when you turn it on again."
      >
        <ul className="app-settings-list">
          {apps.map((app) => {
            if (unavailable.includes(app.mode)) {
              return (
                <Row key={app.mode} title={app.title} sub={`${app.blurb} · needs Slates hosted on a Mac`}>
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>Unavailable</span>
                </Row>
              );
            }
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
      <DevicesCard />
    </Page>
  );
}

interface PairedDevice {
  id: string;
  name: string;
  createdAt: number;
  lastSeen: number;
}

function lastUsed(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 60) return "used in the last hour";
  if (minutes < 24 * 60) return `used ${Math.round(minutes / 60)}h ago`;
  return `used ${new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

interface DevicesData {
  devices: PairedDevice[];
  current: string | null;
  local: boolean;
}

const fetchDevices = (): Promise<DevicesData | null> =>
  fetch("/api/devices", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);

/** The devices that can open this Slates without Tailscale; see lib/devices.ts. Hidden where there's nothing to pair (Slates on this machine only). */
function DevicesCard() {
  const [data, setData] = useState<DevicesData | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number; known: string[] } | null>(null);
  const [pairNote, setPairNote] = useState<string | null>(null);

  const load = () => void fetchDevices().then(setData);
  useEffect(() => {
    const first = window.setTimeout(load, 0);
    return () => window.clearTimeout(first);
  }, []);

  // While a code shows, watch for the device it pairs.
  useEffect(() => {
    if (!pairing) return;
    const timer = window.setInterval(() => {
      if (Date.now() > pairing.expiresAt) {
        setPairing(null);
        setPairNote("That code ran out. Get another when the device is ready.");
        return;
      }
      void fetchDevices().then((next) => {
        if (!next) return;
        setData(next);
        const added = next.devices.find((device) => !pairing.known.includes(device.id));
        if (!added) return;
        setPairing(null);
        setPairNote(`Paired ${added.name}.`);
      });
    }, 2500);
    return () => window.clearInterval(timer);
  }, [pairing]);

  if (!data || (data.local && !data.devices.length)) return null;

  const getCode = () => {
    setPairNote(null);
    void fetch("/api/devices/code", { method: "POST" })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null)
      .then((offer: { code: string; expiresAt: number } | null) => {
        if (offer) setPairing({ ...offer, known: data.devices.map((device) => device.id) });
        else setPairNote("Couldn't get a code. Try again.");
      });
  };

  const forget = (id: string) => {
    if (confirming !== id) {
      setConfirming(id);
      window.setTimeout(() => setConfirming((current) => (current === id ? null : current)), 4000);
      return;
    }
    setConfirming(null);
    void fetch(`/api/devices?id=${id}`, { method: "DELETE" }).then(load);
  };

  return (
    <Card
      title="Devices"
      note="These can open Slates from anywhere without Tailscale. To add one, get a code here and type it on the new device's “not paired” screen. Forget one you've lost and it's locked out."
    >
      <ul className="app-settings-list">
        <li className="app-settings-row">
          <span className="app-settings-text" aria-live="polite">
            {pairing ? <strong className="app-settings-pair-code">{`${pairing.code.slice(0, 4)} ${pairing.code.slice(4)}`}</strong> : <strong>Pair a new device</strong>}
            <span>{pairing ? "Type this on the new device. It works once, for the next 10 minutes." : (pairNote ?? "Get a code to type on it. No Tailscale needed.")}</span>
          </span>
          {pairing ? (
            <button type="button" className="btn btn--quiet" onClick={() => setPairing(null)}>
              Hide
            </button>
          ) : (
            <button type="button" className="btn btn--primary" onClick={getCode}>
              Get a code
            </button>
          )}
        </li>
        {data.devices.map((device) => (
          <Row key={device.id} title={device.id === data.current ? `${device.name} (this one)` : device.name} sub={`Paired ${new Date(device.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${lastUsed(device.lastSeen)}`}>
            <button type="button" className="btn btn--quiet" onClick={() => forget(device.id)}>
              {confirming === device.id ? (device.id === data.current ? "Forget this device?" : "Forget it?") : "Forget"}
            </button>
          </Row>
        ))}
        {!data.devices.length && <Row title="No devices yet" sub="Get a code above to pair one.">{null}</Row>}
      </ul>
    </Card>
  );
}

/* ── UI ────────────────────────────────────────────────────────────────── */

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
        note="The same libraries are served to coding agents over slates-ui: search_components, get_component (full source, dependencies, and the install command), install_command, and list_registries. It reads every library, whatever the shelf shows, and also serves the media library: list_media, get_media, save_media, generate_image, generate_video, generate_speech, generate_sound_effect, generate_music, and list_media_models."
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

export function MediaSettings() {
  const [connection, setConnection] = useState<{ status: "checking" | "connected" | "error"; note?: string }>({ status: "checking" });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/media/voices", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "ElevenLabs isn't connected.");
        if (active) setConnection({ status: "connected", note: `${body.voices?.length ?? 0} voices available.` });
      })
      .catch((error: unknown) => {
        if (active) setConnection({ status: "error", note: error instanceof Error ? error.message : String(error) });
      });
    return () => { active = false; };
  }, []);

  return (
    <Page>
      <Card title="ElevenLabs" note="Link a key in AI Usage, or set ELEVENLABS_API_KEY in ~/.slates/.env and restart Slates.">
        <p style={{ margin: 0, color: connection.status === "connected" ? "var(--good)" : connection.status === "error" ? "var(--warn)" : "var(--muted)", fontSize: 13 }}>
          {connection.status === "checking" ? "Checking connection…" : connection.status === "connected" ? `Connected · ${connection.note}` : connection.note}
        </p>
      </Card>
      <Card title="Coding agents" note="The same slates-ui server serves the media library: list_media, get_media, save_media, generate_image, generate_video, generate_speech, generate_sound_effect, generate_music, and list_media_models.">
        <div className="app-settings-code">
          <code>{MCP_COMMAND}</code>
          <button type="button" className="btn btn--quiet" style={{ height: 26, padding: "0 10px", fontSize: 11 }} onClick={() => {
            void navigator.clipboard?.writeText(MCP_COMMAND).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}>{copied ? "Copied" : "Copy"}</button>
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
