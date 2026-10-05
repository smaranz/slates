"use client";

import { useEffect, useEffectEvent, useId, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

import { useStore } from "@/lib/store";
import css from "./SchoologySignIn.module.css";
import { Icon, ICON, Spinner } from "./ui";

/**
 * Signing in to Schoology, from Settings or the sidebar.
 *
 * The sync runs on the host in a browser nobody sees, so an expired session
 * used to mean a terminal at that machine and `npm run login`. Now the sync
 * browser opens Schoology itself and streams it here (scraper/signin.mjs), as
 * a live attempt is streamed (SchoologyFrame): frames come out, clicks and
 * keys go back in, and the session lands in the browser that does the syncing.
 */

const API = "/api/scrape/signin";

interface Session {
  id: string;
  domain: string;
  viewport: { width: number; height: number };
}

interface Status {
  active: boolean;
  id: string | null;
  signedIn?: boolean;
  reason?: string | null;
  field?: { type: string; inputMode: string | null } | null;
}

type Input =
  | { type: "click"; x: number; y: number }
  | { type: "wheel"; x: number; y: number; dx: number; dy: number }
  | { type: "text"; text: string }
  | { type: "key"; key: string; shift?: boolean }
  | { type: "nav"; to: "back" | "start" };

/** Keys that mean something to a form and carry no text of their own. */
const KEYS = new Set(["Enter", "Tab", "Backspace", "Delete", "Home", "End", "ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"]);

const ENDED: Record<string, string> = {
  idle: "Sign-in closed after five minutes with nobody on it.",
  expired: "Sign-in closes after 15 minutes, and this one ran out.",
  replaced: "Sign-in was opened somewhere else, so this one closed.",
  released: "npm run login took over the sync browser, so this sign-in closed.",
  crashed: "The sync browser's page crashed.",
};

/** `<district>.schoology.com` out of whatever was typed, or null. The sync service checks again. */
export function schoologyDomain(input: string): string | null {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[/?#].*$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.schoology\.com$/.test(host) ? host : null;
}

async function call<T>(action: string, body?: unknown): Promise<T> {
  const res = await fetch(
    `${API}/${action}`,
    body === undefined
      ? { cache: "no-store" }
      : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
  );
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Slates answered ${res.status}.`);
  return data;
}

/** Runs of typing become one insert and runs of scrolling one wheel, still in order. */
function coalesce(events: Input[]): Input[] {
  const out: Input[] = [];
  for (const event of events) {
    const last = out.at(-1);
    if (event.type === "text" && last?.type === "text") last.text += event.text;
    else if (event.type === "wheel" && last?.type === "wheel") {
      Object.assign(last, { x: event.x, y: event.y, dx: last.dx + event.dx, dy: last.dy + event.dy });
    } else out.push({ ...event });
  }
  return out;
}

function inputModeFor(field: Status["field"]): "email" | "numeric" | "text" {
  if (field?.type === "email") return "email";
  if (field?.type === "tel" || field?.type === "number" || field?.inputMode === "numeric") return "numeric";
  return "text";
}

function SignInOverlay({ domain, onClose, onSignedIn }: { domain?: string; onClose: () => void; onSignedIn: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const [session, setSession] = useState<Session | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const [field, setField] = useState<Status["field"]>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [typing, setTyping] = useState("");
  const stage = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  const exit = useRef<HTMLButtonElement>(null);
  const queue = useRef<Input[]>([]);
  const sending = useRef(false);
  const press = useRef<{ id: number; x: number; y: number; lastX: number; lastY: number; moved: boolean } | null>(null);
  const titleId = useId();
  const hintId = useId();
  const finished = useEffectEvent(onSignedIn);

  // Open Schoology at the size of the space it has here. A tick late, so a
  // development double-mount opens one sign-in rather than two.
  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(async () => {
      stage.current?.focus();
      const box = stage.current?.getBoundingClientRect();
      try {
        const opened = await call<Session>("start", {
          domain,
          width: Math.floor((box?.width || 1280) - 2),
          height: Math.floor((box?.height || 800) - 2),
        });
        if (live) setSession(opened);
        else void call("stop", { id: opened.id }).catch(() => {});
      } catch (e) {
        if (live) setEnded(e instanceof Error ? e.message : "Couldn't open Schoology.");
      }
    }, 0);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [domain, attempt]);

  // Frames as they're painted, and a look every so often at whether it's still open or done.
  useEffect(() => {
    if (!session) return;
    let live = true;
    let source: EventSource | null = null;
    let timer: number | undefined;
    const listen = () => {
      source?.close();
      source = new EventSource(`${API}/stream`);
      source.onmessage = (e) => setFrame(e.data);
    };
    const poll = async () => {
      try {
        const now = await call<Status>("status");
        if (!live) return;
        if (now.active && now.id === session.id) {
          setField(now.field ?? null);
          if (source?.readyState === EventSource.CLOSED) listen();
        } else {
          live = false;
          source?.close();
          if (now.id === session.id && now.signedIn) {
            setDone(true);
            finished();
          } else {
            // No record at all is a restarted service, not another device.
            const why = now.id === session.id ? (now.reason ?? "") : now.id ? "replaced" : "";
            setEnded(ENDED[why] ?? "Sign-in closed before Schoology let you in.");
          }
          return;
        }
      } catch {
        // A blip between here and the host; the next look tries again.
      }
      if (live) timer = window.setTimeout(poll, 1500);
    };
    listen();
    timer = window.setTimeout(poll, 1500);
    return () => {
      live = false;
      window.clearTimeout(timer);
      source?.close();
    };
  }, [session]);

  /** In order, one request at a time, batching whatever piles up behind it. */
  const send = (event: Input) => {
    if (!session || done) return;
    const { id } = session;
    queue.current.push(event);
    if (sending.current) return;
    sending.current = true;
    void (async () => {
      while (queue.current.length) {
        try {
          await call("input", { id, events: coalesce(queue.current.splice(0)) });
          setProblem(null);
        } catch (e) {
          setProblem(e instanceof Error ? e.message : "That didn't reach the page.");
        }
      }
      sending.current = false;
    })();
  };

  /** A point on the picture as a point on the page, or null off it. */
  const toPage = (clientX: number, clientY: number) => {
    const box = picture.current?.getBoundingClientRect();
    if (!session || !box?.width || clientX < box.left || clientX > box.right || clientY < box.top || clientY > box.bottom) return null;
    return {
      x: Math.round(((clientX - box.left) / box.width) * session.viewport.width),
      y: Math.round(((clientY - box.top) / box.height) * session.viewport.height),
    };
  };

  const cancel = () => {
    if (session && !done && !ended) void call("stop", { id: session.id }).catch(() => {});
    onClose();
  };

  const again = () => {
    setEnded(null);
    setSession(null);
    setFrame(null);
    setField(null);
    setProblem(null);
    setAttempt((n) => n + 1);
  };

  const shownDomain = session?.domain ?? domain;

  return createPortal(
    <div
      className={css.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      // Every keystroke belongs to the streamed page while this is up; the command palette checks for this.
      data-schoology-viewer=""
      // Tabbing out lands back on the page; the window itself losing focus moves nothing.
      onBlur={(e) => {
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) (stage.current ?? exit.current)?.focus();
      }}
    >
      <header className={`${css.bar} schoology-viewer-bar`}>
        <div className={css.heading}>
          <h2 id={titleId} className={css.title}>
            <i aria-hidden="true" />
            {done ? "Schoology connected" : "Sign in to Schoology"}
          </h2>
          <p className={css.sub}>
            {done ? "Your school is back in Slates." : <>{shownDomain ? `${shownDomain}, open` : "Open"} in the browser Slates syncs with. What you type goes to
            that browser and on to Schoology; Slates doesn&apos;t keep it.</>}
          </p>
        </div>
        <button
          type="button"
          className={`icon-btn ${css.icon}`}
          aria-label="Back"
          title="Back"
          disabled={!session || done || !!ended}
          onClick={() => send({ type: "nav", to: "back" })}
        >
          <Icon path={ICON.chevronLeft} size={16} />
        </button>
        <button
          type="button"
          className={`icon-btn ${css.icon}`}
          aria-label="Start over"
          title="Start over"
          disabled={!session || done || !!ended}
          onClick={() => send({ type: "nav", to: "start" })}
        >
          <Icon path={ICON.retry} size={15} />
        </button>
        <button ref={exit} type="button" className="btn btn--quiet" onClick={cancel}>
          {done || ended ? "Close" : "Cancel"}
        </button>
      </header>

      {ended ? (
        <div className={css.ended} role="alert">
          <p>{ended}</p>
          <button type="button" className="btn btn--primary" onClick={again}>
            Open it again
          </button>
        </div>
      ) : done ? (
        <div className={css.done} role="status" aria-live="polite">
          <div className={css.successMark} aria-hidden="true">
            <span className={css.successRing} />
            <span className={css.successRing} />
            <span className={css.successCore}>
              <svg viewBox="0 0 48 48" fill="none">
                <path d="M13 24.5 21 32 35 17" pathLength="1" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
          <div className={css.successCopy}>
            <h3>You&apos;re connected.</h3>
            <p>Bringing your school into Slates…</p>
          </div>
          <div className={css.successTrail} aria-hidden="true"><span /><span /><span /></div>
        </div>
      ) : (
        <div
          ref={stage}
          className={css.stage}
          tabIndex={0}
          role="application"
          aria-roledescription="remote page"
          aria-label="Schoology's sign-in page"
          aria-describedby={hintId}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              // The way out of the page for a keyboard, since Tab goes to it.
              e.preventDefault();
              exit.current?.focus();
              return;
            }
            if (e.metaKey || e.ctrlKey) {
              // Select all goes to the page and paste arrives as its own event; other shortcuts stay Slates'.
              if (e.key.toLowerCase() === "a") {
                e.preventDefault();
                send({ type: "key", key: "SelectAll" });
              }
              return;
            }
            if (KEYS.has(e.key)) {
              e.preventDefault();
              send({ type: "key", key: e.key, shift: e.shiftKey });
            } else if (e.key.length === 1) {
              e.preventDefault();
              send({ type: "text", text: e.key });
            }
          }}
          onPaste={(e) => {
            e.preventDefault();
            const text = e.clipboardData.getData("text");
            if (text) send({ type: "text", text });
          }}
          onPointerDown={(e) => {
            e.currentTarget.focus();
            e.currentTarget.setPointerCapture(e.pointerId);
            press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false };
          }}
          onPointerMove={(e) => {
            const p = press.current;
            // A finger dragging scrolls the page; a mouse has its wheel for that.
            if (!p || p.id !== e.pointerId || e.pointerType === "mouse" || !session) return;
            if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 8) return;
            p.moved = true;
            const at = toPage(p.x, p.y);
            const scale = session.viewport.width / (picture.current?.getBoundingClientRect().width || session.viewport.width);
            if (at) send({ type: "wheel", ...at, dx: (p.lastX - e.clientX) * scale, dy: (p.lastY - e.clientY) * scale });
            p.lastX = e.clientX;
            p.lastY = e.clientY;
          }}
          onPointerUp={(e) => {
            const p = press.current;
            press.current = null;
            if (!p || p.id !== e.pointerId || p.moved || (e.pointerType === "mouse" && e.button !== 0)) return;
            const at = toPage(e.clientX, e.clientY);
            if (at) send({ type: "click", ...at });
          }}
          onPointerCancel={() => {
            press.current = null;
          }}
          onWheel={(e) => {
            const at = toPage(e.clientX, e.clientY);
            const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? (session?.viewport.height ?? 800) : 1;
            if (at) send({ type: "wheel", ...at, dx: e.deltaX * unit, dy: e.deltaY * unit });
          }}
        >
          {frame ? (
            // eslint-disable-next-line @next/next/no-img-element -- a live frame, not an asset
            <img ref={picture} className={css.frame} src={`data:image/jpeg;base64,${frame}`} alt="" draggable={false} />
          ) : (
            <div className={css.placeholder}>
              <Spinner size={14} />
              Opening Schoology…
            </div>
          )}
        </div>
      )}

      {!done && <div className={css.foot}>
        <form
          className={css.type}
          onSubmit={(e) => {
            e.preventDefault();
            if (typing) send({ type: "text", text: typing });
            setTyping("");
          }}
        >
          <input
            className="input"
            type={field?.type === "password" ? "password" : "text"}
            inputMode={inputModeFor(field)}
            value={typing}
            onChange={(e) => setTyping(e.target.value)}
            placeholder={field?.type === "password" ? "Password" : "Type into the page"}
            aria-label="Type into the page"
            enterKeyHint="send"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            disabled={!session || done || !!ended}
          />
          <button type="submit" className="btn btn--quiet" disabled={!session || done || !!ended}>
            Send
          </button>
          <button
            type="button"
            className="btn btn--quiet"
            disabled={!session || done || !!ended}
            onClick={() => send({ type: "key", key: "Enter" })}
          >
            Return
          </button>
        </form>
        {problem && (
          <p className={css.problem} role="alert">
            {problem}
          </p>
        )}
        <p id={hintId} className={css.hint}>
          <span className={css.mouse}>Click the page, then type. Paste works too, and Esc takes you out of the page.</span>
          <span className={css.touch}>Tap a field on the page, type it here, then press Send.</span>
        </p>
      </div>}
    </div>,
    document.body
  );
}

/**
 * A button that opens the sign-in. `domain` is only for a first sign-in, when
 * the sync service doesn't know the school's Schoology yet.
 */
export default function SchoologySignIn({
  label = "Sign in to Schoology",
  className = "btn btn--primary",
  style,
  domain,
  disabled,
  submit = false,
  onSignedIn,
}: {
  label?: string;
  className?: string;
  style?: CSSProperties;
  domain?: string;
  disabled?: boolean;
  /** A submit button, so Enter in a form's address field opens it. */
  submit?: boolean;
  onSignedIn?: () => void;
}) {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const close = () => setOpen(false);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  // Back to the button once the overlay has gone; any sooner and the overlay pulls focus back in.
  useEffect(() => {
    if (wasOpen.current && !open) button.current?.focus();
    if (!open) window.clearTimeout(closeTimer.current);
    wasOpen.current = open;
  }, [open]);

  return (
    <>
      <button ref={button} type={submit ? "submit" : "button"} className={className} style={style} disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <SignInOverlay
          domain={domain}
          onClose={close}
          onSignedIn={() => {
            void store.syncScraper(true);
            // Told after it closes: the caller re-checking first would take this button, and the overlay, away.
            closeTimer.current = window.setTimeout(() => {
              close();
              onSignedIn?.();
            }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 900 : 2200);
          }}
        />
      )}
    </>
  );
}
