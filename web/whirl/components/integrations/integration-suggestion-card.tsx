"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useUser } from "@whirl/backend/auth";
import { IconCircleCheckFilled, IconDownload } from "@tabler/icons-react";
import { motion } from "motion/react";

import type { Id } from "@whirl/backend/convex/_generated/dataModel";
import { AuthModal } from "@whirl/components/auth/auth-modal";
import { IntegrationLogo } from "@whirl/components/integration-logo";
import { Button } from "@whirl/components/ui/button";
import { IntegrationInstallModal } from "@whirl/components/integrations/install-modal";
import { VerifiedBadge } from "@whirl/components/integrations/verified-badge";
import {
  useSuggestedIntegrations,
  type StoreIntegration,
} from "@whirl/lib/integrations-data";
import type { MessagePhase } from "@whirl/lib/messages";
import { captureEvent } from "@whirl/lib/posthog";

/* Chat suggestions are a recommendation, not a transplanted store list: the
   phase provides durable ids + name snapshots, while this card hydrates
   current branding, setup requirements, and install state.

   One tile. The model searches the store, picks the listing that fits what
   was actually asked, and cards that — a shelf of four near-misses looked
   like nobody had chosen. Older messages may still carry several items, so
   the render walks the list rather than assuming a single entry. */

type IntegrationSuggestionItem = {
  integrationId: string;
  name: string;
};

export function IntegrationSuggestionCard({
  phase,
  animate,
}: {
  phase: MessagePhase;
  animate: boolean;
}) {
  const items = useMemo(
    () =>
      ((phase.items ?? []) as unknown[]).filter(
        (item): item is IntegrationSuggestionItem =>
          typeof item === "object" &&
          item !== null &&
          "integrationId" in item &&
          typeof item.integrationId === "string" &&
          "name" in item &&
          typeof item.name === "string",
      ),
    [phase.items],
  );
  const ids = useMemo(
    () => items.map((item) => item.integrationId as Id<"integrations">),
    [items],
  );
  const integrations = useSuggestedIntegrations(ids);
  const { user, isLoaded } = useUser();
  const [selectedId, setSelectedId] = useState<Id<"integrations"> | null>(
    null,
  );
  const [authOpen, setAuthOpen] = useState(false);
  const shownEventSent = useRef(false);

  useEffect(() => {
    if (shownEventSent.current || items.length === 0) return;
    shownEventSent.current = true;
    captureEvent("integration_suggestion_shown", {
      count: items.length,
      integrations: items.map((item) => item.name),
      query: phase.query,
    });
  }, [items, phase.query]);

  if (items.length === 0) return null;
  if (integrations !== undefined && integrations.length === 0) return null;

  const entries = integrations ?? placeholderEntries(items);
  const selected =
    integrations?.find((entry) => entry.id === selectedId) ?? null;
  const ready = integrations !== undefined;

  const openEntry = (entry: StoreIntegration) => {
    if (!ready) return;
    captureEvent("integration_suggestion_clicked", {
      integration: entry.name,
      installed: entry.installedConnected,
    });
    setSelectedId(entry.id);
  };

  return (
    <>
      <motion.div
        initial={animate ? { opacity: 0, y: 5 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
        className="mb-2 flex w-[26rem] max-w-full flex-col gap-2"
      >
        {entries.map((entry) => (
          <SuggestionTile
            key={entry.id}
            entry={entry}
            ready={ready}
            onOpen={() => openEntry(entry)}
          />
        ))}
      </motion.div>

      <IntegrationInstallModal
        integration={selected}
        onClose={() => setSelectedId(null)}
        onRequireAuth={
          isLoaded && !user ? () => setAuthOpen(true) : undefined
        }
      />
      <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
    </>
  );
}

function SuggestionTile({
  entry,
  ready,
  onOpen,
}: {
  entry: StoreIntegration;
  ready: boolean;
  onOpen: () => void;
}) {
  const installed = entry.installedConnected;
  const needsConnection = entry.installedServerId !== null && !installed;

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-well px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--well-outline),inset_0_1px_0_0_var(--well-highlight)] transition-colors duration-150 hover:bg-accent">
      <button
        type="button"
        disabled={!ready}
        onClick={onOpen}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left disabled:cursor-default"
      >
        <IntegrationLogo
          name={entry.name}
          logoUrl={entry.logoUrl}
          iconSvg={entry.iconSvg}
          size={38}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13.5px]/5 font-semibold tracking-tight">
              {entry.name}
            </span>
            {entry.verified && <VerifiedBadge size={13} />}
          </span>
          {ready ? (
            <span className="line-clamp-2 text-[11.5px]/4 text-muted-foreground">
              {entry.description ?? "A new set of tools for Whirl."}
            </span>
          ) : (
            <span
              aria-label="Loading integration details"
              className="mt-1 h-2.5 w-28 animate-pulse rounded-full bg-foreground/10"
            />
          )}
        </span>
      </button>

      {installed ? (
        <span className="inline-flex shrink-0 items-center gap-1 text-[12px]/4 font-medium text-emerald-600 dark:text-emerald-400">
          <IconCircleCheckFilled size={14} />
          Installed
        </span>
      ) : (
        <Button
          type="button"
          size="sm"
          disabled={!ready}
          onClick={onOpen}
          className="rounded-full px-3"
        >
          <IconDownload size={13} stroke={2.25} />
          {needsConnection ? "Connect" : "Install"}
        </Button>
      )}
    </div>
  );
}

function placeholderEntries(
  items: IntegrationSuggestionItem[],
): StoreIntegration[] {
  return items.map((item) => ({
    id: item.integrationId as Id<"integrations">,
    name: item.name,
    category: null,
    verified: false,
    logoUrl: null,
    bannerUrl: null,
    authMode: "none",
    authFields: [],
    toolCount: 0,
    composioConnect: false,
    installedServerId: null,
    installedConnected: false,
  }));
}
