import { noteUsage } from "@/lib/ai-usage/note";
import {
  deactivateApiPlans,
  deactivateSubscriptions,
  deletePlan,
  linkApiPlan,
  setActivePlan,
} from "@/lib/ai-usage/store";
import { buildSnapshot } from "@/lib/ai-usage/snapshot";
import type { PlanKind, UsageProvider, UsageRange } from "@/lib/ai-usage/types";

export const dynamic = "force-dynamic";

const RANGES: UsageRange[] = ["today", "7d", "30d", "all"];
const PROVIDERS: UsageProvider[] = [
  "openai",
  "openrouter",
  "elevenlabs",
  "claude-code",
  "cursor",
];

function isProvider(v: unknown): v is UsageProvider {
  return typeof v === "string" && (PROVIDERS as string[]).includes(v);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rangeParam = url.searchParams.get("range") ?? "30d";
  const range: UsageRange = RANGES.includes(rangeParam as UsageRange)
    ? (rangeParam as UsageRange)
    : "30d";
  return Response.json(buildSnapshot(range));
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
        if (!isProvider(body.provider) || typeof body.label !== "string" || !body.label.trim()) {
          return Response.json({ error: "provider, label, and kind are required." }, { status: 400 });
        }
        const kind = body.kind === "subscription" ? "subscription" : body.kind === "api" ? "api" : null;
        if (!kind) {
          return Response.json({ error: "provider, label, and kind are required." }, { status: 400 });
        }
        const provider = body.provider;
        if (kind === "api") {
          if (provider === "claude-code" || provider === "cursor") {
            return Response.json(
              { error: "Claude Code and Cursor only support subscription plans." },
              { status: 400 }
            );
          }
          if (typeof body.secret !== "string" || !body.secret.trim()) {
            return Response.json({ error: "An API key is required for api plans." }, { status: 400 });
          }
        }
        if (kind === "subscription" && provider === "openrouter") {
          return Response.json({ error: "OpenRouter only supports api keys." }, { status: 400 });
        }
        if ((provider === "claude-code" || provider === "cursor") && kind !== "subscription") {
          return Response.json({ error: "Only subscription plans for this provider." }, { status: 400 });
        }
        const monthlyUsd =
          typeof body.monthlyUsd === "number"
            ? body.monthlyUsd
            : typeof body.monthlyUsd === "string" && body.monthlyUsd
              ? Number(body.monthlyUsd)
              : null;
        const { plan } = linkApiPlan({
          provider,
          label: body.label,
          kind: kind as PlanKind,
          secret: kind === "api" ? String(body.secret) : undefined,
          monthlyUsd: Number.isFinite(monthlyUsd as number) ? (monthlyUsd as number) : null,
        });
        return Response.json({ ok: true, plan, snapshot: buildSnapshot("30d") });
      }

      case "activate": {
        if (typeof body.id !== "string" || !body.id) {
          return Response.json({ error: "id required" }, { status: 400 });
        }
        setActivePlan(body.id);
        return Response.json({ ok: true, snapshot: buildSnapshot("30d") });
      }

      case "remove": {
        if (typeof body.id !== "string" || !body.id) {
          return Response.json({ error: "id required" }, { status: 400 });
        }
        if (body.id.startsWith("env:") || body.id.startsWith("cli:")) {
          return Response.json({ error: "That plan can't be removed." }, { status: 400 });
        }
        deletePlan(body.id);
        return Response.json({ ok: true, snapshot: buildSnapshot("30d") });
      }

      case "use-env": {
        if (!isProvider(body.provider)) {
          return Response.json({ error: "provider required" }, { status: 400 });
        }
        deactivateApiPlans(body.provider);
        return Response.json({ ok: true, snapshot: buildSnapshot("30d") });
      }

      case "use-cli": {
        if (!isProvider(body.provider)) {
          return Response.json({ error: "provider required" }, { status: 400 });
        }
        deactivateSubscriptions(body.provider);
        return Response.json({ ok: true, snapshot: buildSnapshot("30d") });
      }

      case "record": {
        // Browser-side voice usage only — other agents record on the server.
        if (body.agent !== "voice") {
          return Response.json({ error: "Only voice can record from the browser." }, { status: 400 });
        }
        const clamp = (n: unknown) => {
          const v = typeof n === "number" ? n : Number(n);
          if (!Number.isFinite(v)) return 0;
          return Math.max(0, Math.min(10_000_000, Math.floor(v)));
        };
        const inputTokens = clamp(body.inputTokens);
        const outputTokens = clamp(body.outputTokens);
        if (inputTokens === 0 && outputTokens === 0) {
          return Response.json({ ok: true, ignored: true });
        }
        noteUsage({
          agent: "voice",
          model: typeof body.model === "string" && body.model ? body.model : "gpt-realtime-2.1-mini",
          backend: "openai",
          inputTokens,
          outputTokens,
        });
        return Response.json({ ok: true });
      }

      default:
        return Response.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Usage update failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
