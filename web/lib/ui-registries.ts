/**
 * Component registries — the code, not the website.
 *
 * The UI shelf used to be a list of links: every card either opened a site in
 * a webview or handed it to the real browser. That is a bookmarks folder with
 * extra steps. What you actually want from a component library is the source
 * of one component, and every registry below publishes exactly that as JSON —
 * it is the same endpoint `npx shadcn add` reads.
 *
 * So Slates reads it too. Pick a library, pick a component, and the real file
 * appears in the app, ready to copy, with the install command beside it.
 *
 * Every entry here was probed live before being added: the index returns a
 * list, and a named item returns files carrying `content`. Registries that
 * only answered one of those two are not in the list —
 * Kobra's items are 401, and the ones with no registry at all stay in
 * lib/ui-libraries.ts as sites to visit.
 */

export interface UiRegistry {
  id: string;
  name: string;
  /** The library's own site, for credit and for "open the real thing". */
  home: string;
  blurb: string;
  /** Absolute URL of the registry index. */
  index: string;
  /** Where one component's JSON lives. */
  item: (name: string) => string;
  /** What the index held when this entry was last verified. */
  approx: number;
}

export const UI_REGISTRIES: UiRegistry[] = [
  {
    id: "shadcn",
    name: "shadcn/ui",
    home: "https://ui.shadcn.com/",
    blurb: "The set most of the others are built on. Accessible primitives you own outright.",
    index: "https://ui.shadcn.com/r/index.json",
    // shadcn keys items by style rather than by name alone.
    item: (n) => `https://ui.shadcn.com/r/styles/new-york/${n}.json`,
    approx: 63,
  },
  {
    id: "tailark",
    name: "Tailark",
    home: "https://tailark.com/",
    blurb: "Marketing sections — heroes, pricing, footers — as whole blocks.",
    index: "https://tailark.com/r/registry.json",
    item: (n) => `https://tailark.com/r/${n}.json`,
    approx: 474,
  },
  {
    id: "aceternity",
    name: "Aceternity UI",
    home: "https://ui.aceternity.com/",
    blurb: "The animated, slightly show-off end of the shelf. Motion-heavy React.",
    index: "https://ui.aceternity.com/registry.json",
    item: (n) => `https://ui.aceternity.com/registry/${n}.json`,
    approx: 282,
  },
  {
    id: "spectrum",
    name: "Spectrum UI",
    home: "https://ui.spectrumhq.in/",
    blurb: "A broad general-purpose set, from inputs to whole dashboard pieces.",
    index: "https://ui.spectrumhq.in/r/registry.json",
    item: (n) => `https://ui.spectrumhq.in/r/${n}.json`,
    approx: 315,
  },
  {
    id: "beui",
    name: "beUI",
    home: "https://beui.dev/",
    blurb: "Motion-first React components, each one a single file.",
    index: "https://beui.dev/r/registry.json",
    item: (n) => `https://beui.dev/r/${n}.json`,
    approx: 120,
  },
  {
    id: "great-ui",
    name: "Great UI",
    home: "https://www.great-ui.com/",
    blurb: "Text and interaction effects with more personality than the defaults.",
    index: "https://www.great-ui.com/r/registry.json",
    item: (n) => `https://www.great-ui.com/r/${n}.json`,
    approx: 49,
  },
  {
    id: "kibo",
    name: "Kibo UI",
    home: "https://www.kibo-ui.com/",
    blurb: "Composable blocks on top of shadcn — tables, editors, pickers.",
    index: "https://www.kibo-ui.com/r/registry.json",
    item: (n) => `https://www.kibo-ui.com/r/${n}.json`,
    approx: 41,
  },
  {
    id: "beautiful-ui",
    name: "Beautiful UI",
    home: "https://www.beautifului.dev/",
    blurb: "A small, opinionated set with a strong house style.",
    index: "https://www.beautifului.dev/r/registry.json",
    item: (n) => `https://www.beautifului.dev/r/${n}.json`,
    approx: 27,
  },
  {
    id: "rare-ui",
    name: "Rare UI",
    home: "https://www.rareui.com/",
    blurb: "Unusual components you would otherwise build from scratch.",
    index: "https://www.rareui.com/r/registry.json",
    item: (n) => `https://www.rareui.com/r/${n}.json`,
    approx: 22,
  },
];

export function registryById(id: string): UiRegistry | undefined {
  return UI_REGISTRIES.find((r) => r.id === id);
}

/* ------------------------------------------------------------- the shapes */

/** One entry in a registry index. */
export interface RegistryEntry {
  name: string;
  title: string;
  description?: string;
  /** `registry:ui`, `registry:block`, `registry:hook`… — the kind of thing it is. */
  type?: string;
  /** Present when the index inlines the code, which some registries do. */
  files?: RegistryFile[];
}

export interface RegistryFile {
  path: string;
  content: string;
  type?: string;
}

export interface RegistryItem {
  name: string;
  title: string;
  description?: string;
  files: RegistryFile[];
  /** npm packages the component expects. */
  dependencies?: string[];
  /** Other registry components it builds on. */
  registryDependencies?: string[];
}

/* --------------------------------------------------------------- tidying */

/** Titles a registry name: `tilt-card` → `Tilt card`. */
export function titleFor(name: string, given?: unknown): string {
  if (typeof given === "string" && given.trim()) return given.trim();
  return name.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/**
 * Registries disagree about their own schema — some return `{items: []}`,
 * some a bare array, and the per-item fields drift. Everything that reaches
 * the app goes through here so the view only ever sees one shape.
 */
export function normalizeIndex(raw: unknown): RegistryEntry[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { items?: unknown })?.items)
      ? ((raw as { items: unknown[] }).items)
      : [];

  const out: RegistryEntry[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name : "";
    if (!name) continue;
    out.push({
      name,
      title: titleFor(name, r.title),
      description: typeof r.description === "string" ? r.description : undefined,
      type: typeof r.type === "string" ? r.type : undefined,
      files: normalizeFiles(r.files),
    });
  }
  return out;
}

export function normalizeFiles(raw: unknown): RegistryFile[] {
  if (!Array.isArray(raw)) return [];
  const out: RegistryFile[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const f = row as Record<string, unknown>;
    const content = typeof f.content === "string" ? f.content : "";
    if (!content) continue;
    const path = typeof f.path === "string" && f.path ? f.path : "component.tsx";
    out.push({ path, content, type: typeof f.type === "string" ? f.type : undefined });
  }
  return out;
}

export function normalizeItem(raw: unknown, fallbackName: string): RegistryItem {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const name = typeof r.name === "string" && r.name ? r.name : fallbackName;
  return {
    name,
    title: titleFor(name, r.title),
    description: typeof r.description === "string" ? r.description : undefined,
    files: normalizeFiles(r.files),
    dependencies: Array.isArray(r.dependencies)
      ? r.dependencies.filter((d): d is string => typeof d === "string")
      : undefined,
    registryDependencies: Array.isArray(r.registryDependencies)
      ? r.registryDependencies.filter((d): d is string => typeof d === "string")
      : undefined,
  };
}

/** The command that puts this component in a project for real. */
export function addCommand(registry: UiRegistry, name: string): string {
  return `npx shadcn@latest add ${registry.item(name)}`;
}

/** Best-guess language for the code pane, from the file's own extension. */
export function languageOf(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "tsx" || ext === "jsx") return "tsx";
  if (ext === "ts") return "ts";
  if (ext === "js" || ext === "mjs") return "js";
  if (ext === "css") return "css";
  if (ext === "json") return "json";
  return ext || "txt";
}
