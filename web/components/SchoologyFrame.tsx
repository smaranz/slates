"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Schoology, live, inside Slates.
 *
 * Not an iframe — Schoology forbids that with `frame-ancestors 'self'`. These
 * are JPEG frames screencast out of the scraper's authenticated Chrome, with
 * pointer and keyboard events dispatched back into it. What you see is a real
 * browser on a real session; only the pixels and the input travel.
 */
const VIEW = { width: 1280, height: 800 };

interface Props {
  url: string;
  onClose: () => void;
  /** Called once Schoology shows the attempt as handed in. */
  onFinished?: () => void;
}

export default function SchoologyFrame({ url, onClose, onFinished }: Props) {
  const [frame, setFrame] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const surface = useRef<HTMLDivElement>(null);

  /** Page coordinates from a pointer event, undoing the display scale. */
  const toPage = useCallback((e: { clientX: number; clientY: number }) => {
    const box = surface.current?.getBoundingClientRect();
    if (!box || !box.width) return { x: 0, y: 0 };
    const scale = VIEW.width / box.width;
    return {
      x: Math.round((e.clientX - box.left) * scale),
      y: Math.round((e.clientY - box.top) * scale),
    };
  }, []);

  const sendInput = useCallback((event: Record<string, unknown>) => {
    // Fire-and-forget: a dropped mousemove is not worth blocking typing over.
    void fetch("/api/attempt/input", {
      method: "POST",
      body: JSON.stringify(event),
      headers: { "content-type": "application/json" },
    }).catch(() => {});
  }, []);

  // Start the session, then stream frames until unmounted.
  useEffect(() => {
    let live = true;
    let source: EventSource | null = null;

    (async () => {
      try {
        const res = await fetch(`/api/attempt/start?url=${encodeURIComponent(url)}`, {
          cache: "no-store",
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Could not open the page");
        if (!live) return;

        setStarting(false);
        source = new EventSource("/api/attempt/stream");
        source.onmessage = (e) => setFrame(e.data);
        source.onerror = () => setError("Lost the connection to the page.");
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "Could not open the page");
      }
    })();

    return () => {
      live = false;
      source?.close();
      // Always tear the real page down; leaving it open would keep the
      // background sync paused indefinitely.
      void fetch("/api/attempt/stop", { method: "POST" }).catch(() => {});
    };
  }, [url]);

  /*
   * Watch for the attempt being handed in.
   *
   * The scraper compares Schoology's own attempt count against the one it saw
   * at launch, so this fires on a real submission rather than on anything that
   * merely looks like the end of a quiz.
   */
  const [finished, setFinished] = useState(false);
  useEffect(() => {
    if (starting || finished) return;
    const t = window.setInterval(async () => {
      try {
        const res = await fetch("/api/attempt/status", { cache: "no-store" });
        const body = await res.json();
        if (body?.finished) {
          setFinished(true);
          onFinished?.();
        }
      } catch {
        /* transient; the next tick tries again */
      }
    }, 4000);
    return () => window.clearInterval(t);
  }, [starting, finished, onFinished]);

  // Keyboard goes to the page while this is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return; // reserved for leaving the viewer
      const mods = { alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey };

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        sendInput({ type: "text", text: e.key, ...mods });
      } else {
        sendInput({ type: "key", key: e.key, ...mods });
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sendInput]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "color-mix(in oklab, var(--bg) 88%, black)",
        display: "flex",
        flexDirection: "column",
        padding: 16,
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
          Schoology · live
        </span>
        <span style={{ flex: 1, fontSize: 12, color: "var(--muted)" }}>
          A real browser session, streamed. Your work saves to Schoology exactly as usual.
        </span>
        {finished && (
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--good)",
              padding: "4px 10px",
              borderRadius: 9999,
              background: "oklch(0.72 0.13 145 / 0.14)",
            }}
          >
            Submitted · marked done
          </span>
        )}
        <a
          className="btn"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ height: 32, textDecoration: "none" }}
        >
          Open in a tab instead
        </a>
        <button type="button" className="btn" style={{ height: 32 }} onClick={onClose}>
          Close
        </button>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
        }}
      >
        <div
          ref={surface}
          onPointerMove={(e) => sendInput({ type: "move", ...toPage(e) })}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            sendInput({ type: "down", button: e.button, clickCount: e.detail || 1, ...toPage(e) });
          }}
          onPointerUp={(e) =>
            sendInput({ type: "up", button: e.button, clickCount: e.detail || 1, ...toPage(e) })
          }
          onWheel={(e) =>
            sendInput({ type: "wheel", deltaX: e.deltaX, deltaY: e.deltaY, ...toPage(e) })
          }
          style={{
            position: "relative",
            width: "100%",
            maxWidth: VIEW.width,
            aspectRatio: `${VIEW.width} / ${VIEW.height}`,
            borderRadius: "var(--radius-sm)",
            overflow: "hidden",
            border: "1px solid var(--line)",
            background: "var(--sunken)",
            cursor: "default",
            touchAction: "none",
          }}
        >
          {frame ? (
            // eslint-disable-next-line @next/next/no-img-element -- a live frame, not an asset
            <img
              src={`data:image/jpeg;base64,${frame}`}
              alt=""
              draggable={false}
              style={{ width: "100%", height: "100%", display: "block", userSelect: "none" }}
            />
          ) : (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                color: error ? "var(--warn)" : "var(--muted)",
                textAlign: "center",
                padding: 24,
              }}
            >
              {error ?? (starting ? "Opening Schoology..." : "Waiting for the first frame...")}
            </div>
          )}
        </div>
      </div>

      {error && frame && (
        <p style={{ margin: 0, fontSize: 12, color: "var(--warn)", flexShrink: 0 }}>{error}</p>
      )}
    </div>
  );
}
