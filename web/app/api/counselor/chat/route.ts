import { openaiProvider, openrouterModel, hasSecret } from "@/lib/ai-usage/clients";
import { noteStreamUsage } from "@/lib/ai-usage/note";
import { stepCountIs, streamText, type ModelMessage } from "ai";

import { buildCounselorPrompt } from "@/lib/counselor/prompt";
import type { TutorMessagePart } from "@/lib/attachments";
import { DEFAULT_COUNSELOR_MODEL, isCounselorModel, normalizeCounselorThinking } from "@/lib/counselor/models";
import { emptyState } from "@/lib/counselor/state";
import { counselorTools, newToolContext, patchOf, TOOL_LABEL } from "@/lib/counselor/tools";
import type { SchoolRecord } from "@/lib/counselor/school";
import type { CounselorEvent, CounselorState, Source } from "@/lib/counselor/types";
import { tutorModelBackend } from "@/lib/tutor-models";

/**
 * One turn with the counselor.
 *
 * The whole student record arrives with the request, the tool loop mutates
 * that copy, and the frames sent back carry both the reply and the edits — so
 * the server finishes the request holding nothing. That is what lets the
 * counselor keep a real, durable record of a student without Slates growing an
 * account system or a database.
 *
 * The wire format is NDJSON rather than a plain text stream because a turn is
 * more than prose: reasoning, tools, sources, meetings, and state changes.
 * The client needs to tell those apart as they arrive.
 */

export const maxDuration = 120;

/** Enough room to research, act, and then actually answer. */
const MAX_STEPS = 14;

interface ChatRequest {
  messages: { role: "user" | "assistant"; content: string | TutorMessagePart[] }[];
  state: CounselorState;
  model?: unknown;
  thinking?: unknown;
  /** One line per course from the school side, when the student has synced. */
  schoolContext?: string;
  /** The full school record, read by get_school_grades / get_school_workload. */
  school?: SchoolRecord | null;
}

export async function POST(req: Request) {
  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const modelId = isCounselorModel(body.model) ? body.model : DEFAULT_COUNSELOR_MODEL;
  const backend = tutorModelBackend(modelId);

  if (backend === "openrouter") {
    if (!hasSecret("openrouter")) {
      return json({
        t: "error",
        v: "No OpenRouter key. Link one in AI Usage, or add OPENROUTER_API_KEY to .env and restart.",
      });
    }
  } else if (!hasSecret("openai")) {
    return json({
      t: "error",
      v: "No OpenAI key. Link one in AI Usage, or add OPENAI_API_KEY to .env and restart.",
    });
  }
  if (!body?.state || !Array.isArray(body.messages)) {
    return new Response("Bad request", { status: 400 });
  }

  const base = emptyState();
  const normalized: CounselorState = {
    ...base,
    ...body.state,
    schemaVersion: 2,
    profile: { ...base.profile, ...(body.state.profile ?? {}), activities: body.state.profile?.activities ?? [] },
    memories: body.state.memories ?? [],
    tasks: body.state.tasks ?? [],
    meetings: body.state.meetings ?? [],
    applications: body.state.applications ?? [],
    list: body.state.list ?? [],
    coursework: body.state.coursework ?? [],
    testing: body.state.testing ?? [],
    awards: body.state.awards ?? [],
    essays: body.state.essays ?? [],
    threads: [],
    masterPlan: body.state.masterPlan ?? null,
    planProposals: body.state.planProposals ?? [],
    planRevisions: [],
  };
  const ctx = newToolContext(structuredClone(normalized), body.school ?? null);

  const openai = backend === "openai" ? openaiProvider() : null;
  const tools = {
    ...counselorTools(ctx),
    /*
     * Web search is OpenAI's own provider-executed tool, so it only exists on
     * that backend — handing it to OpenRouter would send a tool definition the
     * model cannot run. The thirty counselor tools are ours and work
     * everywhere; only looking something up on the open web is conditional.
     */
    ...(openai ? { web_search: openai.tools.webSearch({ searchContextSize: "medium" }) } : {}),
  };

  /*
   * Cast for the same reason the tutor route casts: `toModelContent` returns
   * the union of every content shape, which TypeScript will not narrow against
   * a `role` that is itself a union, so the pair never matches one arm of
   * ModelMessage. The values are correct per role; only the proof is missing.
   */
  const messages: ModelMessage[] = body.messages
    .filter((m) => typeof m.content !== "string" || m.content.trim())
    .map((m) => ({ role: m.role, content: toModelContent(m.content) })) as ModelMessage[];

  const thinking = normalizeCounselorThinking(body.thinking);

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: CounselorEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        const result = streamText({
          model: backend === "openrouter" ? openrouterModel(modelId) : openai!(modelId),
          system: buildCounselorPrompt(ctx.state, body.schoolContext),
          messages,
          tools,
          stopWhen: stepCountIs(MAX_STEPS),
          /*
           * Each provider reads only its own key here and ignores the rest, so
           * both are passed rather than branched — the reasoning level is the
           * same request either way, just spelled differently.
           */
          providerOptions: {
            openai: { reasoningEffort: thinking, reasoningSummary: "auto" },
            openrouter: { reasoning: { effort: thinking } },
          },
        });

        noteStreamUsage("counselor", modelId, backend, result.totalUsage);

        // Tool names are reported as they are *called*, not as they finish, so
        // the working panel fills in while the work is still happening rather
        // than all at once at the end.
        const web: Source[] = [];

        for await (const part of result.fullStream) {
          if (part.type === "text-delta") {
            if (part.text) send({ t: "delta", v: part.text });
          } else if (part.type === "reasoning-delta") {
            if (part.text) send({ t: "reasoning", v: part.text });
          } else if (part.type === "tool-call") {
            const name = part.toolName ?? "tool";
            send({ t: "tool", id: part.toolCallId ?? `${name}-${Date.now()}`, name, label: TOOL_LABEL[name] ?? name });
          } else if (part.type === "tool-result") {
            const name = part.toolName ?? "tool";
            send({ t: "tool_done", id: part.toolCallId ?? name, name, label: TOOL_LABEL[name] ?? name, ok: true });
          } else if (part.type === "tool-error") {
            const name = part.toolName ?? "tool";
            send({ t: "tool_done", id: part.toolCallId ?? name, name, label: TOOL_LABEL[name] ?? name, ok: false });
          } else if (part.type === "source") {
            // Pages the hosted web search actually opened. Deduped below —
            // one search can cite the same site several times.
            if (part.sourceType === "url") {
              web.push({ title: part.title || hostOf(part.url), origin: "web", url: part.url });
            }
          } else if (part.type === "error") {
            send({ t: "error", v: describe(part.error) });
          }
        }

        if (ctx.meetings.length) send({ t: "meetings", v: ctx.meetings });
        if (ctx.ask) send({ t: "ask", v: ctx.ask });

        const sources = dedupe([...ctx.sources, ...web]);
        if (sources.length) send({ t: "sources", v: sources });

        // The patch goes last so the browser only commits edits from a turn
        // that actually reached the end.
        const patch = patchOf(ctx);
        if (Object.keys(patch).length) send({ t: "state", v: patch });

        send({ t: "done" });
      } catch (err) {
        send({ t: "error", v: describe(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

function toModelContent(content: string | TutorMessagePart[]): ModelMessage["content"] {
  if (typeof content === "string") return content;
  return content.map((part) => part.type === "image"
    ? {
        type: "file" as const,
        data: { type: "data" as const, data: part.data ?? "" },
        mediaType: part.mediaType ?? "image/png",
        filename: part.filename,
      }
    : { type: "text" as const, text: part.text ?? "" }
  ) as ModelMessage["content"];
}

/** One chip per distinct source, keyed on the URL when there is one. */
function dedupe(sources: Source[]): Source[] {
  const seen = new Map<string, Source>();
  for (const source of sources) {
    const key = source.url ?? `${source.origin}:${source.title}`;
    if (!seen.has(key)) seen.set(key, source);
  }
  return [...seen.values()].slice(0, 8);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Something went wrong.";
}

function json(event: CounselorEvent): Response {
  return new Response(`${JSON.stringify(event)}\n${JSON.stringify({ t: "done" })}\n`, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}
