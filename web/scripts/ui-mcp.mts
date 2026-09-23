#!/usr/bin/env -S npx tsx
/**
 * The UI shelf, as a local MCP server.
 *
 * The UI app reads nine component registries and shows the source of any
 * component in them. An agent writing code wants exactly the same thing — the
 * file, its npm dependencies, and the command that installs it — without
 * opening Slates to copy it across. So this serves the same registries over
 * stdio, straight from lib/ui-registries.ts, with no dev server in between.
 *
 *   claude mcp add slates-ui -- npx tsx /abs/path/web/scripts/ui-mcp.mts
 *
 * Like the API route, a registry is only ever named by id and a component
 * only by an index-shaped name, so this can't be steered into fetching an
 * arbitrary URL.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  UI_REGISTRIES,
  addCommand,
  languageOf,
  normalizeIndex,
  normalizeItem,
  registryById,
  type RegistryEntry,
  type RegistryItem,
  type UiRegistry,
} from "../lib/ui-registries";

/** Registry item names: what the index publishes, and nothing path-shaped. */
const NAME = /^[a-z0-9][a-z0-9-_.]{0,80}$/i;

/** Registries are versioned by their authors, not by us; an hour is plenty. */
const TTL = 60 * 60 * 1000;

class UpstreamError extends Error {
  status: number;
  constructor(status: number, host: string) {
    super(`${status} from ${host}`);
    this.status = status;
  }
}

const cache = new Map<string, { at: number; body: Promise<unknown> }>();

/** One GET, remembered for the life of the process so a search is cheap. */
function read(url: string): Promise<unknown> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL) return hit.body;

  const body = (async () => {
    const res = await fetch(url, {
      headers: { "User-Agent": "Slates", Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new UpstreamError(res.status, new URL(url).hostname);
    return res.json();
  })();
  // A failure shouldn't be remembered for an hour.
  body.catch(() => cache.delete(url));
  cache.set(url, { at: Date.now(), body });
  return body;
}

async function indexOf(registry: UiRegistry): Promise<RegistryEntry[]> {
  return normalizeIndex(await read(registry.index));
}

/** Same fallback as the route: some registries inline source in the index. */
async function readItem(registry: UiRegistry, name: string): Promise<RegistryItem> {
  const fetched = normalizeItem(await read(registry.item(name)), name);
  if (fetched.files.length) return fetched;
  const inIndex = (await indexOf(registry)).find((e) => e.name === name);
  return inIndex?.files?.length ? { ...fetched, files: inIndex.files } : fetched;
}

function lookup(id: string): UiRegistry {
  const registry = registryById(id);
  if (!registry) {
    throw new Error(
      `Unknown registry "${id}". Known: ${UI_REGISTRIES.map((r) => r.id).join(", ")}.`,
    );
  }
  return registry;
}

function text(body: string) {
  return { content: [{ type: "text" as const, text: body }] };
}

function failure(err: unknown, registry?: UiRegistry) {
  if (registry && err instanceof UpstreamError && [401, 402, 403].includes(err.status)) {
    return {
      ...text(`${registry.name} keeps this one behind an account. See ${registry.home}`),
      isError: true,
    };
  }
  return { ...text(err instanceof Error ? err.message : String(err)), isError: true };
}

/* ── the server ────────────────────────────────────────────────────────── */

const server = new McpServer({ name: "slates-ui", version: "0.1.0" });

server.registerTool(
  "list_registries",
  {
    description:
      "List the React/Tailwind component registries on the Slates UI shelf (shadcn/ui, Aceternity, Kibo, Tailark…), with ids to pass to the other tools.",
    annotations: { readOnlyHint: true },
  },
  async () =>
    text(
      UI_REGISTRIES.map(
        (r) => `- ${r.id} — ${r.name} (~${r.approx} items) — ${r.blurb} ${r.home}`,
      ).join("\n"),
    ),
);

server.registerTool(
  "search_components",
  {
    description:
      "Search components across every registry (or one) by name, title, or description. Returns registry id, component name, kind, and the shadcn install command. Use get_component to read the source.",
    inputSchema: {
      query: z.string().optional().describe("Words to match, e.g. 'tooltip' or 'pricing'. Omit to list everything."),
      registry: z.string().optional().describe("Limit to one registry id from list_registries."),
      type: z
        .string()
        .optional()
        .describe("Limit to a registry kind, e.g. 'ui', 'block', 'hook' (matches registry:<type>)."),
      limit: z.number().int().min(1).max(500).optional().describe("Maximum rows (default 40)."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ query, registry, type, limit = 40 }) => {
    try {
      const pool = registry ? [lookup(registry)] : UI_REGISTRIES;
      // One registry being down costs only its own rows.
      const results = await Promise.allSettled(
        pool.map(async (r) => ({ r, entries: await indexOf(r) })),
      );

      const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const kind = type ? `registry:${type.replace(/^registry:/, "")}` : null;
      const rows: string[] = [];
      const missing: string[] = [];
      let total = 0;

      results.forEach((res, i) => {
        if (res.status !== "fulfilled") {
          missing.push(pool[i].name);
          return;
        }
        const seen = new Set<string>();
        for (const e of res.value.entries) {
          if (seen.has(e.name)) continue;
          seen.add(e.name);
          if (kind && e.type !== kind) continue;
          const hay = `${e.name} ${e.title} ${e.description ?? ""} ${res.value.r.name}`.toLowerCase();
          if (!words.every((w) => hay.includes(w))) continue;
          total++;
          if (rows.length >= limit) continue;
          rows.push(
            `- ${res.value.r.id}/${e.name} [${(e.type ?? "registry:ui").replace("registry:", "")}] ${e.title}` +
              (e.description ? ` — ${e.description}` : ""),
          );
        }
      });

      let out = rows.length ? rows.join("\n") : "No components matched.";
      if (total > rows.length) out += `\n\n…${total - rows.length} more; narrow the query or raise limit.`;
      if (missing.length) out += `\n\nCouldn't reach: ${missing.join(", ")}.`;
      out += `\n\nInstall any of these with: npx shadcn@latest add <registry item URL> (get_component gives the exact command).`;
      return text(out);
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "get_component",
  {
    description:
      "Read one component's full source from a registry, with its npm dependencies, the registry components it builds on, and the exact `npx shadcn add` command to install it.",
    inputSchema: {
      registry: z.string().describe("Registry id from list_registries, e.g. 'shadcn'."),
      name: z.string().describe("Component name as listed by search_components, e.g. 'button'."),
      include_demo: z
        .boolean()
        .optional()
        .describe("Also fetch the registry's <name>-demo / <name>-example usage file when one exists (default true)."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ registry: id, name, include_demo = true }) => {
    let registry: UiRegistry | undefined;
    try {
      registry = lookup(id);
      if (!NAME.test(name)) throw new Error("Bad component name.");

      const item = await readItem(registry, name);
      if (!item.files.length) {
        return failure(new Error(`${registry.name} published no source for "${name}".`));
      }

      let demo: RegistryItem | null = null;
      if (include_demo) {
        for (const suffix of ["-demo", "-example"]) {
          demo = await readItem(registry, `${name}${suffix}`).catch(() => null);
          if (demo?.files.length) break;
          demo = null;
        }
      }

      const parts = [
        `# ${item.title} (${registry.name})`,
        item.description ?? "",
        `Install: \`${addCommand(registry, name)}\``,
        item.dependencies?.length ? `npm dependencies: ${item.dependencies.join(", ")}` : "",
        item.registryDependencies?.length
          ? `Builds on registry components: ${item.registryDependencies.join(", ")}`
          : "",
        ...item.files.map(
          (f) => `## ${f.path}\n\n\`\`\`${languageOf(f.path)}\n${f.content}\n\`\`\``,
        ),
        ...(demo?.files ?? []).map(
          (f) => `## Usage example: ${f.path}\n\n\`\`\`${languageOf(f.path)}\n${f.content}\n\`\`\``,
        ),
      ];
      return text(parts.filter(Boolean).join("\n\n"));
    } catch (err) {
      return failure(err, registry);
    }
  },
);

server.registerTool(
  "install_command",
  {
    description:
      "Build the `npx shadcn@latest add` command that installs one or more components from a registry into the current project.",
    inputSchema: {
      registry: z.string().describe("Registry id from list_registries."),
      names: z.array(z.string()).min(1).describe("Component names to install."),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ registry: id, names }) => {
    try {
      const registry = lookup(id);
      const bad = names.filter((n) => !NAME.test(n));
      if (bad.length) throw new Error(`Bad component name: ${bad.join(", ")}.`);
      return text(`npx shadcn@latest add ${names.map((n) => registry.item(n)).join(" ")}`);
    } catch (err) {
      return failure(err);
    }
  },
);

await server.connect(new StdioServerTransport());
