"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Who you are, once, for the whole app.
 *
 * School and Counselor each grew their own idea of the student — one had a
 * name and a photo in Settings, the other had a name buried in a college
 * profile — and the two could disagree. They are the same person, so this is
 * the one place that answers it: both halves read from here and write back to
 * here, and telling the counselor your name in conversation renames you in the
 * sidebar of the other half.
 *
 * Kept in `slates.profile.v1`, which is where the school side already stored
 * it, so nothing existing is lost on the way through.
 */

const KEY = "slates.profile.v1";
/** Names saved before the profile was split out lived on the snapshot key. */
const LEGACY_KEY = "slates.state.v1";

export interface Identity {
  name: string;
  /** A data: URL. Kept small by `readAvatarFile` before it ever gets here. */
  avatar: string | null;
}

interface IdentityStore extends Identity {
  /** False until the saved identity has been read. */
  ready: boolean;
  setName: (name: string) => void;
  setAvatar: (avatar: string | null) => void;
}

const Ctx = createContext<IdentityStore | null>(null);

export function useIdentity(): IdentityStore {
  const value = useContext(Ctx);
  if (!value) throw new Error("useIdentity must be used inside <IdentityProvider>");
  return value;
}

function load(): Identity {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Identity> & { studentName?: string };
      // `studentName` is what the school side wrote before this was shared.
      const name = saved.name ?? saved.studentName;
      return {
        name: typeof name === "string" ? name : "",
        avatar:
          typeof saved.avatar === "string" && saved.avatar.startsWith("data:image/")
            ? saved.avatar
            : null,
      };
    }
  } catch {
    // A corrupt profile blob is not worth failing a boot over.
  }

  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as { studentName?: string };
      if (typeof saved.studentName === "string" && saved.studentName) {
        return { name: saved.studentName, avatar: null };
      }
    }
  } catch {
    // Same.
  }

  return { name: "", avatar: null };
}

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<Identity>({ name: "", avatar: null });
  const [ready, setReady] = useState(false);

  // Read after mount, not during render: this renders on the server too.
  useEffect(() => {
    setIdentity(load());
    setReady(true);
  }, []);

  // Nothing is written before the first read, or an empty initial identity
  // would overwrite a real saved one on mount.
  const first = useRef(true);
  useEffect(() => {
    if (!ready) return;
    if (first.current) {
      first.current = false;
      return;
    }
    try {
      // `studentName` is still written alongside `name` so an older build —
      // or a half-updated desktop bundle — keeps reading the same person.
      window.localStorage.setItem(
        KEY,
        JSON.stringify({ name: identity.name, studentName: identity.name, avatar: identity.avatar })
      );
    } catch {
      // Quota or a blocked store. The session still works.
    }
  }, [identity, ready]);

  const setName = useCallback((name: string) => setIdentity((prev) => ({ ...prev, name })), []);
  const setAvatar = useCallback((avatar: string | null) => setIdentity((prev) => ({ ...prev, avatar })), []);

  const value = useMemo<IdentityStore>(
    () => ({ ...identity, ready, setName, setAvatar }),
    [identity, ready, setName, setAvatar]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
