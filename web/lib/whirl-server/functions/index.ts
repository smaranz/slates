import "server-only";

import { browserRunning } from "@/lib/agent/browser";
import { agentState, busyChats, listModels } from "@/lib/agent/engine";
import { agents, ensureDirs, groups, routines, skills, WORKSPACE } from "@/lib/agent/store";
import type { Roster } from "@/lib/agent/types";
import { studentBook, viewBook } from "@/lib/learning/memory";
import { messageQueue, messages, threads } from "./conversations";
import {
  admin,
  composerGates,
  customSkills,
  deployment,
  disabled,
  features,
  folders,
  homeSuggestions,
  modelFavorites,
  models,
  preferences,
  serverLoad,
  skillStore,
} from "./settings";
import { fail, type Args, type Fn } from "./types";
import { transcription } from "./voice";

/* The agent layer: everything around the conversations. */
const slates: Record<string, Fn> = {
  roster: async (): Promise<Roster & { busy: Record<string, string> }> => {
    ensureDirs();
    return {
      agents: agents.all().map((agent) => ({ ...agent, ...agentState(agent.id) })),
      groups: groups.all(),
      routines: routines.all(),
      skills: skills.all(),
      models: await listModels(),
      browser: { running: await browserRunning() },
      workspace: WORKSPACE,
      student: viewBook(studentBook()),
      busy: Object.fromEntries(busyChats()),
    };
  },
};

const MODULES: Record<string, Record<string, Fn>> = {
  ...disabled,
  threads,
  messages,
  messageQueue,
  folders,
  homeSuggestions,
  models,
  modelFavorites,
  composerGates,
  features,
  deployment,
  serverLoad,
  admin,
  preferences,
  skillStore,
  customSkills,
  slates,
  transcription,
};

export async function run(name: string, args: Args): Promise<unknown> {
  const [module, fn] = name.split(".");
  const handler = module && fn ? MODULES[module]?.[fn] : undefined;
  if (!handler) {
    console.warn(`[whirl] no Slates implementation for ${name}`);
    fail(`That isn't available in Slates (${name}).`);
  }
  return handler(args);
}
