"use client";

import { useCallback, useState } from "react";

/**
 * An element's live height in pixels, or 0 before it has been measured.
 *
 * For animations that need a real pixel target instead of `auto`. Animating to
 * `auto` means reading the natural height off the DOM at the exact moment the
 * animation starts — which is also the moment the content around it is being
 * rewritten, so the number that comes back is whatever the layout happened to
 * be mid-change. Point this at a static, never-animated copy of the content
 * and the target is a settled number long before anything starts moving.
 *
 * The ref is a callback ref returning its own cleanup (React 19), so it
 * follows the node across remounts without an effect and without a null pass.
 */
export function useBlockHeight() {
  const [height, setHeight] = useState(0);

  const ref = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    /* Once synchronously at attach, so the very first paint already knows
       whether the content wraps — a beat late here would mean one frame where
       everything looks like it fits. */
    setHeight(node.getBoundingClientRect().height);

    /* And then for everything React never rendered: a webfont landing, the
       column resizing, the text reflowing at a new width. */
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      /* Border-box, kept fractional. Rounding here would let a half-pixel
         line box read as "wraps" on one measurement and "fits" on the next,
         which is a capsule that opens and shuts on its own. */
      const box = entry.borderBoxSize?.[0];
      setHeight(box ? box.blockSize : entry.contentRect.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, height };
}
