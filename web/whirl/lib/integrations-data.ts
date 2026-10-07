"use client";

import { useEffect, useMemo, useRef } from "react";
import { useAction, useConvexAuth, useQuery } from "@whirl/backend/react";
import { ConvexError } from "convex/values";

import { api } from "@whirl/backend/convex/_generated/api";
import type { Id } from "@whirl/backend/convex/_generated/dataModel";
import { useCachedList } from "./cached-list";

/* Client bindings for the /integrations store. Rows follow the app-wide
   cache-then-live pattern: the last visit's list paints immediately from
   localStorage, the live query replaces it (and refreshes the cache) when
   Convex answers. lib/integrations.ts stays the composer's lean mention
   feed; this file is the management surface. */

const STORE_CACHE_KEY = "integrations-store";
const INSTALLED_CACHE_KEY = "integrations-installed";

export type IntegrationAuthMode = "none" | "oauth" | "apiKey";

/** A store listing as the browse card needs it — branding, the auth recipe,
 *  and whether the caller already holds an install of it. */
export type StoreIntegration = {
  id: Id<"integrations">;
  name: string;
  description?: string;
  author?: string;
  /** The shelf the browse page groups this under; null = not yet shelved. */
  category: string | null;
  verified: boolean;
  logoUrl: string | null;
  bannerUrl: string | null;
  iconSvg?: string;
  authMode: IntegrationAuthMode;
  authFields: { key: string; label: string }[];
  authInstructions?: string;
  toolCount: number;
  /** True => adding runs Composio's hosted sign-in instead of MCP OAuth. */
  composioConnect: boolean;
  installedServerId: Id<"mcpServers"> | null;
  installedConnected: boolean;
};

/** One of the caller's installs, joined with the listing's branding. */
export type InstalledIntegration = {
  serverId: Id<"mcpServers">;
  name: string;
  description?: string;
  verified: boolean;
  logoUrl: string | null;
  iconSvg?: string;
  tools?: { name: string; description: string; completed?: string }[];
  authMode: IntegrationAuthMode;
  enabled: boolean;
  oauthConnected: boolean;
  composioConnect: boolean;
  composioConnected: boolean;
  /** The stored credential worked once and stopped — this owes a reconnect. */
  needsReauth: boolean;
  /** When it stopped, for "expired 2 days ago". */
  authExpiredAt?: number;
  lastError?: string;
};

/** Whether an install still owes a sign-in before the model can use it. */
export function needsSignIn(row: InstalledIntegration): boolean {
  return (
    (row.authMode === "oauth" && !row.oauthConnected) ||
    (row.composioConnect && !row.composioConnected)
  );
}

/**
 * Whether clicking "connect" on this row runs a sign-in flow at all.
 *
 * An expired API key can't be fixed by a popup — that one's a trip back
 * through the install form — so the button only appears where it can work.
 */
export function canReconnect(row: InstalledIntegration): boolean {
  return row.authMode === "oauth" || row.composioConnect;
}

/** Every store listing, cache-then-live. Null only before the first-ever
 *  answer (no cache yet) — the browse card's skeleton state. */
export function useIntegrationStore(): StoreIntegration[] | null {
  const live = useQuery(api.integrationStore.listStore) as any[] | undefined;
  const rows = useMemo(
    () =>
      live?.map(
        (row): StoreIntegration => ({
          id: row.id,
          name: row.name,
          description: row.description,
          author: row.author,
          category: row.category ?? null,
          verified: row.verified,
          logoUrl: row.logoUrl,
          bannerUrl: row.bannerUrl,
          iconSvg: row.iconSvg,
          authMode: row.authMode as IntegrationAuthMode,
          authFields: row.authFields,
          authInstructions: row.authInstructions,
          toolCount: row.tools.length,
          composioConnect: row.composioConnect,
          installedServerId: row.installedServerId,
          installedConnected: row.installedConnected,
        }),
      ),
    [live],
  );
  return useCachedList(STORE_CACHE_KEY, rows);
}

/** The live store entries attached to an assistant suggestion phase.
 *  Unlike the browse shelf this deliberately skips the local cache: a chat
 *  card should disappear when its listing is no longer available, and install
 *  state needs to flip as soon as the modal finishes. */
export function useSuggestedIntegrations(
  ids: Id<"integrations">[],
): StoreIntegration[] | undefined {
  return useQuery(api.integrationStore.listSuggested, { ids }) as
    | StoreIntegration[]
    | undefined;
}

/** The signed-in user's installs, cache-then-live. Empty array while signed
 *  out (callers gate the signed-out face before this matters). */
export function useInstalledIntegrations(): InstalledIntegration[] | null {
  const { isAuthenticated } = useConvexAuth();
  const live = useQuery(
    api.integrationStore.listInstalled,
    isAuthenticated ? {} : "skip",
  ) as any[] | undefined;
  const rows = useMemo(
    () =>
      live?.map(
        (row): InstalledIntegration => ({
          serverId: row.serverId,
          name: row.name,
          description: row.description,
          verified: row.verified,
          logoUrl: row.logoUrl,
          iconSvg: row.iconSvg,
          tools: row.tools ?? [],
          authMode: row.authMode as IntegrationAuthMode,
          enabled: row.enabled,
          oauthConnected: row.oauthConnected,
          composioConnect: row.composioConnect,
          composioConnected: row.composioConnected,
          needsReauth: row.needsReauth,
          authExpiredAt: row.authExpiredAt,
          lastError: row.lastError,
        }),
      ),
    [live],
  );
  return useCachedList(INSTALLED_CACHE_KEY, rows);
}

/**
 * The installs whose sign-in has expired.
 *
 * Its own hook because more than one surface has to know: the store banner,
 * the settings banner, and the red dot on the settings nav all read the same
 * list, and a dot that disagrees with the page it points at is worse than no
 * dot. Reads the cached list, so it paints with everything else.
 */
export function useExpiredIntegrations(): InstalledIntegration[] {
  const installed = useInstalledIntegrations();
  return useMemo(
    () => (installed ?? []).filter((row) => row.needsReauth),
    [installed],
  );
}

/**
 * Open a sign-in popup and point it at whatever URL `getUrl` resolves. The
 * blank popup opens synchronously (so the browser counts it as
 * user-initiated) and navigates once the URL arrives; a blocked popup falls
 * back to a full-page redirect. Both the MCP OAuth and Composio callbacks
 * post the same `mcp-oauth` message back, and the reactive queries flip
 * rows to "connected" on their own.
 */
export async function openAuthPopup(getUrl: () => Promise<string>) {
  const popup =
    typeof window !== "undefined"
      ? window.open("", "mcp-oauth", "width=520,height=720")
      : null;
  try {
    const url = await getUrl();
    if (popup && !popup.closed) {
      popup.location.href = url;
    } else {
      window.location.href = url;
    }
  } catch (error) {
    popup?.close();
    throw error;
  }
}

/** The sign-in flow for an existing install: Composio's hosted link or the
 *  MCP-spec OAuth dance, whichever the row calls for, in the shared popup. */
export function useConnectFlow() {
  const startOAuth = useAction(api.mcpOAuthFlow.startOAuth);
  const startComposio = useAction(api.integrationStore.startComposioConnect);
  return (server: { serverId: Id<"mcpServers">; composioConnect: boolean }) =>
    openAuthPopup(async () =>
      server.composioConnect
        ? (await startComposio({ id: server.serverId })).redirectUrl
        : (await startOAuth({ id: server.serverId })).authorizationUrl,
    );
}

/** Fires `onResult` when a sign-in popup reports back. The payload is
 *  untrusted window traffic, so only its shape is believed. */
export function useOAuthResult(
  onResult: (result: { ok: boolean; error?: string }) => void,
) {
  const callback = useRef(onResult);
  useEffect(() => {
    callback.current = onResult;
  }, [onResult]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (
        !data ||
        typeof data !== "object" ||
        (data as { type?: unknown }).type !== "mcp-oauth"
      )
        return;
      const payload = data as { ok?: unknown; error?: unknown };
      callback.current({
        ok: payload.ok === true,
        error:
          typeof payload.error === "string" ? payload.error : undefined,
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
}

/**
 * A human-readable message out of a failed Convex call. ConvexError data
 * comes through verbatim; plain server errors arrive wrapped in transport
 * noise ("[CONVEX A(...)] ... Uncaught Error: the actual words"), so the
 * real sentence is dug out — and anything redacted or unrecognizable falls
 * back to the caller's phrasing.
 */
export function errorText(error: unknown, fallback: string): string {
  if (error instanceof ConvexError && typeof error.data === "string") {
    return error.data;
  }
  if (error instanceof Error && error.message) {
    const raw = error.message;
    const marker = raw.lastIndexOf("Uncaught Error: ");
    const message =
      marker >= 0 ? raw.slice(marker + "Uncaught Error: ".length) : raw;
    const line = message.split("\n")[0]?.trim();
    if (line && !line.startsWith("[CONVEX") && line !== "Server Error") {
      return line;
    }
  }
  return fallback;
}
