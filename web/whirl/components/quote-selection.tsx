"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { IconQuote } from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";

import { insertComposerQuote } from "@whirl/lib/composer-ingest";
import { ANALYTICS_EVENTS, captureEvent } from "@whirl/lib/posthog";

const QUOTABLE_SELECTOR = "[data-quotable]";

type QuoteTarget = {
  text: string;
  role: string;
  left: number;
  top: number;
  bottom: number;
};

function quotableHost(node: Node | null): Element | null {
  const element =
    node instanceof Element ? node : (node?.parentElement ?? null);
  return element?.closest(QUOTABLE_SELECTOR) ?? null;
}

function readSelection(): QuoteTarget | null {
  const selection = window.getSelection?.();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }
  const text = selection.toString().trim();
  if (!text) return null;

  /* A drag may not spill into another message or out of the transcript. */
  const anchorHost = quotableHost(selection.anchorNode);
  const focusHost = quotableHost(selection.focusNode);
  if (!anchorHost || anchorHost !== focusHost) return null;

  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return {
    text,
    role: anchorHost.getAttribute("data-quotable") || "assistant",
    left: rect.left + rect.width / 2,
    top: rect.top,
    bottom: rect.bottom,
  };
}

export function QuoteSelectionPopover() {
  const [target, setTarget] = useState<QuoteTarget | null>(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setTarget(readSelection()));
    };
    /* The scroll listener is in capture, so it hears EVERY scroller in the
       app — the transcript most of all. Nothing is selected during almost
       all of that scrolling, so check before booking a frame: measuring a
       selection that doesn't exist still costs a rAF callback and a
       getSelection on each of those frames, right when the reader is
       watching something move. */
    const updateIfSelecting = () => {
      const selection = window.getSelection?.();
      if (!selection || selection.isCollapsed) return;
      update();
    };
    const onSelectionChange = () => {
      const selection = window.getSelection?.();
      if (!selection || selection.isCollapsed) setTarget(null);
    };

    document.addEventListener("pointerup", update);
    document.addEventListener("keyup", update);
    document.addEventListener("selectionchange", onSelectionChange);
    window.addEventListener("scroll", updateIfSelecting, true);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerup", update);
      document.removeEventListener("keyup", update);
      document.removeEventListener("selectionchange", onSelectionChange);
      window.removeEventListener("scroll", updateIfSelecting, true);
      window.removeEventListener("resize", update);
    };
  }, []);

  const handleQuote = useCallback(() => {
    if (!target) return;
    const quote = target.text
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    if (insertComposerQuote(quote)) {
      captureEvent(ANALYTICS_EVENTS.messageQuoted, {
        role: target.role,
        selection_length: target.text.length,
      });
    }
    window.getSelection()?.removeAllRanges();
    setTarget(null);
  }, [target]);

  if (typeof document === "undefined") return null;

  const flip = target ? target.top < 56 : false;
  const left = target
    ? Math.min(Math.max(target.left, 56), window.innerWidth - 56)
    : 0;
  const top = target ? (flip ? target.bottom + 8 : target.top - 8) : 0;

  return createPortal(
    <AnimatePresence>
      {target && (
        <motion.div
          key="quote-selection"
          initial={{ opacity: 0, y: flip ? -4 : 4, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: flip ? -4 : 4, scale: 0.95 }}
          transition={{ duration: 0.14, ease: [0.22, 0.61, 0.36, 1] }}
          className={`fixed z-[70] -translate-x-1/2 ${
            flip ? "" : "-translate-y-full"
          }`}
          style={{ left, top }}
        >
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={handleQuote}
            className="raised flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-popover px-3 text-[12.5px] font-medium text-foreground shadow-sm transition-[background-color,scale] duration-150 hover:bg-accent active:scale-[0.96]"
          >
            <IconQuote size={14} stroke={2} />
            Quote
          </button>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
