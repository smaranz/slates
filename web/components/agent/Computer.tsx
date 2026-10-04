"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Icon, ICON, Spinner } from "../ui";
import s from "./agent.module.css";
import { agentApi } from "./useAgentData";

/**
 * A browser on the host, live: an agent's own, or the one the tutor and Study
 * builds share. View-only until you take control; then clicks, scrolling and
 * typing go straight to the page — for sign-ins, 2FA and CAPTCHAs, which
 * agents hand to you rather than work around.
 *
 * The panel is small enough to watch in beside a chat, too small to sign in
 * through, so taking control opens the screen large in a popup until you give
 * control back.
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

/** A browser to pick: an agent's, by its id, or the shared one, as "". */
export interface BrowserChoice {
  id: string;
  name: string;
}

const SPECIAL = new Set(["Enter", "Backspace", "Tab", "Escape", "Delete", "ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"]);

/**
 * `browser` is whose: an agent's id, or "" for the one the tutor and Study
 * builds share. `browsers` adds a picker that switches between them.
 */
export default function Computer({ onClose, browser = "", browsers, onBrowser }: {
  onClose: () => void;
  browser?: string;
  browsers?: BrowserChoice[];
  onBrowser?: (id: string) => void;
}) {
  // Each frame and the control are kept with their browser, so switching never shows one under another's name.
  const [shot, setShot] = useState<{ of: string; frame: Frame } | null>(null);
  const frame = shot?.of === browser ? shot.frame : null;
  const [controlOf, setControlOf] = useState<string | null>(null);
  const control = controlOf === browser;
  const name = browsers?.find((choice) => choice.id === browser)?.name;
  const [address, setAddress] = useState("");
  const [editing, setEditing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState("");
  const img = useRef<HTMLImageElement>(null);
  const liveScreen = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const typed = useRef("");
  const flushTimer = useRef<number | undefined>(undefined);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/agent/computer${browser ? `?agent=${encodeURIComponent(browser)}` : ""}`, { cache: "no-store", signal });
      const data = (await response.json()) as Frame;
      setShot({ of: browser, frame: data });
      if (!data.running) setControlOf(null);
      if (!editing && data.url) setAddress(data.url);
    } catch {
      // Keep the last frame.
    }
  }, [editing, browser]);

  useEffect(() => {
    let alive = true;
    // A frame still on its way from the browser you just left is dropped.
    const stale = new AbortController();
    let timer: number | undefined;
    const loop = async () => {
      if (!alive) return;
      if (document.visibilityState === "visible") await load(stale.signal);
      timer = window.setTimeout(loop, control ? 450 : 1100);
    };
    void loop();
    return () => {
      alive = false;
      stale.abort();
      window.clearTimeout(timer);
    };
  }, [load, control]);

  const send = useCallback(async (input: Record<string, unknown>) => {
    try {
      await agentApi("/api/agent/computer", { input, ...(browser ? { agent: browser } : {}) });
      setError(null);
      window.setTimeout(() => void load(), 150);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [load, browser]);

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
      await agentApi("/api/agent/computer", { op: "start", ...(browser ? { agent: browser } : {}) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  const takingOver = control && !!frame?.running;
  const wasTakingOver = useRef(false);

  // The keyboard goes to the page as soon as the popup opens, and back to the
  // button that opened it once it has closed.
  useEffect(() => {
    if (takingOver) liveScreen.current?.focus();
    else if (wasTakingOver.current) toggle.current?.focus();
    wasTakingOver.current = takingOver;
  }, [takingOver]);

  const giveBack = () => {
    flushTyped();
    setControlOf(null);
  };

  const addressBar = (
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
  );

  const picture = (live: boolean) =>
    frame?.image ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        ref={live ? img : undefined}
        src={`data:image/jpeg;base64,${frame.image}`}
        alt={frame.title || (name ? `${name}'s browser` : "The PC's browser")}
        draggable={false}
        onClick={
          live
            ? (e) => {
                e.currentTarget.parentElement?.focus();
                flushTyped();
                const p = point(e.clientX, e.clientY);
                if (p) void send({ type: "click", ...p });
              }
            : undefined
        }
      />
    ) : <div className={s.center}>{frame?.error ?? <Spinner size={16} />}</div>;

  return (
    <aside className={`${s.panel} ${s.computer}`} aria-label="Computer">
      <div className={s.panelHead}>
        <h2>Computer</h2>
        {browsers && (
          <select className={`${s.field} ${s.browserPick}`} value={browser} onChange={(e) => { setError(null); onBrowser?.(e.target.value); }} aria-label="Whose browser">
            {browsers.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
          </select>
        )}
        {frame?.running && (
          <button ref={toggle} type="button" className={control ? s.controlOn : s.quiet} onClick={() => (control ? giveBack() : setControlOf(browser))} aria-pressed={control}>
            {control ? "Give back control" : "Take control"}
          </button>
        )}
        <button type="button" className={s.iconButton} aria-label="Close computer" onClick={onClose}><Icon path={ICON.close} size={14} /></button>
      </div>
      {!frame ? (
        <div className={s.center}><Spinner size={16} /></div>
      ) : !frame.running ? (
        <div className={s.computerIdle}>
          <p>
            {browser
              ? `${name ?? "This agent"}'s own browser runs on the PC. It starts when ${name ?? "the agent"} opens a page.`
              : "The tutor and Study builds share this browser on the PC. It starts when one of them opens a page."}
          </p>
          <button type="button" className={s.primary} disabled={starting} onClick={() => void start()}>{starting && <Spinner size={12} />} Start browser</button>
        </div>
      ) : (
        <>
          {addressBar}
          <div className={s.screen}>{picture(false)}</div>
          <p className={s.computerHint}>
            {control ? "You're in control in the popup." : frame.title || "Watching. Take control to sign in or click."}
          </p>
        </>
      )}
      {error && <p className={s.bad}>{error}</p>}

      {takingOver &&
        createPortal(
          <div
            className={s.takeoverBackdrop}
            onKeyDown={(e) => {
              // Esc on the page goes to the page (the screen claims it); anywhere else it gives control back.
              if (e.key === "Escape" && !e.defaultPrevented) giveBack();
            }}
          >
            <section
              className={s.takeover}
              role="dialog"
              aria-modal="true"
              aria-label="In control of the PC's browser"
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) liveScreen.current?.focus();
              }}
            >
              <header className={s.takeoverHead}>
                <span className={s.takeoverLive}><i aria-hidden="true" /> You&apos;re in control</span>
                {addressBar}
                <button type="button" className={s.controlOn} onClick={giveBack}>Give back control</button>
              </header>
              <div
                ref={liveScreen}
                className={`${s.screen} ${s.screenLive} ${s.takeoverScreen}`}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.metaKey || e.ctrlKey) return;
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
                  e.preventDefault();
                  flushTyped();
                  void send({ type: "text", text: e.clipboardData.getData("text") });
                }}
                onWheel={(e) => {
                  const p = point(e.clientX, e.clientY);
                  if (p) void send({ type: "scroll", ...p, dy: e.deltaY });
                }}
              >
                {picture(true)}
              </div>
              {/* A touch screen has no keyboard until a text field has focus, so a phone types through this. */}
              <form
                className={s.takeoverType}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (typing) void send({ type: "text", text: typing });
                  setTyping("");
                }}
              >
                <input className={s.addressInput} value={typing} onChange={(e) => setTyping(e.target.value)} placeholder="Type into the page" aria-label="Type into the page" enterKeyHint="send" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
                <button type="submit" className={s.quiet}>Send</button>
                <button type="button" className={s.quiet} onClick={() => void send({ type: "key", key: "Enter" })}>Return</button>
              </form>
              <p className={s.computerHint}>Click the page, then type. Your keys go to the PC&apos;s browser.</p>
            </section>
          </div>,
          document.body,
        )}
    </aside>
  );
}
