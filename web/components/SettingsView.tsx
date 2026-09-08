"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { readAvatarFile } from "@/lib/avatar";
import { useStore } from "@/lib/store";
import type { TutorModelBackend } from "@/lib/tutor-models";
import { useTutorModel, useTutorThinking } from "@/lib/use-tutor-model";
import ModelPicker from "./ModelPicker";
import {
  AnthropicLogo,
  Avatar,
  CursorLogo,
  DeepSeekLogo,
  ElevenLabsLogo,
  Dot,
  GeminiLogo,
  MiniMaxLogo,
  OpenAILogo,
  QwenLogo,
  Spinner,
  ZaiLogo,
} from "./ui";
import NotificationSettingsCard from "./NotificationSettingsCard";

interface ProviderInfo {
  /** Tutor backends plus ElevenLabs, which powers narration rather than chat. */
  backend: TutorModelBackend | "elevenlabs";
  label: string;
  powers: string;
  configured: boolean;
  detail: string;
}

type TestState = { status: "idle" | "testing" | "ok" | "error"; error?: string };

const PROVIDER_ICON: Record<ProviderInfo["backend"], ReactNode> = {
  openai: <OpenAILogo size={16} />,
  elevenlabs: <ElevenLabsLogo size={15} />,
  "claude-code": <AnthropicLogo size={16} />,
  "cursor-agent": <CursorLogo size={16} />,
  openrouter: (
    <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
      <DeepSeekLogo size={13} />
      <ZaiLogo size={13} />
      <QwenLogo size={13} />
      <GeminiLogo size={13} />
      <MiniMaxLogo size={13} />
    </span>
  ),
};

export default function SettingsView() {
  const s = useStore();
  const [tutorModel, setTutorModel] = useTutorModel();
  const [tutorThinking, setTutorThinking] = useTutorThinking();

  const fileRef = useRef<HTMLInputElement>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  const [connection, setConnection] = useState<{
    running: boolean;
    domain?: string | null;
    loggedInAt?: string | null;
    /** Whether the *last sync* worked — not whether the service is reachable. */
    ok?: boolean | null;
    error?: string | null;
    lastSyncAt?: number | null;
  } | null>(null);

  const checkConnection = useCallback(async () => {
    setConnection(null);
    try {
      const res = await fetch("/api/scrape", { cache: "no-store" });
      setConnection(await res.json());
    } catch {
      setConnection({ running: false });
    }
  }, []);

  useEffect(() => {
    void checkConnection();
  }, [checkConnection]);

  /*
   * "Connected" has two layers, and conflating them was the whole reason
   * providers looked more solid than they were. `configured` is a free,
   * instant check (an env var is set, or the CLI resolves on PATH) done on
   * every visit. It can't catch an expired CLI login or a revoked key — only
   * a real round trip can — so that only runs when the student asks for it
   * with Test, not on every page load.
   */
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [providersError, setProvidersError] = useState<string | null>(null);
  const [tests, setTests] = useState<Partial<Record<ProviderInfo["backend"], TestState>>>({});

  const checkProviders = useCallback(async () => {
    setProviders(null);
    setProvidersError(null);
    try {
      const res = await fetch("/api/providers", { cache: "no-store" });
      const data = await res.json();
      setProviders(data.providers ?? []);
    } catch {
      setProviders([]);
      setProvidersError("Couldn't reach the portal's own server to check providers.");
    }
  }, []);

  useEffect(() => {
    void checkProviders();
  }, [checkProviders]);

  const runTest = useCallback(async (backend: ProviderInfo["backend"]) => {
    setTests((t) => ({ ...t, [backend]: { status: "testing" } }));
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ backend }),
      });
      const data = await res.json();
      setTests((t) => ({
        ...t,
        [backend]: data.ok ? { status: "ok" } : { status: "error", error: data.error || "Test failed." },
      }));
    } catch (e) {
      setTests((t) => ({
        ...t,
        [backend]: { status: "error", error: e instanceof Error ? e.message : "Test failed." },
      }));
    }
  }, []);

  const testAll = useCallback(() => {
    for (const p of providers ?? []) void runTest(p.backend);
  }, [providers, runTest]);

  // A provider that's never been tested is shown as configured-but-unverified,
  // not as connected — the header count only promotes it once a real call
  // through that exact backend has actually succeeded.
  const connectedCount = useMemo(
    () => (providers ?? []).filter((p) => tests[p.backend]?.status === "ok").length,
    [providers, tests]
  );

  return (
    <div className="scroll centered" style={{ paddingBottom: 32 }}>
      <div className="col" style={{ maxWidth: 1100, gap: 16 }}>
        <div className="card mobile-host-notice">
          <span className="mobile-host-kicker">Mobile connection</span>
          <strong>Your Schoology session stays on the host computer.</strong>
          <p>
            This phone uses the Slates server configured when the native app was built.
            Keep that trusted host and its connection running to sync, send, submit, or use
            server-backed tutor features. Cached board data remains on this device.
          </p>
        </div>
        <div className="settings-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="card" style={{ padding: "20px 22px" }}>
          <span className="card-title">Profile</span>
          <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 14 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                className="pfp-btn"
                onClick={() => fileRef.current?.click()}
                aria-label={s.avatar ? "Change profile photo" : "Add profile photo"}
                disabled={photoBusy}
                style={{ cursor: photoBusy ? "wait" : "pointer" }}
              >
                <Avatar src={s.avatar} name={s.studentName} size={112} />
                <span className="pfp-overlay">{photoBusy ? "…" : s.avatar ? "Change" : "Add"}</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setPhotoError(null);
                  setPhotoBusy(true);
                  void readAvatarFile(file)
                    .then((data) => s.setAvatar(data))
                    .catch((err: unknown) => {
                      setPhotoError(err instanceof Error ? err.message : "Couldn’t read that photo.");
                    })
                    .finally(() => setPhotoBusy(false));
                }}
              />
              {s.avatar && (
                <button
                  type="button"
                  className="btn btn--quiet"
                  style={{ height: 26, padding: "0 10px", fontSize: 11 }}
                  onClick={() => {
                    s.setAvatar(null);
                    setPhotoError(null);
                  }}
                >
                  Remove
                </button>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="field-label">Display name</span>
              <input
                className="input input--lg"
                value={s.studentName}
                onChange={(e) => s.setStudentName(e.target.value)}
                placeholder="Your name"
              />
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)", lineHeight: 1.4 }}>
                Name and photo stay on this device.
              </p>
              {photoError && (
                <p style={{ margin: 0, fontSize: 12, color: "var(--warn)", lineHeight: 1.4 }}>
                  {photoError}
                </p>
              )}
            </div>
          </div>
        </div>

        <NotificationSettingsCard />
        </div>

        {/* The only sync path: a dedicated logged-in browser, driven locally. */}
        <div className="card" style={{ padding: "20px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                width: 8,
                height: 8,
                flexShrink: 0,
                borderRadius: 9999,
                /*
                 * Amber for "running but not syncing". A green light over a
                 * service whose every scrape is failing is how an expired
                 * Schoology session went unnoticed for a day.
                 */
                background: !connection?.running
                  ? "var(--muted)"
                  : connection.ok === false
                    ? "var(--warn)"
                    : "var(--good)",
              }}
            />
            <span className="card-title">Schoology sync</span>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              className={`btn btn--quiet ${connection === null ? "btn--busy" : ""}`}
              style={{ height: 28 }}
              onClick={() => void checkConnection()}
            >
              Check
            </button>
            <button
              type="button"
              className={`btn btn--primary ${s.connecting ? "btn--busy" : ""}`}
              style={{ height: 28 }}
              onClick={() => void s.syncNow(true)}
            >
              {s.connecting ? "Syncing..." : "Sync now"}
            </button>
          </div>

          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
            Runs its own Chrome profile with only Schoology signed in, reads the fully
            rendered pages, and pulls your assignments and due dates.
          </p>

          {connection?.running ? (
            connection.ok === false ? (
              <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--warn)", lineHeight: 1.5 }}>
                Running, but the last sync failed — {connection.error ?? "unknown error"}
                <br />
                Your board is showing the last good copy, so nothing new will appear
                until this is fixed.
              </p>
            ) : (
              <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--good)", lineHeight: 1.5 }}>
                Running · {connection.domain ?? "no domain set"}
                {connection.loggedInAt
                  ? ` · signed in ${new Date(connection.loggedInAt).toLocaleDateString()}`
                  : ""}
              </p>
            )
          ) : (
            <pre
              style={{
                margin: "10px 0 0",
                padding: "10px 12px",
                borderRadius: 10,
                background: "var(--sunken)",
                boxShadow: "var(--shadow-sunken)",
                fontSize: 11.5,
                lineHeight: 1.7,
                color: "var(--text-2)",
                overflowX: "auto",
              }}
            >
{`cd connection
npm run serve      # leave this running`}
            </pre>
          )}

          {s.syncError && (
            <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--warn)", lineHeight: 1.5 }}>
              {s.syncError}
            </p>
          )}

          {/* What the last crawl found, so an empty board is explainable. */}
          {s.syncStats && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
              <span style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
                Last sync: <strong style={{ color: "var(--text-2)" }}>{s.syncStats.courses}</strong>{" "}
                courses · <strong style={{ color: "var(--text-2)" }}>{s.syncStats.items}</strong>{" "}
                items · <strong style={{ color: "var(--text-2)" }}>{s.syncStats.dated}</strong>{" "}
                with due dates
              </span>
            </div>
          )}
        </div>

        <div className="card" style={{ padding: "20px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="card-title">AI Tutor providers</span>
            <span style={{ flex: 1 }} />
            {providers && providers.length > 0 && (
              <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
                {connectedCount}/{providers.length} verified
              </span>
            )}
            <button
              type="button"
              className={`btn btn--quiet ${providers === null ? "btn--busy" : ""}`}
              style={{ height: 28 }}
              onClick={() => void checkProviders()}
            >
              Refresh
            </button>
            <button
              type="button"
              className="btn btn--primary"
              style={{ height: 28 }}
              onClick={testAll}
              disabled={!providers?.length}
            >
              Test all
            </button>
          </div>

          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
            Each Tutor model routes through one of four backends. A key or CLI login being
            present doesn&apos;t prove it still works — Test makes one real, tiny request
            through that backend to check.
          </p>

          {providersError && (
            <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--warn)", lineHeight: 1.5 }}>
              {providersError}
            </p>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 14 }}>
            {(providers ?? []).map((p) => {
              const test = tests[p.backend] ?? { status: "idle" as const };
              const color =
                test.status === "ok"
                  ? "var(--good)"
                  : test.status === "error" || !p.configured
                    ? "var(--bad)"
                    : "var(--muted)";
              const statusText =
                test.status === "ok"
                  ? "Connected"
                  : test.status === "error"
                    ? "Failed"
                    : test.status === "testing"
                      ? "Testing…"
                      : p.configured
                        ? "Not tested"
                        : "Not configured";

              return (
                <div
                  key={p.backend}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 0",
                    borderTop: "1px solid var(--line)",
                  }}
                >
                  <span style={{ flexShrink: 0 }}>{PROVIDER_ICON[p.backend]}</span>
                  <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{p.label}</span>
                    <span className="truncate" style={{ fontSize: 11.5, color: "var(--muted)" }}>
                      {p.powers}
                    </span>
                    {test.status === "error" && (
                      <span style={{ fontSize: 11.5, color: "var(--bad)" }}>{test.error}</span>
                    )}
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, fontSize: 12, color, fontWeight: 600 }}>
                    {test.status === "testing" ? <Spinner size={12} /> : <Dot color={color} radius={9999} />}
                    {statusText}
                  </span>
                  <button
                    type="button"
                    className="btn btn--quiet"
                    style={{ height: 26, padding: "0 10px", fontSize: 11.5, flexShrink: 0 }}
                    onClick={() => void runTest(p.backend)}
                    disabled={test.status === "testing"}
                  >
                    Test
                  </button>
                </div>
              );
            })}

            {providers === null && (
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)" }}>Checking…</p>
            )}
          </div>
        </div>

        <div className="settings-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div className="card" style={{ padding: "20px 22px" }}>
            <span className="card-title">Tutor defaults</span>
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
              The model and thinking level the Tutor opens with. Changing it here or in the
              composer updates the same saved preference either way.
            </p>
            <div style={{ marginTop: 14 }}>
              <ModelPicker
                value={tutorModel}
                onChange={setTutorModel}
                thinking={tutorThinking}
                onThinkingChange={setTutorThinking}
              />
            </div>
          </div>

          <div className="card" style={{ padding: "20px 22px" }}>
            <span className="card-title">Data</span>
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
              Disconnecting clears the synced board from this device — courses, assignments,
              and grades — and drops back to sample data. Nothing changes on Schoology
              itself; Sync now brings it all back.
            </p>
            <button
              type="button"
              className="btn btn--quiet"
              style={{ height: 30, marginTop: 14, color: "var(--bad)" }}
              onClick={() => {
                if (window.confirm("Disconnect Schoology and clear the synced board from this device?")) {
                  s.disconnect();
                }
              }}
            >
              Disconnect Schoology
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
