/* The message scroller follows the live edge: while the reader sits near
   the bottom, any growth of the transcript reads as streaming and gets
   scrolled to the end. Right for streams — wrong when the reader themself
   expands or collapses something (a thinking trace) and the resize yanks
   the view to the bottom.

   The primitive flips to free-scrolling only on real input on its viewport
   (wheel, touch, scroll keys) and exposes no API for it. A zero-delta
   wheel event dispatched from the toggled element bubbles up to the
   viewport and rides the exact same path — "the reader is driving now" —
   without moving a pixel. Harmless when no scroller is above the element.

   One exception: while the post-send buffer (the scroller's bottom spacer,
   which lets a fresh user turn anchor to the top) is up, the scroller is
   anchored to that turn and already rides out resizes without moving the
   view — no claim needed. Worse, claiming would cause the very yank this
   exists to prevent: knocked out of anchored mode, the scroller sees
   itself "near the end" (the spacer doesn't count toward that distance),
   re-latches onto the live edge, and the next resize collapses the buffer
   and slams the view to the bottom. A visible spacer means stay quiet. */
export function claimScrollIntent(from: HTMLElement) {
  const scroller = from.closest('[data-slot="message-scroller"]');
  if (scroller?.querySelector("[data-message-scroller-spacer]:not([hidden])"))
    return;
  from.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
}
