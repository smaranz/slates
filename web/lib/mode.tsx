"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * Which half of Slates you're in.
 *
 * School is the assignment board, grades, and tutor — the work in front of
 * you. Counselor is the college side: the list, the applications, the
 * long-running conversation about where this is all going. They share a
 * student and almost nothing else, so rather than a seventh nav item the app
 * opens on a choice between them.
 *
 * The choice is remembered, so this is a launcher on the first run and a
 * no-op on every run after until you deliberately go back to it.
 */

export type Mode = "school" | "counselor";

const KEY = "slates.mode.v1";

interface ModeStore {
  /** null while the saved choice is being read, and again when it's cleared. */
  mode: Mode | null;
  /** True until the first read finishes — distinguishes "no choice" from "not yet known". */
  ready: boolean;
  choose: (mode: Mode) => void;
  /** Back to the launcher. */
  clear: () => void;
}

const Ctx = createContext<ModeStore | null>(null);

export function useMode(): ModeStore {
  const value = useContext(Ctx);
  if (!value) throw new Error("useMode must be used inside <ModeProvider>");
  return value;
}

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [ready, setReady] = useState(false);

  // Read after mount, not during render: this component renders on the server
  // too, and reading storage during render would hydrate the wrong tree.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(KEY);
      if (saved === "school" || saved === "counselor") setMode(saved);
    } catch {
      // Storage blocked. The launcher just shows every time.
    }
    setReady(true);
  }, []);

  const choose = useCallback((next: Mode) => {
    setMode(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // Not fatal — the choice holds for this session either way.
    }
  }, []);

  const clear = useCallback(() => {
    setMode(null);
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      // Same.
    }
  }, []);

  const value = useMemo(() => ({ mode, ready, choose, clear }), [mode, ready, choose, clear]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
