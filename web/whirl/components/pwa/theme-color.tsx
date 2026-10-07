"use client";

import { useEffect } from "react";

/* Keeps <meta name="theme-color"> pointed at whatever the app is actually
   wearing.
 *
 * Installed on a phone, that tag is the status bar behind the app and the
 * band around the switcher card — so when it disagrees with the theme, the
 * app looks like it's wearing someone else's hat. The layout ships a
 * media-paired pair of tags, which is right for the default (theme:
 * "system") and needs no JavaScript; this fixes up the case those can't
 * see, where the reader has picked a theme that disagrees with their OS.
 *
 * The `.dark` class on <html> is the single thing both the pre-paint boot
 * script and setTheme write to, so watching it covers explicit picks, system
 * flips, and another tab changing the preference alike. */

/* --surface in app/globals.css: what fills the top of the screen on a phone,
   where <main> runs edge to edge. Canvas tint shifts these a hair; not worth
   parsing computed styles over — the status bar is a 40px band, not a
   surface anyone colour-matches against. */
const LIGHT = "#ffffff";
const DARK = "#181818";

export function ThemeColor() {
  useEffect(() => {
    const root = document.documentElement;

    const apply = () => {
      const color = root.classList.contains("dark") ? DARK : LIGHT;
      const tags = document.head.querySelectorAll<HTMLMetaElement>(
        'meta[name="theme-color"]',
      );
      if (tags.length === 0) {
        const tag = document.createElement("meta");
        tag.name = "theme-color";
        tag.content = color;
        document.head.appendChild(tag);
        return;
      }
      for (const tag of tags) {
        /* The media attribute has to go with it: browsers take the first
           tag whose query matches, so leaving `(prefers-color-scheme: light)`
           on a tag now holding the dark colour just hides it again. */
        tag.removeAttribute("media");
        if (tag.content !== color) tag.content = color;
      }
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return null;
}
