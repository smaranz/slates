"use client";

import { useCallback, useRef, useState } from "react";

/* A soft edge over a scroll area: the surface color fades in over a light
   backdrop blur, so rows visibly dissolve when there's more to scroll that
   way. Lifted from the sidebar's thread list so every scroller wears the
   same edge. `from` names the surface behind the content — the sidebar
   fades from background, popovers from popover. */
export function ScrollFade({
  side,
  visible,
  from = "from-background",
}: {
  side: "top" | "bottom";
  visible: boolean;
  from?: string;
}) {
  const geometry =
    side === "top"
      ? "top-0 bg-linear-to-b [mask-image:linear-gradient(to_bottom,black,transparent)]"
      : "bottom-0 bg-linear-to-t [mask-image:linear-gradient(to_top,black,transparent)]";
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 z-10 h-10 ${from} to-transparent backdrop-blur-[2px] transition-opacity duration-200 ${geometry} ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    />
  );
}

/* Fade bookkeeping for scrollers that mount late (popover views, dialog
   lists): the callback ref attaches a ResizeObserver to the viewport and
   its content, so the edges update on growth/shrink without a scroll
   event. Give the scroller ONE wrapper child around its rows (that's what
   gets observed) and spread { ref: scrollRef, onScroll } on the scroller. */
export function useScrollFades() {
  const [fades, setFades] = useState({ top: false, bottom: false });
  const elRef = useRef<HTMLElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const updateFades = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    const top = el.scrollTop > 2;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
    setFades((current) =>
      current.top === top && current.bottom === bottom
        ? current
        : { top, bottom },
    );
  }, []);

  const scrollRef = useCallback(
    (el: HTMLElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      elRef.current = el;
      if (!el) return;
      const observer = new ResizeObserver(updateFades);
      observer.observe(el);
      if (el.firstElementChild) observer.observe(el.firstElementChild);
      observerRef.current = observer;
      updateFades();
    },
    [updateFades],
  );

  return { scrollRef, onScroll: updateFades, fades };
}
