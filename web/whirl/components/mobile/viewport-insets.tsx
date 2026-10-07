"use client";

import { useEffect } from "react";

/* Publishes how much of the screen the on-screen keyboard is eating, as
   `--keyboard-inset` on <html>, plus a `data-keyboard` attribute for chrome
   that should stand aside while someone types.
 *
 * Neither platform moves its layout viewport for the keyboard (the viewport
 * export asks for `interactiveWidget: "resizes-visual"` to keep it that way
 * on Android too), so without this a bottom-docked composer sits calmly
 * underneath the keys the moment it's tapped — the single most
 * website-looking thing a chat app can do.
 *
 * The measurement is visualViewport's, and the shell subtracts it (see the
 * .app-frame rule in app/mobile.css). Desktop never reads either — the rules
 * that use them are inside a coarse-pointer media query — so a laptop window
 * resize can't route through here. */

/* Toolbars collapsing and re-expanding move the visual viewport by a few
   dozen pixels. A keyboard is hundreds. Anything under this is chrome
   breathing, and reacting to it would make the composer bob while reading. */
const KEYBOARD_FLOOR_PX = 100;

export function ViewportInsets() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const root = document.documentElement;
    let frame = 0;
    let last = -1;

    const measure = () => {
      frame = 0;
      const covered =
        window.innerHeight - viewport.height - viewport.offsetTop;
      const inset = covered > KEYBOARD_FLOOR_PX ? Math.round(covered) : 0;
      if (inset === last) return;
      last = inset;
      root.style.setProperty("--keyboard-inset", `${inset}px`);
      /* An attribute as well as the number, so chrome that should stand
         aside while someone types can do it in CSS alone. */
      if (inset > 0) root.setAttribute("data-keyboard", "");
      else root.removeAttribute("data-keyboard");
    };

    /* Both events fire in bursts as the keyboard animates in; one measure
       per frame is all the shell can use. */
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };

    measure();
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    return () => {
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      if (frame !== 0) cancelAnimationFrame(frame);
      root.style.removeProperty("--keyboard-inset");
      root.removeAttribute("data-keyboard");
    };
  }, []);

  return null;
}
