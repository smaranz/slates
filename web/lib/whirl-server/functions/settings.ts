import "server-only";

import { listModels } from "@/lib/agent/engine";
import { publish } from "@/lib/agent/hub";
import { newId, skills } from "@/lib/agent/store";
import { touch } from "../bus";
import { newKey, readState, writeState, type Folder, type Starter } from "../state";
import { fail, type Fn } from "./types";

/* ── models: the Cursor catalog the agents already run on ─────────────── */

const COMPANY: [RegExp, string][] = [
  [/^claude/i, "Anthropic"],
  [/^(gpt|o\d)/i, "OpenAI"],
  [/^gemini/i, "Google"],
  [/^grok/i, "xAI"],
  [/^composer/i, "Cursor"],
  [/^kimi/i, "Moonshot"],
  [/^deepseek/i, "DeepSeek"],
];

function companyOf(id: string): string {
  return COMPANY.find(([re]) => re.test(id))?.[1] ?? "Cursor";
}

export const models: Record<string, Fn> = {
  /* Whirl's "admin catalog": every model the host's Cursor sign-in can run.
     Keys carry a "cursor/" prefix, which Whirl treats as a catalog slug and
     sends through as-is. */
  listEnabled: async () => {
    const list = await listModels();
    return list.map((model, index) => ({
      slug: `cursor/${model.id}`,
      displayName: model.label,
      company: companyOf(model.id),
      modelName: model.id,
      capabilities: { vision: true, files: true, audio: false, reasoning: true, tools: true, imageOutput: false, contextLength: 200_000 },
      // The catalog comes back best-first; keep that order on screen.
      createdAt: list.length - index,
    }));
  },
  tierAccess: () => ({ restrictedTiers: [] }),
};

export const modelFavorites: Record<string, Fn> = {
  get: () => readState().favorites,
  save: ({ keys }) => {
    writeState((s) => ({ ...s, favorites: Array.isArray(keys) ? keys.map(String).slice(0, 50) : [] }));
    touch("modelFavorites");
    return null;
  },
};

export const composerGates: Record<string, Fn> = {
  get: () => readState().gates,
  save: ({ search, thinking }) => {
    writeState((s) => ({ ...s, gates: { search: search === true, thinking: String(thinking ?? "none") } }));
    touch("composerGates");
    return null;
  },
};

/* ── what this deployment offers ───────────────────────────────────────── */

export const features: Record<string, Fn> = {
  // No billing (everything unlocked), no Exa search, no Supermemory.
  get: () => ({ billing: false, search: false, memory: false }),
};

export const deployment: Record<string, Fn> = { current: () => null };
export const serverLoad: Record<string, Fn> = { getServerLoad: () => ({ level: 0, cap: null, updatedAt: null }) };
export const admin: Record<string, Fn> = {
  getPendingResetNotice: () => null,
  getActiveMultiplier: () => null,
  acknowledgeResetNotice: () => null,
};

/* ── "how should agents talk to me" ───────────────────────────────────── */

export const preferences: Record<string, Fn> = {
  getPreferences: () => readState().preferences,
  setPreferences: ({ text }) => {
    const value = String(text ?? "").slice(0, 4000);
    writeState((s) => ({ ...s, preferences: value.trim() ? { text: value, updatedAt: Date.now() } : null }));
    touch("preferences");
    return null;
  },
};

/* ── sidebar folders ───────────────────────────────────────────────────── */

export const folders: Record<string, Fn> = {
  listForCurrentUser: () =>
    [...readState().folders].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt),

  createFolder: ({ name }) => {
    const label = String(name ?? "").trim().slice(0, 60);
    if (!label) fail("A folder needs a name.");
    const now = Date.now();
    const folder: Folder = { id: newKey("fld"), name: label, order: readState().folders.length, createdAt: now, updatedAt: now };
    writeState((s) => ({ ...s, folders: [...s.folders, folder] }));
    touch("folders");
    return folder.id;
  },

  renameFolder: ({ folderId, name }) => {
    const label = String(name ?? "").trim().slice(0, 60);
    if (!label) fail("A folder needs a name.");
    writeState((s) => ({ ...s, folders: s.folders.map((f) => (f.id === folderId ? { ...f, name: label, updatedAt: Date.now() } : f)) }));
    touch("folders");
    return null;
  },

  deleteFolder: ({ folderId }) => {
    writeState((s) => ({ ...s, folders: s.folders.filter((f) => f.id !== folderId) }));
    touch("folders", "threads");
    return null;
  },
};

/* ── skills: Slates' saved skills, shown where Whirl shows installed ones ─ */

export const skillStore: Record<string, Fn> = {
  listInstalled: () =>
    [...skills.all()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((skill) => ({
        installId: skill.id,
        name: skill.name,
        description: skill.description,
        author: skill.by ?? "You",
        verified: false,
        logoUrl: null,
        iconSvg: undefined,
        enabled: true,
        installedAt: skill.updatedAt,
      })),
  listStore: () => [],
  install: () => fail("Skills are written by you and your agents in Slates — add one under Settings › Skills."),
  uninstall: ({ installId }) => {
    skills.save(skills.all().filter((s) => s.id !== installId));
    publish({ kind: "roster" });
    return null;
  },
  setInstallEnabled: () => null,
};

export const customSkills: Record<string, Fn> = {
  listSkills: () =>
    [...skills.all()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description ?? "",
        instructions: skill.instructions,
        enabled: true,
        createdAt: skill.updatedAt,
        updatedAt: skill.updatedAt,
      })),
  addSkill: ({ name, description, instructions }) => {
    const label = String(name ?? "").trim().slice(0, 60);
    const body = String(instructions ?? "").trim().slice(0, 20_000);
    if (!label || !body) fail("A skill needs a name and instructions.");
    skills.save([...skills.all(), { id: newId("skl"), name: label, description: String(description ?? "").trim().slice(0, 200) || undefined, instructions: body, updatedAt: Date.now(), by: "You", uses: 0 }]);
    publish({ kind: "roster" });
    return null;
  },
  updateSkill: ({ id, name, description, instructions }) => {
    const all = skills.all();
    const skill = all.find((s) => s.id === id);
    if (!skill) fail("That skill doesn't exist anymore.");
    if (typeof name === "string" && name.trim()) skill.name = name.trim().slice(0, 60);
    if (typeof description === "string") skill.description = description.trim().slice(0, 200) || undefined;
    if (typeof instructions === "string" && instructions.trim()) skill.instructions = instructions.trim().slice(0, 20_000);
    skill.updatedAt = Date.now();
    skill.by = "You";
    skills.save(all);
    publish({ kind: "roster" });
    return null;
  },
  removeSkill: ({ id }) => {
    skills.save(skills.all().filter((s) => s.id !== id));
    publish({ kind: "roster" });
    return null;
  },
  setSkillEnabled: () => null,
};

/* ── home starters: things worth asking an agent that lives on your PC ── */

const STARTERS: Starter[] = [
  { prompt: "What's due this week on Schoology? Give me a plan", icon: "calendar" },
  { prompt: "Make a study guide for my next test", icon: "bulb" },
  { prompt: "Research a topic and save a cited report to my workspace", icon: "book" },
  { prompt: "Draft a message to my teacher asking about an extension", icon: "mail" },
  { prompt: "Set up a morning briefing routine for me", icon: "sparkles" },
  { prompt: "Look something up on the web and sum it up", icon: "world" },
  { prompt: "Tidy up the files in my workspace", icon: "tool" },
  { prompt: "Chart how my grades have moved this semester", icon: "chart" },
  { prompt: "Write a small script that automates something on my PC", icon: "code" },
];

function starters() {
  const saved = readState().starters;
  if (saved && saved.visible.length === 2) return saved;
  // A different pair each day until one is dismissed.
  const day = Math.floor(Date.now() / 86_400_000);
  const pool = STARTERS.map((s, i) => ({ s, k: (i * 7 + day) % STARTERS.length })).sort((a, b) => a.k - b.k).map((x) => x.s);
  return { visible: pool.slice(0, 2), reserve: pool.slice(2) };
}

export const homeSuggestions: Record<string, Fn> = {
  get: () => ({ ...starters(), pendingSlot: null }),
  dismiss: ({ slot }) => {
    const current = starters();
    const index = Number(slot);
    const gone = current.visible[index];
    const [next, ...rest] = current.reserve;
    if (!gone || !next) return null;
    const visible = current.visible.map((s, i) => (i === index ? next : s));
    writeState((s) => ({ ...s, starters: { visible, reserve: [...rest, gone] } }));
    touch("homeSuggestions");
    return null;
  },
  replenish: () => null,
};

/* ── off in Slates: Whirl features with no equivalent on a single host ── */

const off = (value: unknown = null): Fn => () => value;

export const disabled: Record<string, Record<string, Fn>> = {
  memory: { getMemorySettings: off({ enabled: false }), setMemoryEnabled: off() },
  memoryIndex: { getStatus: off(null), start: off() },
  userMemory: {
    listMemories: off([]),
    listSources: off([]),
    addMemory: off(),
    editMemory: off(),
    forgetMemory: off(),
    forgetEverything: off(),
    deleteSource: off(),
  },
  userContext: { setUnitsSystem: off(), reportPreciseLocation: off() },
  mcpServers: { listServers: off([]), addServer: off(), updateServer: off(), removeServer: off(), setServerEnabled: off(), testConnection: off({ ok: false }) },
  mcpOAuthFlow: { startOAuth: off(), disconnectOAuth: off() },
  integrationStore: { listInstalled: off([]), listStore: off([]), listSuggested: off([]), install: off(), startComposioConnect: off() },
  documents: { getDocument: off(null), updateDocumentContent: off(), ensureDocumentShareId: off(null) },
  html: { getHtmlArtifact: off(null) },
  artifactData: { runBinding: off(null), runChartBinding: off(null) },
  historySearch: { deepSearch: off([]) },
  compaction: { compactThread: off() },
  attachmentMarkdown: { convert: off({ markdown: "", skippedReason: "Document conversion isn't available; the file is sent as-is." }) },
  zeroRetention: { lockedModels: off({ known: true, slugs: [] }) },
  lockedThreads: {},
  slots: { imageAccess: off(null) },
};
