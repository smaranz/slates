"use client";

/* Whirl signs people in with Clerk. A Slates host has one person on it, and
   the device gate in proxy.ts has already decided who gets this far — so
   here they're simply signed in, as the student Slates knows. */

import { useMemo, useSyncExternalStore } from "react";

export interface LocalUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  username: string | null;
  imageUrl: string;
  hasImage: boolean;
  primaryEmailAddress: { emailAddress: string } | null;
  update(patch: { firstName?: string; lastName?: string }): Promise<void>;
  setProfileImage(args: { file: Blob | null }): Promise<void>;
}

const USER_ID = "slates-student";

type Profile = { name: string; avatar: string | null };

/* Slates keeps the student's name and photo in this browser (lib/identity),
   and /agent is the same origin, so read them straight from there. */
const PROFILE_KEY = "slates.profile.v1";
const EMPTY: Profile = { name: "", avatar: null };
let cached: { raw: string | null; profile: Profile } = { raw: null, profile: EMPTY };

function readProfile(): Profile {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(PROFILE_KEY);
  } catch {
    return EMPTY;
  }
  if (raw === cached.raw) return cached.profile;
  let profile = EMPTY;
  try {
    const saved = raw ? (JSON.parse(raw) as { name?: string; studentName?: string; avatar?: string }) : {};
    const name = saved.name ?? saved.studentName ?? "";
    profile = {
      name: typeof name === "string" ? name : "",
      avatar: typeof saved.avatar === "string" && saved.avatar.startsWith("data:image/") ? saved.avatar : null,
    };
  } catch {
    /* a corrupt blob just means no name */
  }
  cached = { raw, profile };
  return profile;
}

function subscribe(fn: () => void) {
  window.addEventListener("storage", fn);
  return () => window.removeEventListener("storage", fn);
}

const noop = () => () => {};

/* Like Clerk, the user isn't known during the server render — only once the
   page is running. Components that vary with the user (the random greeting)
   then render the same on both sides and hydrate cleanly. */
export function useUser(): { user: LocalUser | null; isLoaded: boolean; isSignedIn: boolean } {
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const current = useSyncExternalStore(subscribe, readProfile, () => EMPTY);
  const user = useMemo<LocalUser>(() => {
    const [first, ...rest] = current.name.trim().split(/\s+/);
    return {
      id: USER_ID,
      firstName: first || null,
      lastName: rest.join(" ") || null,
      fullName: current.name.trim() || null,
      username: null,
      imageUrl: current.avatar ?? "",
      hasImage: !!current.avatar,
      primaryEmailAddress: null,
      // The name and photo belong to Slates' own settings, not this app.
      update: async () => {},
      setProfileImage: async () => {},
    };
  }, [current]);
  return hydrated ? { user, isLoaded: true, isSignedIn: true } : { user: null, isLoaded: false, isSignedIn: false };
}

/* Whirl asked Clerk for a token to call Convex; Slates' own routes need none. */
const getToken: (options?: { template?: string }) => Promise<string | null> = async () => null;

export function useAuth() {
  return { isLoaded: true, isSignedIn: true, userId: USER_ID, getToken } as const;
}

export function useClerk() {
  return {
    signOut: async () => {},
    openUserProfile: () => {},
  } as const;
}
