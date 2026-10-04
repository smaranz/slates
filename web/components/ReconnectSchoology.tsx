"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useStore } from "@/lib/store";
import Computer from "./agent/Computer";
import s from "./agent/agent.module.css";
import { Icon, ICON, Spinner } from "./ui";

/**
 * Sign Schoology back in from this device.
 *
 * The PC syncs Schoology in a browser nobody can see, so an expired session
 * used to mean sitting down at the PC. This opens Schoology in the PC's other
 * browser (the agents', whose screen Slates already streams), you sign in
 * there with Take control, and Slates copies the sign-in across the moment
 * it's done, then pulls your assignments.
 */

type Phase = "opening" | "waiting" | "connected" | "error";

async function reconnect(op: "open" | "check"): Promise<{ signedIn?: boolean; error?: string }> {
  const response = await fetch("/api/scrape/reconnect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ op }),
  });
  const body = (await response.json().catch(() => ({}))) as { signedIn?: boolean; error?: string };
  if (!response.ok && !body.error) body.error = `Slates answered ${response.status}.`;
  return body;
}

function Dialog({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const [phase, setPhase] = useState<Phase>("opening");
  const [error, setError] = useState<string | null>(null);
  const checking = useRef(false);

  useEffect(() => {
    let alive = true;
    void reconnect("open").then((r) => {
      if (!alive) return;
      if (r.error) {
        setError(r.error);
        setPhase("error");
      } else setPhase("waiting");
    });
    return () => {
      alive = false;
    };
  }, []);

  const check = useCallback(async () => {
    if (checking.current) return;
    checking.current = true;
    try {
      const r = await reconnect("check");
      if (r.signedIn) {
        setPhase("connected");
        await store.syncScraper(true);
        window.setTimeout(onClose, 1500);
      } else if (r.error) setError(r.error);
      else setError(null);
    } finally {
      checking.current = false;
    }
  }, [onClose, store]);

  useEffect(() => {
    if (phase !== "waiting") return;
    const timer = window.setInterval(() => void check(), 4000);
    return () => window.clearInterval(timer);
  }, [check, phase]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={s.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.modal} style={{ width: "min(860px, 100%)" }} role="dialog" aria-modal="true" aria-label="Reconnect Schoology">
        <div className={s.modalHead}>
          <h2>Reconnect Schoology</h2>
          <button type="button" className={s.iconButton} aria-label="Close" onClick={onClose}>
            <Icon path={ICON.close} size={14} />
          </button>
        </div>
        <p className={s.muted} style={{ margin: 0 }}>
          This is a browser on your PC. Press <strong>Take control</strong>, then sign in to Schoology the way you normally
          do. Slates notices when you&apos;re in, signs the PC&apos;s sync in with it, and pulls your assignments.
        </p>
        <p role="status" className={phase === "connected" ? s.good : phase === "error" ? s.bad : s.muted} style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
          {phase === "opening" && (
            <>
              <Spinner size={12} /> Opening Schoology on the PC…
            </>
          )}
          {phase === "waiting" && (
            <>
              <Spinner size={12} /> Waiting for you to sign in…
            </>
          )}
          {phase === "connected" && "Signed in. Pulling your assignments…"}
          {phase === "error" && error}
        </p>
        {phase === "waiting" && error && <p className={s.bad} style={{ margin: 0 }}>{error}</p>}
        <Computer onClose={onClose} embedded />
      </div>
    </div>
  );
}

/** A Reconnect button that opens the sign-in dialog. */
export default function ReconnectSchoology({ className, style, label = "Reconnect" }: { className?: string; style?: React.CSSProperties; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} style={style} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && <Dialog onClose={() => setOpen(false)} />}
    </>
  );
}
