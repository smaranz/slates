"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";

import { buildHtmlSrcDoc } from "@whirl/lib/html-frame";
import { useIsDark } from "@whirl/lib/theme";

const INLINE_MIN_HEIGHT = 80;
const INLINE_MAX_HEIGHT = 800;
/** Leaves chat chrome and nearby messages visible on short/narrow panes. */
const INLINE_VIEWPORT_SHARE = 0.65;
/** The fixed stage for app-style content (games, 3D) — see whirl-html-app. */
const INLINE_APP_HEIGHT = 480;

/**
 * Renders a finished HTML artifact inside a sandboxed iframe. The sandbox
 * is `allow-scripts` (plus pointer lock, for mouse-look games) — NO
 * `allow-same-origin` — so scripts run in an opaque origin with no access
 * to cookies, storage, the network, or the host page.
 *
 * `fill` fills its container (the side panel). Otherwise it's an inline
 * card that sizes itself to the height the hosted doc posts up — unless
 * the doc's frame agent flags itself app-style ('whirl-html-app': games,
 * 3D, anything viewport-sized), in which case content height is a
 * feedback loop and the card pins a fixed stage instead.
 *
 * Keyboard routing: the pointer entering the frame hands it focus, so
 * arrow keys and WASD reach the game instead of scrolling the chat or
 * getting scooped into the composer by chat-view's type-anywhere handler;
 * leaving hands focus back. Neither ever steals from a real text input.
 *
 * The inline mode is deliberately animation-proof: Chromium composites an
 * iframe that paints while ANY ancestor is mid-animation of a compositable
 * property as a stale snapshot that never repaints. So the iframe mounts
 * only after `mountDelayMs` (the chat card passes ARTIFACT_SETTLE_MS) and
 * stays hidden until the srcdoc reports its height. Only the wrapper's
 * `height` ever animates — a pure layout property, driven per-frame in JS,
 * which never promotes a compositor surface.
 */
export function HtmlFrameView({
  html,
  title,
  fill = false,
  maxHeight = INLINE_MAX_HEIGHT,
  mountDelayMs = 0,
}: {
  html: string;
  title?: string;
  fill?: boolean;
  /** Cap for the auto-height (inline) mode. */
  maxHeight?: number;
  /** Hold the iframe mount this long so entrance animations settle first. */
  mountDelayMs?: number;
}) {
  const dark = useIsDark();
  const srcDoc = useMemo(
    () => buildHtmlSrcDoc(html, { dark, fill }),
    [html, dark, fill],
  );
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [contentHeight, setContentHeight] = useState(INLINE_MIN_HEIGHT);
  /* The viewport's share of the cap, tracked in JS so the *animated*
     height honors it — a CSS max-height under an animated taller box is
     exactly what used to clip the card into an internal scroller. */
  const [viewportCap, setViewportCap] = useState(INLINE_MAX_HEIGHT);
  const [mounted, setMounted] = useState(mountDelayMs <= 0);
  /* The srcdoc has painted and told us how tall it is — safe to show. */
  const [ready, setReady] = useState(false);
  /* Sticky per artifact: once app-style, always app-style — a theme swap
     reloads the srcdoc, and the stage must not collapse in between. */
  const appModeRef = useRef(false);

  useEffect(() => {
    if (mounted) return;
    const timer = setTimeout(() => setMounted(true), mountDelayMs);
    return () => clearTimeout(timer);
  }, [mounted, mountDelayMs]);

  useEffect(() => {
    if (fill) return;
    const update = () =>
      setViewportCap(
        Math.max(
          INLINE_MIN_HEIGHT,
          Math.round(window.innerHeight * INLINE_VIEWPORT_SHARE),
        ),
      );
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [fill]);

  useEffect(() => {
    if (fill) return; // the panel iframe just fills its container
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as { type?: string; height?: unknown } | null;
      if (data?.type === "whirl-html-app") {
        appModeRef.current = true;
        setContentHeight(INLINE_APP_HEIGHT);
        setReady(true);
        return;
      }
      if (data?.type !== "whirl-html-height" || appModeRef.current) return;
      const reported = Number(data.height);
      if (!Number.isFinite(reported)) return;
      setContentHeight(Math.max(Math.ceil(reported), INLINE_MIN_HEIGHT));
      setReady(true);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [fill]);

  /* The card IS its content's height, clamped hard: the cap bounds the
     box even if the srcdoc's height reports ran away, so the old
     grows-forever failure is structurally impossible — over-cap content
     scrolls inside the sandbox, never the wrapper. */
  const height = Math.min(contentHeight, maxHeight, viewportCap);

  /* Keys go to whatever the pointer is over. Entering never yanks focus
     away from a text input mid-thought; leaving only lets go if the frame
     still holds it. */
  const grabFocus = () => {
    const active = document.activeElement;
    if (
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLSelectElement ||
      (active instanceof HTMLElement && active.isContentEditable)
    )
      return;
    frameRef.current?.focus();
  };
  const releaseFocus = () => {
    if (document.activeElement === frameRef.current) frameRef.current?.blur();
  };

  if (fill) {
    return (
      <iframe
        ref={frameRef}
        title={title || "Whirl visualization"}
        sandbox="allow-scripts allow-pointer-lock"
        srcDoc={srcDoc}
        onPointerEnter={grabFocus}
        onPointerLeave={releaseFocus}
        className="h-full w-full border-0 bg-transparent"
      />
    );
  }

  return (
    <motion.div
      initial={false}
      animate={{ height }}
      transition={{ duration: 0.3, ease: [0.22, 0.61, 0.36, 1] }}
      className="relative isolate w-full min-w-0 max-w-full overflow-hidden"
    >
      {mounted && (
        <iframe
          ref={frameRef}
          title={title || "Whirl visualization"}
          sandbox="allow-scripts allow-pointer-lock"
          srcDoc={srcDoc}
          onPointerEnter={grabFocus}
          onPointerLeave={releaseFocus}
          className="block h-full w-full max-w-full border-0 bg-transparent"
          style={ready ? undefined : { visibility: "hidden" }}
        />
      )}
    </motion.div>
  );
}
