/* The shapes Slates' server sends for Whirl's core queries — shared by the
   server (lib/whirl-server) and the ported components, which otherwise
   would read them off Convex's codegen. */

import type { Doc, Id } from "./convex/_generated/dataModel";

export type ThreadTargetRef = {
  kind: "agent" | "group";
  id: string;
  name: string;
  hue: number | null;
};

type ThreadDoc = Doc<"threads">;

/** threads.listForCurrentUser's row — Whirl's formatThread, plus the agent layer. */
export type ThreadSummary = {
  id: Id<"threads">;
  title: string;
  titleStatus: NonNullable<ThreadDoc["titleStatus"]>;
  createdAt: number;
  updatedAt: number;
  pinnedAt: number | null;
  model: string | null;
  compactionStatus: "idle" | "compacting" | "error";
  compactionBoundary: Id<"messages"> | null;
  compactionUpdatedAt: number | null;
  compactionMarkers: NonNullable<ThreadDoc["compactionMarkers"]>;
  shareId: string | null;
  locked: boolean;
  lockedTitle: string | null;
  folderId: Id<"folders"> | null;
  branchedFromThreadId: Id<"threads"> | null;
  /** The agent layer: who this conversation is with. */
  target: ThreadTargetRef | null;
  /** An agent's or group's own chat (routines and handoffs land there). */
  inbox: boolean;
};
