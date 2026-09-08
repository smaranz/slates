"use client";

import Image from "next/image";

import { useStore } from "@/lib/store";

/**
 * Shown before anything has synced. Deliberately says nothing about what work
 * exists — the app has no data yet, and inventing sample assignments here would
 * be indistinguishable from the real thing.
 */
export default function EmptyState() {
  const s = useStore();
  const syncing = s.connecting;

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 24px 48px",
      }}
    >
      <div
        className="card card--xl"
        style={{ width: "100%", maxWidth: 460, padding: "28px 24px", textAlign: "center" }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 44,
            height: 44,
            borderRadius: 16,
            background: "var(--sunken)",
            boxShadow: "var(--shadow-sunken)",
          }}
        >
          <Image
            src="/assets/slates-mark.png"
            alt=""
            width={24}
            height={24}
            style={{
              display: "block",
              objectFit: "contain",
              opacity: syncing ? 0.5 : 0.85,
            }}
          />
        </span>

        <div
          style={{
            marginTop: 14,
            fontSize: 16,
            fontWeight: 600,
            lineHeight: 1.375,
            letterSpacing: "-0.01em",
            color: "var(--text)",
          }}
        >
          {syncing ? "Syncing your assignments..." : "Nothing synced yet"}
        </div>

        <p style={{ margin: "6px 0 0", fontSize: 14, color: "var(--muted)", lineHeight: 1.5 }}>
          {syncing
            ? "Reading your Schoology home page. This takes a few seconds the first time."
            : "Slates pulls your assignments from Schoology automatically. If nothing appears, check the sync service in Settings."}
        </p>

        {syncing && (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 5,
              marginTop: 16,
            }}
          >
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 9999,
                  background: "var(--muted)",
                  animation: `slates-typing 1.4s ease-in-out ${i * 0.2}s infinite`,
                }}
              />
            ))}
          </div>
        )}

        {!syncing && (
          <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 18 }}>
            <button type="button" className="btn btn--primary" onClick={() => void s.resync()}>
              Sync now
            </button>
          </div>
        )}

        {s.syncError && (
          <p style={{ margin: "14px 0 0", fontSize: 12, color: "var(--warn)", lineHeight: 1.5 }}>
            {s.syncError}
          </p>
        )}
      </div>
    </div>
  );
}
