"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import {
  IconArrowsDiagonal,
  IconArrowsDiagonalMinimize2,
  IconCircleCheckFilled,
  IconLink,
  IconX,
} from "@tabler/icons-react";

import { toggleArtifactFullscreen } from "@whirl/lib/artifact-panel";
import {
  DOCUMENT_PANEL_DEFAULT_WIDTH,
  clampDocumentPanelWidth,
  persistDocumentPanelWidth,
  readDocumentPanelWidth,
  snapDocumentPanelWidth,
} from "@whirl/lib/document-panel";

/* The right-hand artifact panel shell, shared by the document and HTML
   panels (only one is ever open at a time). On desktop it's a
   drag-to-resize pane that squeezes the chat aside and can morph to
   fullscreen; on mobile it's a full-screen overlay. Both panels share one
   persisted width. Only width and layout ever animate — never transforms
   or opacity around the pane — so the sandboxed iframes inside can't hit
   Chromium's frozen-iframe compositing bug (see html-frame-view.tsx). */

type ShellProps = {
  onClose: () => void;
  /** Desktop: fill the content area (chat hidden). Ignored by the overlay. */
  fullscreen?: boolean;
  children: ReactNode;
};

/** Desktop: an inline, drag-to-resize pane that shares the row with the chat. */
export function EmbeddedPanel({
  onClose,
  fullscreen = false,
  children,
}: ShellProps) {
  const [width, setWidth] = useState(readDocumentPanelWidth);
  const [isResizing, setIsResizing] = useState(false);
  /* The width the pane grows to in fullscreen = the whole content region
     (its flex parent), which the chat shares. Animating to a real px width
     (rather than a transform) makes the pane reflow as it morphs. The
     chat, as a flex sibling with min-w-0, is squeezed to zero as we grow. */
  const asideRef = useRef<HTMLElement>(null);
  const [fillWidth, setFillWidth] = useState(0);
  useEffect(() => {
    const parent = asideRef.current?.parentElement;
    if (!parent) return;
    const measure = () => setFillWidth(parent.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  /* The pane overlays the content region while fullscreen — and must stay
     an overlay through the *exit* morph too, only re-docking once the
     width has animated all the way back. */
  const [overlay, setOverlay] = useState(false);
  useEffect(() => {
    if (fullscreen) setOverlay(true);
  }, [fullscreen]);

  const resizeStartRef = useRef<{ x: number; width: number } | null>(null);
  /* Teardown for an in-flight resize drag (global listeners + hijacked
     body styles), held in a ref so unmounting mid-drag can run it. */
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => resizeCleanupRef.current?.(), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* Drag the left edge: pulling left (smaller clientX) widens the panel. */
  const onResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      resizeStartRef.current = { x: event.clientX, width };
      setIsResizing(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: PointerEvent) => {
        const start = resizeStartRef.current;
        if (!start) return;
        setWidth(clampDocumentPanelWidth(start.width + (start.x - ev.clientX)));
      };

      const cleanup = () => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onEnd);
        document.removeEventListener("pointercancel", onEnd);
        resizeCleanupRef.current = null;
      };

      const onEnd = (ev: PointerEvent) => {
        const start = resizeStartRef.current;
        resizeStartRef.current = null;
        setIsResizing(false);
        cleanup();
        if (start) {
          const next = snapDocumentPanelWidth(
            start.width + (start.x - ev.clientX),
          );
          setWidth(next);
          persistDocumentPanelWidth(next);
        }
      };

      resizeCleanupRef.current = cleanup;
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onEnd);
      document.addEventListener("pointercancel", onEnd);
    },
    [width],
  );

  const onResizeDoubleClick = useCallback(() => {
    setWidth(DOCUMENT_PANEL_DEFAULT_WIDTH);
    persistDocumentPanelWidth(DOCUMENT_PANEL_DEFAULT_WIDTH);
  }, []);

  const transition = isResizing
    ? { duration: 0 }
    : {
        type: "tween" as const,
        duration: 0.32,
        ease: [0.32, 0.72, 0, 1] as [number, number, number, number],
      };

  return (
    <motion.aside
      ref={asideRef}
      initial={{ width: 0 }}
      animate={{ width }}
      exit={{ width: 0 }}
      transition={transition}
      /* The aside is a flex item with a z-index, so IT is the stacking
         context — the inner pane's z-30 never escapes it. While overlaying
         (fullscreen) it must outrank the chat column's composer dock (z-10)
         and the transcript's reveal layer (z-2), or the thread paints
         straight through the pane. */
      className={`hidden h-full shrink-0 md:block ${
        overlay ? "z-20" : "relative z-0"
      }`}
    >
      <motion.div
        animate={{ width: fullscreen ? Math.max(fillWidth, 0) : width }}
        transition={transition}
        onAnimationComplete={() => {
          if (!fullscreen) setOverlay(false);
        }}
        className={`flex flex-col overflow-hidden border-l border-border bg-surface ${
          overlay ? "absolute inset-y-0 right-0" : "relative h-full"
        }`}
      >
        {!overlay && (
          <button
            type="button"
            aria-label="Resize panel"
            title="Drag to resize. Double-click for default width."
            onPointerDown={onResizePointerDown}
            onDoubleClick={onResizeDoubleClick}
            className="group absolute inset-y-0 left-0 z-20 flex w-2.5 cursor-col-resize touch-none items-center justify-center"
          >
            <span className="h-10 w-[3px] rounded-full bg-black/[0.08] transition-colors duration-150 group-hover:bg-black/20 dark:bg-white/[0.12] dark:group-hover:bg-white/30" />
          </button>
        )}
        {children}
      </motion.div>
    </motion.aside>
  );
}

/** Mobile: a full-screen overlay that slides up over the chat. */
export function OverlayPanel({ onClose, children }: ShellProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <motion.div
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%" }}
      transition={{ type: "spring", stiffness: 360, damping: 36 }}
      className="fixed inset-0 z-70 flex flex-col bg-surface"
    >
      {children}
    </motion.div>,
    document.body,
  );
}

export function useMinMd() {
  const [minMd, setMinMd] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(min-width: 768px)").matches
      : false,
  );
  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const onChange = () => setMinMd(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return minMd;
}

/** Picks the right shell for the viewport. */
export function useArtifactShell() {
  const minMd = useMinMd();
  return minMd ? EmbeddedPanel : OverlayPanel;
}

/**
 * Desktop-only toggle that expands the panel to fill the content area
 * (hiding the chat) and back.
 */
export function FullscreenToggle({ fullscreen }: { fullscreen: boolean }) {
  const minMd = useMinMd();
  if (!minMd) return null;
  const Glyph = fullscreen ? IconArrowsDiagonalMinimize2 : IconArrowsDiagonal;
  return (
    <button
      type="button"
      aria-label={fullscreen ? "Exit fullscreen (show chat)" : "Fullscreen"}
      title={fullscreen ? "Show chat" : "Fullscreen"}
      onClick={toggleArtifactFullscreen}
      className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.06]"
    >
      <Glyph size={15} stroke={2} />
    </button>
  );
}

/**
 * A header button that copies an artifact's public share link — used by
 * both panels (documents and HTML pages). Flashes a check on success.
 */
export function CopyLinkButton({ url, label }: { url: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard may be blocked; ignore.
    }
  };

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={copyLink}
      className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.06]"
    >
      {copied ? (
        <IconCircleCheckFilled size={15} className="text-emerald-500" />
      ) : (
        <IconLink size={15} stroke={2} />
      )}
    </button>
  );
}

/** The shared header close button. */
export function CloseButton({
  onClose,
  label = "Close",
}: {
  onClose: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClose}
      className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.06]"
    >
      <IconX size={13} stroke={2.5} />
    </button>
  );
}
