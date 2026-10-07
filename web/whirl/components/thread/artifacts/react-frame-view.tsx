"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { useConvex } from "@whirl/backend/react";
import { api } from "@whirl/backend/convex/_generated/api";
import type { Id } from "@whirl/backend/convex/_generated/dataModel";

import { compileArtifactModule, warmJsxCompiler } from "@whirl/lib/jsx-compile";
import { whirlThemeTokens } from "@whirl/lib/html-frame";
import { useIsDark } from "@whirl/lib/theme";

const INLINE_MIN_HEIGHT = 80;
const INLINE_MAX_HEIGHT = 800;
/** Leaves chat chrome and nearby messages visible on short/narrow panes. */
const INLINE_VIEWPORT_SHARE = 0.65;
/** How long a still-streaming module waits before being compiled again. */
const RECOMPILE_DEBOUNCE_MS = 400;

/**
 * Renders a React artifact inside the sandboxed frame.
 *
 * The frame is a real route (`/artifact-frame`) rather than a srcdoc, so the
 * 1MB runtime loads once and stays HTTP-cached, and the document can carry a
 * CSP that closes off every way data could leave it. It's still
 * `allow-scripts` with NO `allow-same-origin`, so the code inside runs in an
 * opaque origin.
 *
 * The module is compiled here and posted in. Nothing about the artifact is in
 * the URL, so a theme change or a new revision is a message, not a reload —
 * which is also why the frame keeps its state across a streaming edit.
 *
 * Streaming: a half-written module is a syntax error, not a half-rendered
 * page. So while the body is still arriving the card shows the code coming in
 * and only mounts the real thing once it compiles.
 */
export function ReactFrameView({
  htmlId,
  code,
  title,
  streaming = false,
  fill = false,
  maxHeight = INLINE_MAX_HEIGHT,
  mountDelayMs = 0,
  onErrorChange,
}: {
  /** The artifact row, so its declared data bindings can be run for it. */
  htmlId?: string;
  code: string;
  title?: string;
  /** The body is still being written — don't try to mount every keystroke. */
  streaming?: boolean;
  fill?: boolean;
  maxHeight?: number;
  mountDelayMs?: number;
  /** Lets the card surface a compile/runtime failure in its own chrome. */
  onErrorChange?: (error: string | null) => void;
}) {
  const dark = useIsDark();
  const convex = useConvex();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [frameReady, setFrameReady] = useState(false);
  const [compiled, setCompiled] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contentHeight, setContentHeight] = useState(INLINE_MIN_HEIGHT);
  const [viewportCap, setViewportCap] = useState(INLINE_MAX_HEIGHT);
  const [mounted, setMounted] = useState(mountDelayMs <= 0);

  useEffect(() => {
    warmJsxCompiler();
  }, []);

  useEffect(() => {
    if (mounted) return;
    const timer = setTimeout(() => setMounted(true), mountDelayMs);
    return () => clearTimeout(timer);
  }, [mounted, mountDelayMs]);

  useEffect(() => {
    onErrorChange?.(error);
  }, [error, onErrorChange]);

  /* Compile. While streaming this is debounced and failures are swallowed —
     a module that doesn't parse yet is the normal state of a module being
     written, not something to shout about. */
  useEffect(() => {
    if (!code.trim()) return;
    let cancelled = false;
    const run = async () => {
      const result = await compileArtifactModule(code);
      if (cancelled) return;
      if (result.ok) {
        setCompiled(result.code);
        setError(null);
      } else if (!streaming) {
        setError(result.error);
      }
    };
    if (!streaming) {
      void run();
      return () => {
        cancelled = true;
      };
    }
    const timer = setTimeout(() => void run(), RECOMPILE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, streaming]);

  const post = useCallback((message: unknown) => {
    frameRef.current?.contentWindow?.postMessage(message, "*");
  }, []);

  /* Run one of the artifact's declared bindings on its behalf. The frame
     names a binding id and nothing else — which integration and tool that
     maps to was decided when the artifact was written and lives server-side. */
  const runBinding = useCallback(
    async (
      bindingId: string,
      extraArgs: string | undefined,
      force: boolean,
    ) => {
      if (!htmlId) {
        return {
          ok: false as const,
          error: "This artifact's data isn't available here.",
        };
      }
      try {
        return await convex.action(api.artifactData.runBinding, {
          htmlId: htmlId as Id<"htmlArtifacts">,
          bindingId,
          ...(extraArgs ? { extraArgs } : {}),
          ...(force ? { force: true } : {}),
        });
      } catch {
        return {
          ok: false as const,
          error: "Couldn't reach Whirl to load this data.",
        };
      }
    },
    [convex, htmlId],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as {
        type?: string;
        height?: unknown;
        message?: unknown;
        phase?: unknown;
        requestId?: number;
        bindingId?: string;
        extraArgs?: string;
        force?: boolean;
      } | null;

      switch (data?.type) {
        case "whirl-artifact-ready":
          setFrameReady(true);
          break;
        case "whirl-artifact-height": {
          if (fill) break;
          const reported = Number(data.height);
          if (!Number.isFinite(reported)) break;
          setContentHeight(Math.max(Math.ceil(reported), INLINE_MIN_HEIGHT));
          break;
        }
        case "whirl-artifact-error":
          /* Only a settled artifact reports failures upward; mid-stream, a
             crash usually just means the module isn't finished. */
          if (!streaming && typeof data.message === "string") {
            setError(data.message);
          }
          break;
        case "whirl-artifact-data-request": {
          const requestId = data.requestId;
          const bindingId = data.bindingId;
          if (typeof requestId !== "number" || typeof bindingId !== "string") {
            break;
          }
          void runBinding(
            bindingId,
            data.extraArgs,
            data.force === true,
          ).then((result) => {
            post({
              type: "whirl-artifact-data-result",
              requestId,
              result,
            });
          });
          break;
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [fill, post, runBinding, streaming]);

  /* Push state down whenever the frame or the state changes. Order matters on
     first paint: theme and mode before code, so the module never renders a
     frame at the wrong size or in the wrong palette. */
  useEffect(() => {
    if (!frameReady) return;
    post({ type: "whirl-artifact-theme", dark, tokens: whirlThemeTokens(dark) });
  }, [frameReady, dark, post]);

  useEffect(() => {
    if (!frameReady) return;
    post({ type: "whirl-artifact-mode", fill });
  }, [frameReady, fill, post]);

  useEffect(() => {
    if (!frameReady || compiled === null) return;
    post({ type: "whirl-artifact-code", code: compiled });
  }, [frameReady, compiled, post]);

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

  /* Keys go to whatever the pointer is over, without ever stealing from a
     real text input — same rule as the HTML frame. */
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

  const frame = mounted ? (
    <iframe
      ref={frameRef}
      title={title || "Whirl artifact"}
      sandbox="allow-scripts allow-pointer-lock"
      src="/artifact-frame"
      onPointerEnter={grabFocus}
      onPointerLeave={releaseFocus}
      className="block h-full w-full max-w-full border-0 bg-transparent"
      style={compiled === null ? { visibility: "hidden" } : undefined}
    />
  ) : null;

  if (fill) {
    return <div className="relative h-full w-full">{frame}</div>;
  }

  const height = Math.min(contentHeight, maxHeight, viewportCap);

  return (
    <motion.div
      initial={false}
      animate={{ height: compiled === null ? INLINE_MIN_HEIGHT : height }}
      transition={{ duration: 0.3, ease: [0.22, 0.61, 0.36, 1] }}
      className="relative isolate w-full min-w-0 max-w-full overflow-hidden"
    >
      {frame}
    </motion.div>
  );
}
