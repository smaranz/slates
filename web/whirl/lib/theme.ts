"use client";

import { useEffect, useState } from "react";

/* Theme lives in localStorage under "theme" (same key as the main app) and
   is applied as a `.dark` class on <html>. A blocking inline script in the
   root layout applies it before first paint; this hook is for switching it
   afterwards. */
export type Theme = "light" | "dark" | "system";

const THEMES: Theme[] = ["light", "dark", "system"];

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem("theme");
    // Slates is a dark app; dark until someone picks otherwise.
    return THEMES.includes(stored as Theme) ? (stored as Theme) : "dark";
  } catch {
    return "dark";
  }
}

function applyTheme(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

/* Whether dark mode is currently in effect, tracked live off the `.dark`
   class on <html> — the single place both the pre-paint script and setTheme
   write to. Works regardless of whether the theme is explicit or system. */
export function useIsDark() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const el = document.documentElement;
    const update = () => setIsDark(el.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    setThemeState(readTheme());
  }, []);

  useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // private mode etc. — the class still applies for this visit
    }
    applyTheme(next);
  };

  return { theme, setTheme };
}
