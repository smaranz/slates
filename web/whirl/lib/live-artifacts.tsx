"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@whirl/backend/react";
import { api } from "@whirl/backend/convex/_generated/api";
import type { Id } from "@whirl/backend/convex/_generated/dataModel";

/* Live bodies for the artifacts a message phase points at. The cards and
   the side panel read the same reactive rows, so a streaming document
   fills in everywhere at once. /debug injects canned rows through the
   fixture provider instead — the hooks never touch Convex there. */

export type LiveDocument = {
  title: string;
  content: string;
  format?: "markdown" | "code";
  fileName?: string;
  language?: string;
  status?: "streaming" | "complete";
  /** Public share token; powers {site}/doc/{shortId}. Absent only on
   * legacy rows until the panel mints one (ensureDocumentShareId). */
  shortId?: string;
};

/** A binding the artifact declared, as the card's "reads from" chrome needs it. */
export type LiveArtifactBinding = {
  id: string;
  integration: string;
  tool: string;
  label?: string;
};

export type LiveHtmlArtifact = {
  kind: "inline" | "full";
  /** Absent on every artifact written before react artifacts existed. */
  runtime?: "html" | "react";
  title: string;
  content: string;
  status: "streaming" | "pending" | "generating" | "complete" | "failed";
  error?: string;
  /** Read-only integration data this artifact pulls in. React artifacts only;
   *  any artifact carrying one is not publicly shareable. */
  bindings?: LiveArtifactBinding[];
  /** Served without its body because it reads live data and this viewer isn't
   *  its owner (a shared transcript). The card renders an explanation. */
  dataLocked?: boolean;
  /** Public share token (5 chars); powers {site}/visual/{shortId}. */
  shortId?: string;
};

/** Whether an artifact reads live integration data — which is also what makes
 *  it private, so the share and export affordances have to agree with it. */
export function readsLiveData(
  artifact: LiveHtmlArtifact | null | undefined,
): boolean {
  return (artifact?.bindings?.length ?? 0) > 0;
}

export type FixtureArtifacts = {
  documents: Record<string, LiveDocument>;
  html: Record<string, LiveHtmlArtifact>;
};

const FixtureContext = createContext<FixtureArtifacts | null>(null);

/** Canned artifact rows for /debug — inside it, the live hooks resolve
 * from these instead of querying Convex with fake ids. */
export function FixtureArtifactsProvider({
  value,
  children,
}: {
  value: FixtureArtifacts;
  children: ReactNode;
}) {
  return (
    <FixtureContext.Provider value={value}>{children}</FixtureContext.Provider>
  );
}

/** Whether artifact bodies come from canned fixtures (/debug) — mirrors a
 * share page's read-only posture: no saving edits back, no add-to-chat. */
export function useIsFixtureArtifacts(): boolean {
  return useContext(FixtureContext) !== null;
}

/** The live `documents` row: `undefined` while loading, `null` if missing. */
export function useLiveDocument(
  documentId: string | undefined,
): LiveDocument | null | undefined {
  const fixtures = useContext(FixtureContext);
  const queried = useQuery(
    api.documents.getDocument,
    !fixtures && documentId
      ? { documentId: documentId as Id<"documents"> }
      : "skip",
  );
  if (fixtures) {
    if (!documentId) return undefined;
    return fixtures.documents[documentId] ?? null;
  }
  return queried;
}

/** The live `htmlArtifacts` row: `undefined` while loading, `null` if missing. */
export function useLiveHtmlArtifact(
  htmlId: string | undefined,
): LiveHtmlArtifact | null | undefined {
  const fixtures = useContext(FixtureContext);
  const queried = useQuery(
    api.html.getHtmlArtifact,
    !fixtures && htmlId ? { htmlId: htmlId as Id<"htmlArtifacts"> } : "skip",
  );
  if (fixtures) {
    if (!htmlId) return undefined;
    return fixtures.html[htmlId] ?? null;
  }
  return queried;
}
