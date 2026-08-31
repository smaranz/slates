"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { readAvatarFile } from "@/lib/avatar";
import { useStore } from "@/lib/store";
import { Avatar, Toggle } from "./ui";

export default function SettingsView() {
  const s = useStore();

  const fileRef = useRef<HTMLInputElement>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  const [scraper, setScraper] = useState<{
    running: boolean;
    domain?: string | null;
    loggedInAt?: string | null;
  } | null>(null);

  const checkScraper = useCallback(async () => {
    setScraper(null);
    try {
      const res = await fetch("/api/scrape", { cache: "no-store" });
      setScraper(await res.json());
    } catch {
      setScraper({ running: false });
    }
  }, []);

  useEffect(() => {
    void checkScraper();
  }, [checkScraper]);

  return (
    <div className="scroll centered" style={{ paddingBottom: 32 }}>
      <div className="col" style={{ maxWidth: 640, gap: 16 }}>
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

        {/* The only sync path: a dedicated logged-in browser, driven locally. */}
        <div className="card" style={{ padding: "20px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                width: 8,
                height: 8,
                flexShrink: 0,
                borderRadius: 9999,
                background: scraper?.running ? "var(--good)" : "var(--muted)",
              }}
            />
            <span className="card-title">Schoology sync</span>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              className={`btn btn--quiet ${scraper === null ? "btn--busy" : ""}`}
              style={{ height: 28 }}
              onClick={() => void checkScraper()}
            >
              Check
            </button>
            <button
              type="button"
              className={`btn btn--primary ${s.connecting ? "btn--busy" : ""}`}
              style={{ height: 28 }}
              onClick={() => void s.syncScraper(true)}
            >
              {s.connecting ? "Syncing..." : "Sync now"}
            </button>
          </div>

          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
            Runs its own Chrome profile with only Schoology signed in, reads the fully
            rendered pages, and pulls your assignments and due dates.
          </p>

          {scraper?.running ? (
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--good)", lineHeight: 1.5 }}>
              Running · {scraper.domain ?? "no domain set"}
              {scraper.loggedInAt
                ? ` · signed in ${new Date(scraper.loggedInAt).toLocaleDateString()}`
                : ""}
            </p>
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
{`cd scraper
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
          <span className="card-title">Notifications</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontSize: 13, color: "var(--text)" }}>Push reminders</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                  Nightly nudge for what&apos;s due.
                </div>
              </div>
              <Toggle on={s.notifPush} onClick={s.togglePush} label="Push reminders" />
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontSize: 13, color: "var(--text)" }}>Weekly digest</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                  Grade summary every Sunday.
                </div>
              </div>
              <Toggle on={s.notifDigest} onClick={s.toggleDigest} label="Weekly digest" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
