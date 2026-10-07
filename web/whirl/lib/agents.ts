"use client";

import { useSyncExternalStore } from "react";

import type { Roster, RosterAgent } from "@/lib/agent/types";
import { api } from "@whirl/backend/convex/_generated/api";
import { useQuery } from "@whirl/backend/react";

/* The agent layer, client side: the roster (agents, groups, routines,
   skills, models), the calls that change it, and which agent or group a
   brand-new chat goes to. Changes go through Slates' existing /api/agent
   endpoint; the roster refetches when the agent hub says it changed. */

export type RosterView = Roster & { busy: Record<string, "working" | "queued"> };

export function useRoster(): RosterView | undefined {
  return useQuery(api.slates.roster) as RosterView | undefined;
}

export async function agentApi<T = Record<string, unknown>>(op: string, body: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch("/api/agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ op, ...body }),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok || data.error) throw new Error(data.error ?? `That didn't work (${response.status}).`);
  return data;
}

export function agentStateLabel(agent: Pick<RosterAgent, "state" | "queued">): string | null {
  if (agent.state === "working") return agent.queued ? `Working · ${agent.queued} queued` : "Working";
  if (agent.state === "queued") return `${agent.queued} queued`;
  return null;
}

/* ── who a new chat is with ────────────────────────────────────────────── */

export type ChatTarget = { kind: "agent" | "group"; id: string };

const TARGET_KEY = "slates.agent.newChatTarget";
const targetListeners = new Set<() => void>();
let targetCache: { raw: string | null; value: ChatTarget | null } = { raw: null, value: null };

function readTarget(): ChatTarget | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(TARGET_KEY);
  } catch {
    return null;
  }
  if (raw === targetCache.raw) return targetCache.value;
  let value: ChatTarget | null = null;
  try {
    const parsed = raw ? (JSON.parse(raw) as Partial<ChatTarget>) : null;
    if (parsed && (parsed.kind === "agent" || parsed.kind === "group") && typeof parsed.id === "string") {
      value = { kind: parsed.kind, id: parsed.id };
    }
  } catch {
    /* a corrupt pick just means the default agent */
  }
  targetCache = { raw, value };
  return value;
}

export function setNewChatTarget(target: ChatTarget) {
  try {
    window.localStorage.setItem(TARGET_KEY, JSON.stringify(target));
  } catch {
    /* lasts until reload */
  }
  for (const listener of targetListeners) listener();
}

/** The picked target, read outside React (the send path). */
export function currentNewChatTarget(): ChatTarget | null {
  return typeof window === "undefined" ? null : readTarget();
}

export function useNewChatTarget(): ChatTarget | null {
  return useSyncExternalStore(
    (fn) => {
      targetListeners.add(fn);
      window.addEventListener("storage", fn);
      return () => {
        targetListeners.delete(fn);
        window.removeEventListener("storage", fn);
      };
    },
    readTarget,
    () => null,
  );
}

/** The picked target if it still exists, else the first agent. */
export function resolveTarget(roster: RosterView | undefined, picked: ChatTarget | null): ChatTarget | null {
  if (!roster) return picked;
  if (picked?.kind === "agent" && roster.agents.some((a) => a.id === picked.id)) return picked;
  if (picked?.kind === "group" && roster.groups.some((g) => g.id === picked.id)) return picked;
  const first = roster.agents[0];
  return first ? { kind: "agent", id: first.id } : null;
}
