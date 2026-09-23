"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

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

/**
 * Four rooms off the launcher — school work, applications, the component
 * shelf, and the ledger for every AI call Slates makes. "Halves" stopped
 * fitting when the UI shelf earned its own door; usage is the same idea.
 */
export type Mode = "school" | "counselor" | "ui" | "usage";

const KEY = "slates.mode.v1";

/** Every mode, in one place. */
const MODES: Mode[] = ["school", "counselor", "ui", "usage"];

function isMode(value: string | null): value is Mode {
  return !!value && (MODES as string[]).includes(value);
}

interface ModeStore {
  /** null while the saved choice is being read, and again when it's cleared. */
  mode: Mode | null;
  /** True until the first read finishes — distinguishes "no choice" from "not yet known". */
  ready: boolean;
  choose: (mode: Mode) => void;
  /** Back to the launcher. */
  clear: () => void;

  /**
   * Whether the settings screen is showing.
   *
   * Settings belongs to Slates, not to either half of it — the name, the
   * Schoology connection, the keys and the student's own record are the same
   * whichever side you came from. So there is one screen, reached from the
   * home screen, rather than a Settings tab in School and a Profile tab in
   * Counselor that quietly disagreed about which was authoritative.
   *
   * Deliberately not persisted: reopening the app should land you where you
   * work, never on a settings page you happened to close it on.
   */
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
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
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Read after mount, not during render: this component renders on the server
  // too, and reading storage during render would hydrate the wrong tree.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(KEY);
      if (isMode(saved)) setMode(saved);
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

  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  const value = useMemo(
    () => ({
      mode,
      ready,
      choose,
      clear,
      settingsOpen,
      openSettings,
      closeSettings,
    }),
    [mode, ready, choose, clear, settingsOpen, openSettings, closeSettings],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
