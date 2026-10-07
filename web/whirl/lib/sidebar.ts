"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

/* Sidebar geometry lives in localStorage (same keys as the main app) and is
   painted before hydration by an inline script in the root layout, which sets
   `--sidebar-width` and `data-sidebar-collapsed` on <html> — the same
   pre-paint trick theme.ts uses for `.dark`. React state here drives behavior
   (aria labels, resize math); the var and attribute are the visual source of
   truth, so a stored width never flashes the default on load.
   Keep the numbers in sync with the script in app/layout.tsx. */

const COLLAPSED_KEY = "sidebar-collapsed";
const WIDTH_KEY = "sidebar-width";

/** Default expanded width — matches the old `w-64` (16rem). */
export const SIDEBAR_DEFAULT_WIDTH = 256;
export const SIDEBAR_COLLAPSED_WIDTH = 64;
export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 440;
export const SIDEBAR_SNAP_THRESHOLD = 14;

export function clampSidebarWidth(width: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

/** Magnetic snap: widths near the default lock onto it. */
export function snapSidebarWidth(width: number) {
  const clamped = clampSidebarWidth(width);
  return Math.abs(clamped - SIDEBAR_DEFAULT_WIDTH) <= SIDEBAR_SNAP_THRESHOLD
    ? SIDEBAR_DEFAULT_WIDTH
    : clamped;
}

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function readWidth() {
  try {
    const parsed = Number(localStorage.getItem(WIDTH_KEY));
    return parsed ? clampSidebarWidth(parsed) : SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

function persist(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode etc. — the layout still updates for this visit
  }
}

function applyDom(collapsed: boolean, width: number) {
  const el = document.documentElement;
  el.style.setProperty(
    "--sidebar-width",
    `${collapsed ? SIDEBAR_COLLAPSED_WIDTH : width}px`,
  );
  el.toggleAttribute("data-sidebar-collapsed", collapsed);
}

export function useSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);

  /* Adopt what the pre-paint script already painted. */
  useEffect(() => {
    setCollapsed(readCollapsed());
    setWidth(readWidth());
  }, []);

  /* The drag's window listeners normally leave with the pointer, but a
     drag the browser abandons (or an unmount mid-drag) must not strand
     them on window for the rest of the session. */
  const endDragRef = useRef<(() => void) | null>(null);
  useEffect(() => () => endDragRef.current?.(), []);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    applyDom(next, width);
    persist(COLLAPSED_KEY, next ? "1" : "0");
  };

  const onResizePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (collapsed || event.button !== 0) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // pointer already gone — window listeners below still track the drag
    }

    const startX = event.clientX;
    const startWidth = width;
    let latest = startWidth;
    setResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: PointerEvent) => {
      latest = snapSidebarWidth(startWidth + ev.clientX - startX);
      // The CSS var alone drives layout — a setState here would re-render
      // the whole sidebar tree on every pointermove and the drag stutters.
      applyDom(false, latest);
    };
    const finish = () => {
      endDragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setWidth(latest);
      setResizing(false);
      persist(WIDTH_KEY, String(latest));
    };
    endDragRef.current?.();
    endDragRef.current = finish;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const onResizeDoubleClick = () => {
    setWidth(SIDEBAR_DEFAULT_WIDTH);
    applyDom(false, SIDEBAR_DEFAULT_WIDTH);
    persist(WIDTH_KEY, String(SIDEBAR_DEFAULT_WIDTH));
  };

  return {
    collapsed,
    width,
    resizing,
    toggleCollapsed,
    onResizePointerDown,
    onResizeDoubleClick,
  };
}
