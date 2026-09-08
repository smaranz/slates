import { openai } from "@ai-sdk/openai";
import { stepCountIs, streamText, type ModelMessage } from "ai";

import { buildCounselorPrompt } from "@/lib/counselor/prompt";
import { counselorTools, newToolContext, patchOf, TOOL_LABEL } from "@/lib/counselor/tools";
import type { SchoolRecord } from "@/lib/counselor/school";
import type { CounselorEvent, CounselorState, Source } from "@/lib/counselor/types";

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
 * more than prose: tools start and finish, documents appear, state changes.
 * The client needs to tell those apart as they arrive.
 */

export const maxDuration = 120;

const MODEL = process.env.SLATES_COUNSELOR_MODEL || "gpt-5.6-sol";

/** Enough room to research, act, and then actually answer. */
const MAX_STEPS = 14;

interface ChatRequest {
  messages: { role: "user" | "assistant"; content: string }[];
  state: CounselorState;
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

  if (!process.env.OPENAI_API_KEY) {
    return json({ t: "error", v: "No OPENAI_API_KEY set. Add one to web/.env.local and restart." });
  }
  if (!body?.state || !Array.isArray(body.messages)) {
    return new Response("Bad request", { status: 400 });
  }

  const ctx = newToolContext(structuredClone(body.state), body.school ?? null);
  const tools = {
    ...counselorTools(ctx),
    // Runs on OpenAI's side rather than here, so the counselor can check a
    // deadline or a policy without Slates growing a crawler for the open web.
    web_search: openai.tools.webSearch({ searchContextSize: "medium" }),
  };

  const messages: ModelMessage[] = body.messages
    .filter((m) => m.content.trim())
    .map((m) => ({ role: m.role, content: m.content }));

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: CounselorEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        const result = streamText({
          model: openai(MODEL),
          system: buildCounselorPrompt(ctx.state, body.schoolContext),
          messages,
          tools,
          stopWhen: stepCountIs(MAX_STEPS),
        });

        // Tool names are reported as they are *called*, not as they finish, so
        // the working panel fills in while the work is still happening rather
        // than all at once at the end.
        const web: Source[] = [];

        for await (const part of result.fullStream) {
          if (part.type === "text-delta") {
            if (part.text) send({ t: "delta", v: part.text });
          } else if (part.type === "tool-call") {
            send({ t: "tool", label: TOOL_LABEL[part.toolName] ?? part.toolName });
          } else if (part.type === "tool-result") {
            send({ t: "tool_done", label: TOOL_LABEL[part.toolName] ?? part.toolName, ok: true });
          } else if (part.type === "tool-error") {
            send({ t: "tool_done", label: TOOL_LABEL[part.toolName] ?? part.toolName, ok: false });
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

        if (ctx.docs.length) send({ t: "documents", v: ctx.docs });
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
