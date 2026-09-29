import "server-only";

import { Cursor } from "@cursor/sdk";

import { DEFAULT_MODEL, type ModelChoice } from "./types";

/** The Cursor catalog the agents pick from, cached for ten minutes. */

const PREFERRED = ["grok-4.7", "claude-opus-5-5", "claude-sonnet-5", "gpt-5.6-sol", "gemini-3.1-pro", "composer-2.5", "kimi-k3", "claude-haiku-4-5", "gpt-5.6-luna", "gemini-3.8-flash"];
/** Models Slates has moved past: hidden from the picker, and agents still set to one run on its successor. */
export const REPLACED: Record<string, string> = { "claude-opus-5": "claude-opus-5-5" };

const state = globalThis as typeof globalThis & { __slatesAgentModels?: { at: number; list: ModelChoice[] } };

export async function listModels(): Promise<ModelChoice[]> {
  const cached = state.__slatesAgentModels;
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.list;
  try {
    const raw = await Cursor.models.list();
    const list = raw
      .filter((model) => model.id !== "default" && !REPLACED[model.id])
      .map((model) => ({ id: model.id, label: model.displayName || model.id }))
      .sort((a, b) => {
        const ia = PREFERRED.indexOf(a.id);
        const ib = PREFERRED.indexOf(b.id);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
    state.__slatesAgentModels = { at: Date.now(), list };
    return list;
  } catch {
    return [{ id: DEFAULT_MODEL, label: "Grok 4.7" }];
  }
}

/** The first of `wanted` the catalog has, else the default. */
export async function pickModel(wanted: string[]): Promise<string> {
  const models = await listModels();
  return wanted.find((id) => models.some((model) => model.id === id)) ?? DEFAULT_MODEL;
}
