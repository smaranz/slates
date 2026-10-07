"use client";

import { useMemo } from "react";

import { useInstalledIntegrations } from "./integrations-data";

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "server"
  );
}

export type IntegrationActivity = {
  iconSvg?: string;
  action?: string;
  completed?: string;
  loading: boolean;
};

const EMPTY_ACTIVITY: IntegrationActivity = { loading: false };

/** Resolve the server/tool snapshots on an MCP phase to the developer-written
 * console phrases and monochrome mark. The caller always keeps a generic
 * fallback mounted while this hydrates, then morphs to the branded state. */
export function useIntegrationActivity(
  server?: string,
  tool?: string,
): IntegrationActivity {
  const installed = useInstalledIntegrations();

  return useMemo(() => {
    if (!server) return EMPTY_ACTIVITY;
    if (installed === null) return { loading: true };

    const wanted = server.trim().toLowerCase();
    const match =
      installed.find(
        (integration) => integration.name.trim().toLowerCase() === wanted,
      ) ??
      installed.find(
        (integration) => slugify(integration.name) === slugify(server),
      );
    if (!match) return EMPTY_ACTIVITY;

    const entry = tool
      ? match.tools?.find((candidate) => candidate.name === tool)
      : undefined;
    return {
      iconSvg: match.iconSvg,
      action: entry?.description.trim() || undefined,
      completed: entry?.completed?.trim() || undefined,
      loading: false,
    };
  }, [installed, server, tool]);
}
