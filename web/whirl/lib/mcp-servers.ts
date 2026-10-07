"use client";

import { useAction, useConvexAuth, useMutation, useQuery } from "@whirl/backend/react";

import { api } from "@whirl/backend/convex/_generated/api";
import type { Id } from "@whirl/backend/convex/_generated/dataModel";

/* Client bindings for hand-added MCP servers — the settings section's data
   layer. Installed store integrations live in the same table but are
   managed from /integrations; this list shows everything so the shared
   slot pool stays legible. */

/** One MCP server as the client sees it — never any secret values. */
export type McpServer = {
  id: Id<"mcpServers">;
  name: string;
  url: string;
  enabled: boolean;
  /** True for store installs — settings shows those as integrations. */
  fromStore: boolean;
  authMode: McpAuthMode;
  headers: { key: string; hasValue: boolean }[];
  /** OAuth servers only: whether a valid grant is stored. */
  oauthConnected: boolean;
  /** The credential worked once and stopped — this owes a reconnect. */
  needsReauth: boolean;
  lastConnectedAt?: number;
  lastError?: string;
  updatedAt: number;
};

export type McpAuthMode = "headers" | "oauth";

/** A header row in the add/edit form. `value` blank means "keep existing". */
export type McpHeaderInput = { key: string; value?: string };

export type TestConnectionResult = {
  ok: boolean;
  toolCount: number;
  tools: { name: string; description?: string }[];
  error?: string;
};

/** The signed-in user's MCP servers, plus all the mutators. `servers` is
 *  undefined while loading (and while signed out). */
export function useMcpServers() {
  const { isAuthenticated } = useConvexAuth();
  const servers = useQuery(
    api.mcpServers.listServers,
    isAuthenticated ? {} : "skip",
  );
  return {
    servers,
    addServer: useMutation(api.mcpServers.addServer),
    updateServer: useMutation(api.mcpServers.updateServer),
    setServerEnabled: useMutation(api.mcpServers.setServerEnabled),
    removeServer: useMutation(api.mcpServers.removeServer),
    testConnection: useAction(api.mcpServers.testConnection),
    startOAuth: useAction(api.mcpOAuthFlow.startOAuth),
    disconnectOAuth: useMutation(api.mcpOAuthFlow.disconnectOAuth),
  };
}
