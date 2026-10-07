"use client";

import { useMemo } from "react";
import { useConvexAuth, useQuery } from "@whirl/backend/react";

import { api } from "@whirl/backend/convex/_generated/api";
import type { Id } from "@whirl/backend/convex/_generated/dataModel";
import { useCachedList } from "./cached-list";
import type { MentionTarget } from "./integrations";

/* Client bindings for the store's Skills tab — the integration store's
   little sibling. A skill is just instruction text the model pulls in on
   demand: no server, no auth flow, no quota. Same cache-then-live rhythm
   as lib/integrations-data.ts. */

const STORE_CACHE_KEY = "skills-store";
const INSTALLED_CACHE_KEY = "skills-installed";

/** A skill listing as the browse card needs it — branding plus whether the
 *  caller already has it installed. The instruction text never ships to
 *  the store surface. */
export type StoreSkill = {
  id: Id<"skills">;
  name: string;
  description?: string;
  author?: string;
  /** The shelf the browse page groups this under; null = not yet shelved. */
  category: string | null;
  verified: boolean;
  logoUrl: string | null;
  bannerUrl: string | null;
  iconSvg?: string;
  installed: boolean;
};

/** One of the caller's skill installs, joined with the listing's branding. */
export type InstalledSkill = {
  installId: Id<"skillInstalls">;
  name: string;
  description?: string;
  author?: string;
  verified: boolean;
  logoUrl: string | null;
  iconSvg?: string;
  enabled: boolean;
};

/** Every skill listing, cache-then-live. Null only before the first-ever
 *  answer (no cache yet) — the browse tab's skeleton state. */
export function useSkillStore(): StoreSkill[] | null {
  const live = useQuery(api.skillStore.listStore) as any[] | undefined;
  const rows = useMemo(
    () =>
      live?.map(
        (row): StoreSkill => ({
          id: row.id,
          name: row.name,
          description: row.description,
          author: row.author,
          category: row.category ?? null,
          verified: row.verified,
          logoUrl: row.logoUrl,
          bannerUrl: row.bannerUrl,
          iconSvg: row.iconSvg,
          installed: row.installed,
        }),
      ),
    [live],
  );
  return useCachedList(STORE_CACHE_KEY, rows);
}

/** The signed-in user's skill installs, cache-then-live. Empty array while
 *  signed out (callers gate the signed-out face before this matters). */
export function useInstalledSkills(): InstalledSkill[] | null {
  const { isAuthenticated } = useConvexAuth();
  const live = useQuery(
    api.skillStore.listInstalled,
    isAuthenticated ? {} : "skip",
  ) as any[] | undefined;
  const rows = useMemo(
    () =>
      live?.map(
        (row): InstalledSkill => ({
          installId: row.installId,
          name: row.name,
          description: row.description,
          author: row.author,
          verified: row.verified,
          logoUrl: row.logoUrl,
          iconSvg: row.iconSvg,
          enabled: row.enabled,
        }),
      ),
    [live],
  );
  return useCachedList(INSTALLED_CACHE_KEY, rows);
}

/** Skills the composer can @mention — enabled installs in the shared
 *  mention shape (the install id rides in `serverId`, v1's convention), so
 *  chips, the palette, and the highlighter handle both kinds without
 *  caring which is which. The composer keeps the two lists separate, so
 *  the send payload can still tell them apart. */
export function useMentionableSkills(): MentionTarget[] {
  const installed = useInstalledSkills();
  return useMemo(
    () =>
      (installed ?? [])
        .filter((skill) => skill.enabled)
        .map((skill) => ({
          serverId: skill.installId,
          name: skill.name,
          logoUrl: skill.logoUrl,
          iconSvg: skill.iconSvg,
        })),
    [installed],
  );
}
