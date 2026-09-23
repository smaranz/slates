import {
  UI_REGISTRIES,
  normalizeIndex,
  normalizeItem,
  registryById,
  type RegistryEntry,
  type RegistryFile,
  type UiRegistry,
} from "@/lib/ui-registries";

/**
 * Reads a component registry on the browser's behalf.
 *
 * Two reasons it can't be a `fetch` from the page. These sites send no CORS
 * headers — they are meant to be read by a CLI, not a browser — and the
 * registry index for a big library is several hundred KB that would be
 * re-downloaded on every visit. Going through the server fixes the first and
 * lets the platform cache handle the second.
 *
 * The registry is named by id, never by URL. A route that fetched whatever URL
 * it was handed would be an open proxy sitting on the student's machine,
 * reachable by any page that can reach the portal — including, on the desktop
 * build, one embedded in the app.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Registries are versioned by their authors, not by us; an hour is plenty. */
const CACHE = "public, max-age=3600, stale-while-revalidate=86400";

/** A ceiling on how far one component's dependencies may be chased. */
const MAX_FETCHES = 14;

/** Registry item names: what the index publishes, and nothing path-shaped. */
const NAME = /^[a-z0-9][a-z0-9-_.]{0,80}$/i;

class UpstreamError extends Error {
  status: number;
  constructor(status: number, host: string) {
    super(`${status} from ${host}`);
    this.status = status;
  }
}

async function read(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Slates", Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
    // Next's own fetch cache, so a second student opening the same library
    // doesn't hit the author's server again.
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new UpstreamError(res.status, new URL(url).hostname);
  return res.json();
}

/**
 * One component, however the registry chooses to publish it.
 *
 * Most serve the source at the item endpoint. Some — Kibo among them — inline
 * it in the index and return a thinner item, so an item that arrives with no
 * files is worth a second look before it's reported as empty.
 */
async function readItem(registry: UiRegistry, name: string) {
  const fetched = normalizeItem(await read(registry.item(name)), name);
  if (fetched.files.length) return fetched;

  const entries = normalizeIndex(await read(registry.index));
  const inIndex: RegistryEntry | undefined = entries.find(
    (e) => e.name === name,
  );
  return inIndex?.files?.length
    ? { ...fetched, files: inIndex.files }
    : fetched;
}

/* ── the shelf ─────────────────────────────────────────────────────────── */

/**
 * Every registry at once.
 *
 * Fetched in parallel and merged, with one registry's outage costing only its
 * own rows — a shelf that refuses to open because one author's site is down
 * would be worse than a shelf missing a shelf.
 */
async function everything(): Promise<Response> {
  const results = await Promise.allSettled(
    UI_REGISTRIES.map(async (r) => ({
      registry: r,
      entries: normalizeIndex(await read(r.index)),
    })),
  );

  const entries: (RegistryEntry & {
    registry: string;
    registryName: string;
  })[] = [];
  const missing: string[] = [];

  results.forEach((result, i) => {
    if (result.status !== "fulfilled") {
      missing.push(UI_REGISTRIES[i].name);
      return;
    }
    /*
     * Some indexes list a name twice — a component and its example share one —
     * and two rows with the same identity is both a duplicate on screen and a
     * duplicate React key.
     */
    const seen = new Set<string>();
    for (const entry of result.value.entries) {
      if (seen.has(entry.name)) continue;
      seen.add(entry.name);
      entries.push({
        ...entry,
        registry: result.value.registry.id,
        registryName: result.value.registry.name,
      });
    }
  });

  return Response.json(
    { registry: "all", entries, missing },
    { headers: { "Cache-Control": CACHE } },
  );
}

/* ── one component, with everything it needs to run ────────────────────── */

/** Every module specifier a file imports. */
function importsOf(source: string): string[] {
  const specs: string[] = [];
  const from =
    /(?:^|[\s;}])(?:import|export)[\s\S]{0,400}?from\s*["']([^"']+)["']/g;
  const bare = /(?:^|[\s;])import\s*["']([^"']+)["']/g;
  for (const m of source.matchAll(from)) specs.push(m[1]);
  for (const m of source.matchAll(bare)) specs.push(m[1]);
  return specs;
}

/** Whether a set of published paths already satisfies an import. */
function satisfied(spec: string, paths: Iterable<string>): boolean {
  const wanted = spec
    .replace(/^@\//, "")
    .replace(/^[./]+/, "")
    .replace(/\.(tsx?|jsx?)$/, "");
  const tail = wanted.split("/").pop() ?? "";
  for (const p of paths) {
    const bare = p.replace(/\.(tsx?|jsx?|css)$/, "");
    if (
      bare === wanted ||
      bare.endsWith(`/${wanted}`) ||
      bare.endsWith(`/${tail}`)
    )
      return true;
  }
  return false;
}

/**
 * Collects a component and the parts it is built from.
 *
 * A registry publishes one component per request, but components import each
 * other — a dialog is built on a button, an accordion ships its item and
 * trigger separately — and the preview can only render what it has the source
 * for. So imports pointing inside the project (`@/components/ui/button`) are
 * read as the names of other registry items and fetched too, breadth-first,
 * until nothing is missing or the ceiling is hit.
 *
 * Failures here are deliberately quiet. A name guessed from an import path
 * doesn't always exist as a published item — a library's own private helper,
 * or one whose file is named differently from its item — and a missing part
 * costs a placeholder in the preview, not the whole render.
 */
async function bundleFor(registry: UiRegistry, root: string) {
  const files = new Map<string, RegistryFile>();
  const tried = new Set<string>([root]);
  let fetches = 0;

  /*
   * Nearly every library here is built on top of shadcn: Kibo's announcement
   * imports `@/components/ui/badge`, its snippet imports `@/components/ui/tabs`,
   * and neither publishes those files because they assume you already ran the
   * shadcn CLI. So a name the component's own registry doesn't have is looked
   * for in shadcn before giving up — which is the same place the library's own
   * install instructions would have sent you.
   */
  const shadcn = registryById("shadcn");
  const fetchAny = async (name: string) => {
    const own = await readItem(registry, name).catch(() => null);
    if (own?.files.length) return own;
    if (!shadcn || registry.id === shadcn.id) return null;
    return readItem(shadcn, name).catch(() => null);
  };

  const add = (list: RegistryFile[]) => {
    // First writer wins: the component's own file outranks a copy that arrives
    // later as somebody else's dependency.
    for (const f of list) if (!files.has(f.path)) files.set(f.path, f);
  };

  const rootItem = await readItem(registry, root);
  fetches++;
  add(rootItem.files);

  /*
   * Registries publish demos beside components — `button-demo` next to
   * `button` — and a demo is written to be rendered with no props, which is
   * exactly the situation the preview is in. When one exists it makes a far
   * better preview than the bare component, whose own default is often an
   * empty shell.
   */
  let entry = rootItem.files[0]?.path ?? "";
  for (const suffix of ["-demo", "-example"]) {
    tried.add(`${root}${suffix}`);
    const demo = await readItem(registry, `${root}${suffix}`).catch(() => null);
    fetches++;
    if (demo?.files.length) {
      add(demo.files);
      entry = demo.files[0].path;
      break;
    }
  }

  // Breadth-first over what the collected files still import.
  let frontier = [...files.values()];
  while (frontier.length && fetches < MAX_FETCHES) {
    const wanted = new Set<string>();

    for (const file of frontier) {
      const specs = [
        ...importsOf(file.content).filter(
          (s) => s.startsWith("@/") || s.startsWith("."),
        ),
        ...(rootItem.registryDependencies ?? []).filter((d) => NAME.test(d)),
      ];
      for (const spec of specs) {
        if (satisfied(spec, files.keys())) continue;
        const name = (spec.split("/").pop() ?? "").replace(
          /\.(tsx?|jsx?)$/,
          "",
        );
        // `utils` is shadcn's own helper, which the preview shims; chasing it
        // as a component wastes a fetch on every single bundle.
        if (
          !name ||
          name === "utils" ||
          name === "cn" ||
          tried.has(name) ||
          !NAME.test(name)
        )
          continue;
        wanted.add(name);
      }
    }

    if (!wanted.size) break;
    const batch = [...wanted].slice(0, MAX_FETCHES - fetches);
    for (const n of batch) tried.add(n);

    const got = await Promise.all(batch.map((n) => fetchAny(n)));
    fetches += batch.length;

    frontier = [];
    for (const item of got) {
      if (!item?.files.length) continue;
      const fresh = item.files.filter((f) => !files.has(f.path));
      add(item.files);
      frontier.push(...fresh);
    }
  }

  return { item: rootItem, bundle: { files: [...files.values()], entry } };
}

/* ── routing ───────────────────────────────────────────────────────────── */

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const id = params.get("registry") ?? "";

  /*
   * One shelf, not nine. The rail that made you pick a library first was
   * asking the wrong question — you want a tooltip, not a vendor — so the
   * default is every registry merged, each entry carrying where it came from.
   */
  if (id === "all") return everything();

  const registry = registryById(id);
  if (!registry) {
    return Response.json({ error: "Unknown registry." }, { status: 400 });
  }

  const item = params.get("item");

  try {
    if (!item) {
      const entries = normalizeIndex(await read(registry.index));
      return Response.json(
        { registry: registry.id, entries },
        { headers: { "Cache-Control": CACHE } },
      );
    }

    /*
     * A name from the index only — never a path. Without this a crafted
     * `item` could walk the registry's host into somewhere else entirely.
     */
    if (!NAME.test(item)) {
      return Response.json({ error: "Bad component name." }, { status: 400 });
    }

    const { item: fetched, bundle } = await bundleFor(registry, item);

    return Response.json(
      { registry: registry.id, item: fetched, bundle },
      { headers: { "Cache-Control": CACHE } },
    );
  } catch (err) {
    /*
     * Some libraries publish their index in full but put part of the catalogue
     * behind an account — Aceternity and Tailark both do. That is a fact about
     * the component, not a failure of ours, and saying so plainly beats
     * showing a student a network error for something that is simply not free.
     */
    if (err instanceof UpstreamError && [401, 402, 403].includes(err.status)) {
      return Response.json(
        {
          error: `${registry.name} keeps this one behind an account.`,
          gated: true,
          home: registry.home,
        },
        { status: 200, headers: { "Cache-Control": CACHE } },
      );
    }

    return Response.json(
      {
        error:
          err instanceof Error
            ? `Couldn't read ${registry.name}: ${err.message}`
            : `Couldn't read ${registry.name}.`,
      },
      { status: 502 },
    );
  }
}
