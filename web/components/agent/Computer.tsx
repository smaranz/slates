"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Icon, ICON, Spinner } from "../ui";
import s from "./agent.module.css";
import { agentApi } from "./useAgentData";

/**
 * The agents' browser on the host, live. View-only until you take control;
 * then clicks, scrolling and typing go straight to the page — for sign-ins,
 * 2FA and CAPTCHAs, which agents hand to you rather than work around.
 */

interface Frame {
  running: boolean;
  url?: string;
  title?: string;
  width?: number;
  height?: number;
  image?: string;
  error?: string;
}

const SPECIAL = new Set(["Enter", "Backspace", "Tab", "Escape", "Delete", "ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"]);

export default function Computer({ onClose }: { onClose: () => void }) {
  const [frame, setFrame] = useState<Frame | null>(null);
  const [control, setControl] = useState(false);
  const [address, setAddress] = useState("");
  const [editing, setEditing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const img = useRef<HTMLImageElement>(null);
  const typed = useRef("");
  const flushTimer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/agent/computer", { cache: "no-store" });
      const data = (await response.json()) as Frame;
      setFrame(data);
      if (!editing && data.url) setAddress(data.url);
    } catch {
      // Keep the last frame.
    }
  }, [editing]);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const loop = async () => {
      if (!alive) return;
      if (document.visibilityState === "visible") await load();
      timer = window.setTimeout(loop, control ? 450 : 1100);
    };
    void loop();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [load, control]);

  const send = useCallback(async (input: Record<string, unknown>) => {
    try {
      await agentApi("/api/agent/computer", { input });
      setError(null);
      window.setTimeout(() => void load(), 150);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [load]);

  const flushTyped = useCallback(() => {
    window.clearTimeout(flushTimer.current);
    const text = typed.current;
    typed.current = "";
    if (text) void send({ type: "text", text });
  }, [send]);

  const point = (clientX: number, clientY: number) => {
    const el = img.current;
    if (!el || !frame?.width || !frame.height) return null;
    const box = el.getBoundingClientRect();
    return { x: ((clientX - box.left) / box.width) * frame.width, y: ((clientY - box.top) / box.height) * frame.height };
  };

  const start = async () => {
    setStarting(true);
    try {
      await agentApi("/api/agent/computer", { op: "start" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  return (
    <aside className={`${s.panel} ${s.computer}`} aria-label="Computer">
      <div className={s.panelHead}>
        <h2>Computer</h2>
        {frame?.running && (
          <button type="button" className={control ? s.controlOn : s.quiet} onClick={() => { flushTyped(); setControl((c) => !c); }} aria-pressed={control}>
            {control ? "Give back control" : "Take control"}
          </button>
        )}
        <button type="button" className={s.iconButton} aria-label="Close computer" onClick={onClose}><Icon path={ICON.close} size={14} /></button>
      </div>
      {!frame ? (
        <div className={s.center}><Spinner size={16} /></div>
      ) : !frame.running ? (
        <div className={s.computerIdle}>
          <p>The agents&apos; browser runs on the PC. It starts when an agent opens a page.</p>
          <button type="button" className={s.primary} disabled={starting} onClick={() => void start()}>{starting && <Spinner size={12} />} Start browser</button>
        </div>
      ) : (
        <>
          <form
            className={s.address}
            onSubmit={(e) => {
              e.preventDefault();
              setEditing(false);
              if (address.trim()) void send({ type: "navigate", url: address.trim() });
            }}
          >
            <button type="button" className={s.iconButton} aria-label="Back" onClick={() => void send({ type: "back" })}><Icon path={ICON.chevronLeft} size={13} /></button>
            <input className={s.addressInput} value={address} onFocus={() => setEditing(true)} onBlur={() => setEditing(false)} onChange={(e) => setAddress(e.target.value)} aria-label="Address" spellCheck={false} />
          </form>
          <div
            className={`${s.screen} ${control ? s.screenLive : ""}`}
            tabIndex={control ? 0 : -1}
            onKeyDown={(e) => {
              if (!control || e.metaKey || e.ctrlKey) return;
              if (SPECIAL.has(e.key)) {
                e.preventDefault();
                flushTyped();
                void send({ type: "key", key: e.key });
              } else if (e.key.length === 1) {
                e.preventDefault();
                typed.current += e.key;
                window.clearTimeout(flushTimer.current);
                flushTimer.current = window.setTimeout(flushTyped, 250);
              }
            }}
            onPaste={(e) => {
              if (!control) return;
              e.preventDefault();
              flushTyped();
              void send({ type: "text", text: e.clipboardData.getData("text") });
            }}
            onWheel={(e) => {
              if (!control) return;
              const p = point(e.clientX, e.clientY);
              if (p) void send({ type: "scroll", ...p, dy: e.deltaY });
            }}
          >
            {frame.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                ref={img}
                src={`data:image/jpeg;base64,${frame.image}`}
                alt={frame.title || "The agents' browser"}
                draggable={false}
                onClick={(e) => {
                  if (!control) return;
                  e.currentTarget.parentElement?.focus();
                  flushTyped();
                  const p = point(e.clientX, e.clientY);
                  if (p) void send({ type: "click", ...p });
                }}
              />
            ) : <div className={s.center}>{frame.error ?? <Spinner size={16} />}</div>}
          </div>
          <p className={s.computerHint}>
            {control ? "You're in control: click the page, then type. Your keys go to the PC's browser." : frame.title || "Watching. Take control to sign in or click."}
          </p>
        </>
      )}
      {error && <p className={s.bad}>{error}</p>}
    </aside>
  );
}
