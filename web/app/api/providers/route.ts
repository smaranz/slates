import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { generateText } from "ai";
import { claudeCode } from "ai-sdk-provider-claude-code";

import { activeApiSecret, hasSecret } from "@/lib/ai-usage/clients";
import { Agent } from "@/lib/cursor-sdk";
import type { TutorModelBackend } from "@/lib/tutor-models";

/**
 * The tutor's four backends, checked independently of any one model: an API
 * key or a CLI login is shared across every model that backend drives, so
 * "is OpenAI connected" answers it for GPT-5.6 Sol, Terra, and Luna at once.
 *
 * A key linked in AI Usage counts as configured and is what Test uses — not
 * only process.env. Provider Test calls are not recorded as usage.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const execFileP = promisify(execFile);

/**
 * Narration is not a tutor backend — nothing in the model picker drives it —
 * but it is another key the student either has or hasn't set, and this is the
 * one screen where they look that up. It rides the same list rather than
 * growing a second, near-identical section.
 */
export type ProviderId = TutorModelBackend | "elevenlabs";

interface ProviderStatus {
  backend: ProviderId;
  label: string;
  powers: string;
  /** Cheap baseline: an env var / linked key, or the CLI resolves on PATH. Not proof it works. */
  configured: boolean;
  detail: string;
}

/** A CLI resolving and running at all — even exiting non-zero — proves it's installed. */
async function cliInstalled(bin: string): Promise<boolean> {
  try {
    await execFileP(bin, ["--version"], { timeout: 4000 });
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== "ENOENT";
  }
}

export async function GET() {
  const claudeInstalled = await cliInstalled("claude");

  const cursorInstalled = await cliInstalled("cursor-agent");

  const providers: ProviderStatus[] = [
    {
      backend: "openai",
      label: "OpenAI",
      powers: "GPT-5.6 Sol, Terra, Luna",
      configured: hasSecret("openai"),
      detail: "Linked in AI Usage, or OPENAI_API_KEY in the environment.",
    },
    {
      backend: "claude-code",
      label: "Claude Code CLI",
      powers: "Claude Sonnet 5, Haiku 4.5, Opus 5",
      configured: claudeInstalled,
      detail: "Local `claude auth login` — no API key needed.",
    },
    {
      backend: "cursor-agent",
      label: "Cursor CLI",
      powers: "Grok 4.7, Composer 2.5",
      configured: cursorInstalled,
      /*
       * Only safe under a plain Node process. `@cursor/sdk` loads a native
       * tree-sitter binding on every `Agent.create` call, built against
       * regular Node's ABI; the packaged app spawns its portal server under
       * Electron's bundled Node (a different ABI), and that mismatch
       * segfaults the whole process instead of throwing a catchable error.
       * `npm run dev` / `npm run start` are unaffected. See tutor-models.ts.
       */
      detail: "Local `cursor-agent login` — no API key needed.",
    },
    {
      backend: "openrouter",
      label: "OpenRouter",
      powers: "DeepSeek, GLM, Qwen, Gemini, MiniMax",
      configured: hasSecret("openrouter"),
      detail: "Linked in AI Usage, or OPENROUTER_API_KEY in the environment.",
    },
    {
      backend: "elevenlabs",
      label: "ElevenLabs",
      powers: "Narration for teaching videos",
      configured: hasSecret("elevenlabs"),
      detail: "Linked in AI Usage, or ELEVENLABS_API_KEY in the environment.",
    },
  ];

  return Response.json({ providers });
}

/**
 * A real, minimal round trip per backend — the only way to tell "configured"
 * from "actually works". An expired CLI login or a revoked key both still
 * look configured; only a live call catches those, which is why this runs on
 * demand from a Test button rather than automatically on every page load.
 *
 * Not recorded in the AI Usage ledger — a Test is not real usage.
 */
export async function POST(req: Request) {
  const { backend } = (await req.json().catch(() => ({}))) as { backend?: ProviderId };

  try {
    if (backend === "openai") {
      const key = activeApiSecret("openai");
      if (!key) throw new Error("No OpenAI key linked or set.");
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(res.status === 401 ? "OpenAI rejected the key." : `OpenAI returned ${res.status}.`);
      return Response.json({ ok: true });
    }

    if (backend === "openrouter") {
      const key = activeApiSecret("openrouter");
      if (!key) throw new Error("No OpenRouter key linked or set.");
      const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(res.status === 401 ? "OpenRouter rejected the key." : `OpenRouter returned ${res.status}.`);
      return Response.json({ ok: true });
    }

    if (backend === "elevenlabs") {
      const key = activeApiSecret("elevenlabs");
      if (!key) throw new Error("No ElevenLabs key linked or set.");
      // Listing voices is the cheapest call that still proves the key works.
      const res = await fetch("https://api.elevenlabs.io/v1/voices", {
        headers: { "xi-api-key": key },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        throw new Error(res.status === 401 ? "ElevenLabs rejected the key." : `ElevenLabs returned ${res.status}.`);
      }
      return Response.json({ ok: true });
    }

    if (backend === "claude-code") {
      const { text } = await generateText({
        model: claudeCode("claude-haiku-4-5-20251001"),
        prompt: "Reply with exactly one word: ok",
      });
      if (!text.trim()) throw new Error("The Claude Code CLI returned nothing — check `claude auth login`.");
      return Response.json({ ok: true });
    }

    if (backend === "cursor-agent") {
      const agent = await Agent.create({ model: { id: "composer-2.5" } });
      try {
        const run = await agent.send({ text: "Reply with exactly one word: ok" }, { mode: "plan" });
        const result = await run.wait();
        if (result.status === "error") {
          throw new Error(result.error?.message ?? "The Cursor agent run failed.");
        }
      } finally {
        agent.close();
      }
      return Response.json({ ok: true });
    }

    return Response.json({ ok: false, error: "Unknown provider." }, { status: 400 });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
