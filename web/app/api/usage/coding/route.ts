import { calibrate } from "@/lib/ai-usage/coding/antigravity";
import {
  accountKey,
  createHome,
  homeById,
  identityOf,
  loginCommand,
  openInTerminal,
  removeHome,
  runCommand,
  setAccountMeta,
} from "@/lib/ai-usage/coding/accounts";
import { forgetLimits } from "@/lib/ai-usage/coding/limits";
import { allLimits, buildCodingSnapshot, capacity, requestPage } from "@/lib/ai-usage/coding/report";
import { LINKABLE_TOOLS, TOOL_ORDER, type CodingRange, type CodingTool, type LinkableTool } from "@/lib/ai-usage/coding/types";

export const dynamic = "force-dynamic";

const RANGES: CodingRange[] = ["today", "7d", "30d", "month", "all"];

function pickTool(v: string | null): CodingTool | null {
  return v && (TOOL_ORDER as string[]).includes(v) ? (v as CodingTool) : null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const r = url.searchParams.get("range") ?? "30d";
  const range = RANGES.includes(r as CodingRange) ? (r as CodingRange) : "30d";
  const tool = pickTool(url.searchParams.get("tool"));
  const account = url.searchParams.get("account") || null;
  const view = url.searchParams.get("view") ?? "snapshot";

  try {
    if (view === "limits") return Response.json(await allLimits());
    if (view === "capacity") return Response.json(await capacity());
    if (view === "requests") {
      const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));
      return Response.json(await requestPage({ range, tool, account, offset, limit }));
    }
    return Response.json(await buildCodingSnapshot(range, tool, account, url.searchParams.get("force") === "1"));
  } catch (err) {
    console.error("[ai-usage] coding snapshot failed", err);
    return Response.json({ error: "Couldn't read usage logs." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action : "";

  try {
    switch (action) {
      case "link": {
        const tool = body.tool as LinkableTool;
        if (!LINKABLE_TOOLS.includes(tool)) return Response.json({ error: "Pick Claude Code, Codex, or Antigravity." }, { status: 400 });
        const home = createHome(tool);
        const label = typeof body.label === "string" ? body.label : "";
        if (label.trim()) setAccountMeta(`home:${home.id}`, { label });
        await openInTerminal(loginCommand(home));
        return Response.json({ ok: true, homeId: home.id });
      }

      case "relogin":
      case "open": {
        const home = typeof body.homeId === "string" ? homeById(body.homeId) : null;
        if (!home) return Response.json({ error: "That account isn't on this machine." }, { status: 404 });
        await openInTerminal(action === "open" ? runCommand(home) : loginCommand(home));
        forgetLimits(home.id);
        return Response.json({ ok: true });
      }

      case "unlink": {
        if (typeof body.homeId !== "string" || !removeHome(body.homeId)) {
          return Response.json({ error: "Only accounts linked in Slates can be removed." }, { status: 400 });
        }
        forgetLimits(body.homeId);
        return Response.json({ ok: true });
      }

      case "meta": {
        if (typeof body.key !== "string" || !body.key) return Response.json({ error: "key required" }, { status: 400 });
        setAccountMeta(body.key, { label: typeof body.label === "string" ? body.label : undefined });
        return Response.json({ ok: true });
      }

      case "calibrate": {
        // Sends one short prompt per model group on this Antigravity account to size its windows.
        const home = typeof body.homeId === "string" ? homeById(body.homeId) : null;
        if (!home || home.tool !== "antigravity") return Response.json({ error: "Only Antigravity accounts are measured this way." }, { status: 400 });
        const id = identityOf(home);
        if (!id) return Response.json({ error: "This Antigravity account isn't signed in." }, { status: 400 });
        await calibrate(home, accountKey("antigravity", id.email));
        forgetLimits(home.id);
        return Response.json({ ok: true });
      }

      case "refresh-limits": {
        forgetLimits();
        return Response.json(await allLimits());
      }

      default:
        return Response.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Update failed." }, { status: 500 });
  }
}
