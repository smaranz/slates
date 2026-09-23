import "server-only";

import {
  accountKey,
  accountMeta,
  adoptHomeMeta,
  claudeScale,
  allHomes,
  defaultOwnerAt,
  identityOf,
  noteDefaultOwners,
  runCommand,
  timeline,
  type Home,
  type Identity,
} from "./accounts";
import { buildCapacity, type CapacitySnapshot } from "./capacity";
import { limitsFor } from "./limits";
import { priceOf, pricingSource, refreshPricesSoon } from "./pricing";
import { scanAll } from "./scan";
import {
  LINKABLE_TOOLS,
  TOOL_LABEL,
  TOOL_ORDER,
  tokensOf,
  type AccountLimits,
  type AccountRow,
  type CodingDay,
  type CodingModelRow,
  type CodingProjectRow,
  type CodingRange,
  type CodingRequest,
  type CodingRequestPage,
  type CodingSnapshot,
  type CodingTool,
  type HomeTool,
  type ToolRow,
} from "./types";

const DAY = 24 * 60 * 60 * 1000;

export function rangeStart(range: CodingRange, now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (range === "today") return d.getTime();
  if (range === "month") {
    d.setDate(1);
    return d.getTime();
  }
  if (range === "7d") return d.getTime() - 6 * DAY;
  if (range === "30d") return d.getTime() - 29 * DAY;
  return 0;
}

function dayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function hourKey(at: number): string {
  return `${dayKey(at)}T${String(new Date(at).getHours()).padStart(2, "0")}`;
}

interface Ctx {
  homes: Home[];
  identities: Map<string, Identity | null>;
  keyOfHome: Map<string, string>;
}

function context(): Ctx {
  noteDefaultOwners();
  const homes = allHomes();
  const identities = new Map<string, Identity | null>();
  const keyOfHome = new Map<string, string>();
  for (const h of homes) {
    const id = identityOf(h);
    identities.set(h.id, id);
    keyOfHome.set(h.id, id ? accountKey(h.tool, id.email) : `home:${h.id}`);
    if (id && h.owned) adoptHomeMeta(h.id, accountKey(h.tool, id.email));
  }
  return { homes, identities, keyOfHome };
}

/** Every request, priced and attributed, newest first. */
async function allRequests(ctx: Ctx, force = false): Promise<{ reqs: CodingRequest[]; files: number; ms: number; limits: Awaited<ReturnType<typeof scanAll>>["limits"] }> {
  refreshPricesSoon();
  const scan = await scanAll(force);
  const tl = timeline();
  const homeById = new Map(ctx.homes.map((h) => [h.id, h]));
  const seen = new Set<string>();
  const out: CodingRequest[] = [];

  for (const g of scan.groups) {
    const home = g.homeId ? homeById.get(g.homeId) : undefined;
    for (const r of g.reqs) {
      const [id, at, model, input, output, cacheRead, w5, w1h, reasoning, fast, project, reportedUsd] = r;
      // Claude Code copies earlier turns into resumed sessions; count each reply once.
      if (g.tool === "claude") {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      let key: string;
      if (g.accountKey) key = g.accountKey;
      else if (g.tool === "opencode" || g.tool === "slates") key = `${g.tool}:local`;
      else if (home && home.owned) key = ctx.keyOfHome.get(home.id)!;
      else {
        const owner = defaultOwnerAt(g.tool as HomeTool, at, tl);
        key = owner ? accountKey(g.tool, owner) : `home:${g.homeId}`;
      }
      // Cursor prices its own requests; that's the most honest number there is.
      const { costUsd, estimated } = reportedUsd != null ? { costUsd: reportedUsd, estimated: false } : priceOf(model, {
        input,
        output,
        cacheRead,
        cacheWrite5m: w5,
        cacheWrite1h: w1h,
        fast: fast === 1,
      });
      out.push({
        id: `${g.tool}:${id}`,
        at,
        tool: g.tool,
        accountKey: key,
        model,
        project,
        input,
        output,
        cacheRead,
        cacheWrite: w5 + w1h,
        reasoning,
        costUsd,
        estimated,
      });
    }
  }
  out.sort((a, b) => b.at - a.at);
  return { reqs: out, files: scan.files, ms: scan.ms, limits: scan.limits };
}

function accountRows(ctx: Ctx, reqs: CodingRequest[], start: number): AccountRow[] {
  const meta = accountMeta();
  const rows = new Map<string, AccountRow>();

  const ensure = (key: string, tool: CodingTool, email: string | null): AccountRow => {
    let row = rows.get(key);
    if (!row) {
      const m = meta[key] ?? {};
      row = {
        key,
        tool,
        label: m.label ?? email ?? TOOL_LABEL[tool],
        email,
        plan: null,
        homes: [],
        inCli: false,
        waiting: false,
        requests: 0,
        tokens: 0,
        costUsd: 0,
        lastUsedAt: null,
        tracksTokens: tool !== "antigravity",
        planScale: null,
        planScaleLabel: null,
        command: null,
        canLink: (LINKABLE_TOOLS as string[]).includes(tool),
      };
      rows.set(key, row);
    }
    return row;
  };

  for (const h of ctx.homes) {
    // Gemini CLI is history only now: its account shows up if it has requests.
    if (h.tool === "gemini") continue;
    const id = ctx.identities.get(h.id) ?? null;
    // An unused default home with nobody signed in isn't an account.
    if (!id && !h.owned) continue;
    const row = ensure(ctx.keyOfHome.get(h.id)!, h.tool, id?.email ?? null);
    row.homes.push({ id: h.id, dir: h.dir, owned: h.owned });
    row.plan ??= id?.plan ?? null;
    if (h.tool === "claude" && row.planScale == null) {
      const sc = claudeScale(id);
      row.planScale = sc?.scale ?? null;
      row.planScaleLabel = sc?.label ?? null;
    }
    if (!h.owned && id) row.inCli = true;
    if (h.owned && !id) {
      row.waiting = true;
      row.label = meta[row.key]?.label ?? `New ${TOOL_LABEL[h.tool]} account`;
    }
    // Prefer the linked home's command: it's the one that isn't `claude` already.
    if (h.owned || !row.command) row.command = runCommand(h);
  }

  for (const r of reqs) {
    const email = r.accountKey.includes("@") ? r.accountKey.slice(r.accountKey.indexOf(":") + 1) : null;
    const row = ensure(r.accountKey, r.tool, email);
    row.lastUsedAt = Math.max(row.lastUsedAt ?? 0, r.at);
    if (r.at < start) continue;
    row.requests += 1;
    row.tokens += tokensOf(r);
    row.costUsd += r.costUsd;
  }

  for (const row of rows.values()) {
    if (row.tool === "opencode" || row.tool === "slates") {
      row.label = meta[row.key]?.label ?? TOOL_LABEL[row.tool];
      row.canLink = false;
    }
  }

  // Accounts with no login on this Mac earn a card only while they have usage in range.
  return [...rows.values()].filter((r) => r.homes.length > 0 || r.requests > 0).sort(
    (a, b) =>
      TOOL_ORDER.indexOf(a.tool) - TOOL_ORDER.indexOf(b.tool) ||
      Number(b.inCli) - Number(a.inCli) ||
      (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)
  );
}

function buckets(range: CodingRange, reqs: CodingRequest[], start: number): CodingDay[] {
  const hourly = range === "today";
  const map = new Map<string, CodingDay>();
  const now = Date.now();
  // Fill the axis so quiet days read as quiet, not missing.
  if (hourly) {
    const d = new Date(start);
    for (let h = 0; h < 24; h++) {
      d.setHours(h);
      const k = hourKey(d.getTime());
      map.set(k, { day: k, costUsd: 0, tokens: 0, requests: 0, byTool: {} });
    }
  } else {
    const first = range === "all" ? Math.max(reqs.length ? reqs[reqs.length - 1]!.at : now, now - 89 * DAY) : start;
    const d = new Date(first);
    d.setHours(12, 0, 0, 0);
    while (d.getTime() <= now + DAY / 2) {
      const k = dayKey(d.getTime());
      map.set(k, { day: k, costUsd: 0, tokens: 0, requests: 0, byTool: {} });
      d.setDate(d.getDate() + 1);
    }
  }
  for (const r of reqs) {
    const b = map.get(hourly ? hourKey(r.at) : dayKey(r.at));
    if (!b) continue;
    b.costUsd += r.costUsd;
    b.tokens += tokensOf(r);
    b.requests += 1;
    b.byTool[r.tool] = (b.byTool[r.tool] ?? 0) + r.costUsd;
  }
  return [...map.values()];
}

export async function buildCodingSnapshot(range: CodingRange, tool: CodingTool | null, account: string | null, force = false): Promise<CodingSnapshot> {
  const ctx = context();
  const { reqs: all, files, ms } = await allRequests(ctx, force);
  const start = rangeStart(range);
  const accounts = accountRows(ctx, all, start);

  const scoped = all.filter((r) => (!tool || r.tool === tool) && (!account || r.accountKey === account));
  const inRange = scoped.filter((r) => r.at >= start);

  const totals = { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tokens: 0, costUsd: 0, avgUsd: 0 };
  const toolMap = new Map<CodingTool, ToolRow>();
  const modelMap = new Map<string, CodingModelRow>();
  const projectMap = new Map<string, CodingProjectRow>();

  for (const r of inRange) {
    const tokens = tokensOf(r);
    totals.requests += 1;
    totals.input += r.input;
    totals.output += r.output;
    totals.cacheRead += r.cacheRead;
    totals.cacheWrite += r.cacheWrite;
    totals.tokens += tokens;
    totals.costUsd += r.costUsd;

    const t = toolMap.get(r.tool) ?? { tool: r.tool, requests: 0, tokens: 0, costUsd: 0 };
    t.requests += 1;
    t.tokens += tokens;
    t.costUsd += r.costUsd;
    toolMap.set(r.tool, t);

    const mk = `${r.tool}\u0000${r.model}`;
    const m = modelMap.get(mk) ?? { model: r.model, tool: r.tool, requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, estimated: false };
    m.requests += 1;
    m.input += r.input;
    m.output += r.output;
    m.cacheRead += r.cacheRead;
    m.cacheWrite += r.cacheWrite;
    m.costUsd += r.costUsd;
    m.estimated ||= r.estimated;
    modelMap.set(mk, m);

    if (r.project) {
      const p = projectMap.get(r.project) ?? { project: r.project, requests: 0, tokens: 0, costUsd: 0 };
      p.requests += 1;
      p.tokens += tokens;
      p.costUsd += r.costUsd;
      projectMap.set(r.project, p);
    }
  }
  totals.avgUsd = totals.requests ? totals.costUsd / totals.requests : 0;

  return {
    range,
    generatedAt: Date.now(),
    totals,
    tools: TOOL_ORDER.map((t) => toolMap.get(t)).filter((t): t is ToolRow => !!t),
    accounts,
    days: buckets(range, inRange, start),
    models: [...modelMap.values()].sort((a, b) => b.costUsd - a.costUsd).slice(0, 30),
    projects: [...projectMap.values()].sort((a, b) => b.costUsd - a.costUsd).slice(0, 12),
    pricing: pricingSource(),
    index: { files, ms },
  };
}

export async function requestPage(opts: {
  range: CodingRange;
  tool: CodingTool | null;
  account: string | null;
  offset: number;
  limit: number;
}): Promise<CodingRequestPage> {
  const ctx = context();
  const { reqs } = await allRequests(ctx);
  const start = rangeStart(opts.range);
  const meta = accountMeta();
  const labels = new Map<string, string>();
  for (const h of ctx.homes) {
    const id = ctx.identities.get(h.id);
    if (id) labels.set(ctx.keyOfHome.get(h.id)!, id.email);
  }
  const filtered = reqs.filter(
    (r) => r.at >= start && (!opts.tool || r.tool === opts.tool) && (!opts.account || r.accountKey === opts.account)
  );
  const rows = filtered.slice(opts.offset, opts.offset + opts.limit).map((r) => {
    const email = r.accountKey.includes("@") ? r.accountKey.slice(r.accountKey.indexOf(":") + 1) : null;
    return {
      ...r,
      accountLabel: meta[r.accountKey]?.label ?? labels.get(r.accountKey) ?? email ?? TOOL_LABEL[r.tool],
    };
  });
  return { total: filtered.length, rows };
}

/** Live limits for every account that has a login on this machine. */
export async function allLimits(): Promise<Record<string, AccountLimits>> {
  const ctx = context();
  const scan = await scanAll();
  const out: Record<string, AccountLimits> = {};
  const chosen = new Map<string, Home>();
  for (const h of ctx.homes) {
    if (h.tool === "gemini" || !ctx.identities.get(h.id)) continue;
    const key = ctx.keyOfHome.get(h.id)!;
    // The default home is the fresher login when both exist: the CLI keeps it refreshed.
    if (!chosen.has(key) || !h.owned) chosen.set(key, h);
  }
  await Promise.all(
    [...chosen].map(async ([key, h]) => {
      out[key] = await limitsFor(h, scan.limits[h.id]);
    })
  );
  return out;
}

/** What every linked plan could do in a month, measured against its own limits. */
export async function capacity(): Promise<CapacitySnapshot> {
  const ctx = context();
  const { reqs } = await allRequests(ctx);
  const [limits] = await Promise.all([allLimits()]);
  return buildCapacity(accountRows(ctx, reqs, Date.now() - 30 * DAY), limits, reqs);
}
