import { Agent } from "@/lib/cursor-sdk";
import { claudeCode } from "ai-sdk-provider-claude-code";
import { streamText, type ModelMessage } from "ai";

import { openaiProvider, openrouterModel } from "@/lib/ai-usage/clients";
import { noteStreamUsage, noteUsage } from "@/lib/ai-usage/note";
import {
  DEFAULT_THINKING,
  DEFAULT_TUTOR_MODEL,
  isThinkingLevel,
  migrateTutorModelId,
  tutorModelBackend,
  tutorModelComposer,
  tutorModelGrok,
  type ThinkingLevel,
  type TutorModelId,
} from "@/lib/tutor-models";
import type { TutorMessagePart } from "@/lib/attachments";
import { TUTOR_ACTION_INSTRUCTIONS } from "@/lib/tutor-actions";
import {
  claudeSkillOptions,
  skillInstructionsForClaude,
  skillInstructionsForTextOnlyBackend,
} from "@/lib/tutor-skills";
import { TUTOR_DOCUMENT_INSTRUCTIONS } from "@/lib/tutor-documents";
import { TUTOR_GRAPH_INSTRUCTIONS } from "@/lib/tutor-graph";
import { TUTOR_QUIZ_INSTRUCTIONS } from "@/lib/tutor-quiz";
import { encodeEvent, toolLabel, type TutorEvent } from "@/lib/tutor-stream";

// Streaming keeps the connection alive for long answers instead of
// hitting a request timeout. The CLI-backed models (Claude Code, Cursor)
// spin up a subprocess, so they get more headroom than a plain API call needs.
export const maxDuration = 90;

interface TutorRequest {
  messages: Array<{
    role: "user" | "assistant";
    content: string | TutorMessagePart[];
  }>;
  /** One line per course: name, grade, and what's still open. */
  context?: string;
  /**
   * What the student attached with `@` in this message: the specific
   * assignment, class, essay or material the question is about. Placed after
   * the board so it reads as the foreground against it — see
   * lib/tutor-mentions.ts.
   */
  focus?: string;
  studentName?: string;
  /** Whichever model the student picked in the composer. */
  model?: string;
  /** Shared thinking level for OpenAI/Claude/OpenRouter — Grok bakes its own into the model id. */
  thinking?: string;
}

/** Converts the composer's wire format into AI SDK message content. */
function toModelContent(
  content: string | TutorMessagePart[]
): ModelMessage["content"] {
  if (typeof content === "string") return content;

  return content.map((part) => {
    if (part.type === "image") {
      return {
        type: "file" as const,
        data: { type: "data" as const, data: part.data ?? "" },
        mediaType: part.mediaType ?? "image/png",
        filename: part.filename,
      };
    }
    return { type: "text" as const, text: part.text ?? "" };
  }) as ModelMessage["content"];
}

interface CursorImage {
  data: string;
  mimeType: string;
}

/** Text (and, for the file part, an image) pulled out of one message's content. */
function splitTextAndImages(content: ModelMessage["content"]): { text: string; images: CursorImage[] } {
  if (typeof content === "string") return { text: content, images: [] };

  const textParts: string[] = [];
  const images: CursorImage[] = [];
  for (const part of content) {
    if (part.type === "text") {
      textParts.push(part.text);
    } else if (part.type === "file" && typeof part.data === "object" && "data" in part.data) {
      images.push({ data: String(part.data.data), mimeType: part.mediaType });
    }
  }
  return { text: textParts.join("\n"), images };
}

/**
 * The Cursor SDK's `send()` takes one message, not a conversation array, so
 * earlier turns are flattened into the prompt the way a transcript would
 * read. Only the *last* message's images are forwarded live — the SDK has no
 * way to replay images against a fresh local agent for older turns.
 */
function buildCursorPrompt(
  system: string,
  messages: ModelMessage[]
): { text: string; images: CursorImage[] } {
  const lines = [system];
  let lastImages: CursorImage[] = [];

  messages.forEach((m, i) => {
    const { text, images } = splitTextAndImages(m.content);
    const isLast = i === messages.length - 1;
    if (isLast) lastImages = images;
    const body = [text, !isLast && images.length ? "[Attached image]" : ""].filter(Boolean).join(" ");
    if (body) lines.push(`${m.role === "user" ? "Human" : "Assistant"}: ${body}`);
  });

  return { text: lines.join("\n\n"), images: lastImages };
}

/** Maps our internal catalog id to the Cursor SDK's `{ id, params }` model selection. */
function cursorModelSelection(modelId: TutorModelId): { id: string; params?: Array<{ id: string; value: string }> } {
  const grok = tutorModelGrok(modelId);
  if (grok) {
    // Cursor's catalog lists grok-4.7 with `reasoning_effort` + `fast`
    // (4.6 used the shorter `effort` id). Context stays at the SDK default.
    return {
      id: "grok-4.7",
      params: [
        { id: "reasoning_effort", value: grok.thinking },
        { id: "fast", value: String(grok.fast) },
      ],
    };
  }
  const composer = tutorModelComposer(modelId);
  return {
    id: "composer-2.5",
    params: composer?.fast ? [{ id: "fast", value: "true" }] : undefined,
  };
}

/**
 * Grok and Composer run through the local Cursor CLI login instead of an API
 * key, via the official `@cursor/sdk`. `mode: "plan"` keeps every run
 * read-only (no shell/file edits) — all a study tutor should ever need, and
 * the closest the SDK has to the CLI's own `--mode ask`.
 */
function streamFromCursorAgentSDK(
  modelId: TutorModelId,
  prompt: string,
  images: CursorImage[]
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      const send = (event: TutorEvent) => controller.enqueue(encodeEvent(event));
      try {
        const agent = await Agent.create({ model: cursorModelSelection(modelId) });
        const run = await agent.send(
          { text: prompt, images: images.length ? images : undefined },
          {
            mode: "plan",
            onDelta: ({ update }) => {
              /*
               * The Cursor agent reports its own thinking and tool use through
               * the same delta channel as the prose, so they are separated
               * here rather than being flattened into the answer — which is
               * what happened before, when only `text-delta` was read and
               * everything else was dropped on the floor.
               */
              const u = update as { type: string; text?: string; toolName?: string; name?: string };
              if (u.type === "text-delta" && u.text) send({ t: "delta", v: u.text });
              else if (u.type === "reasoning-delta" && u.text) send({ t: "reasoning", v: u.text });
              else if (u.type === "tool-call") {
                const name = u.toolName ?? u.name ?? "tool";
                send({ t: "tool", name, label: toolLabel(name) });
              } else if (u.type === "tool-result") {
                const name = u.toolName ?? u.name ?? "tool";
                send({ t: "tool_done", name, label: toolLabel(name), ok: true });
              }
            },
          }
        );
        const result = await run.wait();
        // Usage before close — the SDK clears the handle afterward.
        try {
          const usage = await agent.getUsage();
          noteUsage({
            agent: "tutor",
            model: modelId,
            backend: "cursor",
            inputTokens: usage.usage.inputTokens,
            outputTokens: usage.usage.outputTokens,
            reasoningTokens: usage.usage.reasoningTokens ?? 0,
            cacheReadTokens: usage.usage.cacheReadTokens,
            covered: true,
          });
        } catch {
          noteUsage({
            agent: "tutor",
            model: modelId,
            backend: "cursor",
            inputTokens: 0,
            outputTokens: 0,
            covered: true,
          });
        }
        agent.close();
        if (result.status === "error") {
          send({ t: "error", v: result.error?.message ?? "Cursor agent run failed." });
        }
        send({ t: "done" });
        controller.close();
      } catch (err) {
        send({ t: "error", v: err instanceof Error ? err.message : String(err) });
        controller.close();
      }
    },
  });
}

export async function POST(req: Request) {
  const { messages, context, focus, studentName, model, thinking }: TutorRequest = await req.json();
  const thinkingLevel: ThinkingLevel = isThinkingLevel(thinking) ? thinking : DEFAULT_THINKING;

  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response("messages required", { status: 400 });
  }

  /*
   * Resolved before the prompt is built, because what the tutor should be told
   * about skills depends entirely on whether this backend can run one.
   */
  const resolvedModel: TutorModelId =
    migrateTutorModelId(model) ??
    migrateTutorModelId(process.env.SLATES_TUTOR_MODEL) ??
    DEFAULT_TUTOR_MODEL;
  const canRunSkills = tutorModelBackend(resolvedModel) === "claude-code";

  const system = [
    "You are Slates Tutor, a concise high-school study coach.",
    studentName ? `The student's name is ${studentName}.` : "",
    context
      ? `Everything on their board — every course, assignment (done and not), grade, submission, and comment:\n${context}`
      : "",
    // After the board, so the thing being pointed at is the last context read
    // before the instructions — the foreground against that background.
    focus ? focus : "",
    "",
    "For an ordinary chat reply, answer in 2-4 short sentences. Be specific:",
    "reference their actual courses and assignments when relevant, and end",
    "with one concrete next step. No markdown headers and no bullet list",
    "longer than 3 items in a chat reply — that limit doesn't apply inside a",
    "document, quiz, or graph block (see below), which should be as complete",
    "and well-formatted as the task actually calls for.",
    "If they ask you to do an assignment for them, help them work through it",
    "instead — explain the concept, then ask what they'd try next.",
    "",
    "The student may attach images or the extracted text of a document —",
    "read them closely before answering.",
    "",
    /*
     * Chat, documents and quizzes all render through the same KaTeX-enabled
     * markdown (components/TutorMarkdown.tsx), so maths is written as maths.
     * Without this the model falls back to flat text — "(2 + (-4))/2",
     * "3cos(2(x - pi/4)) - 1" — which is notation a student has to decode
     * rather than the one their textbook uses.
     */
    "Write every piece of maths in LaTeX, wrapped in $…$ inline or $$…$$ on",
    "its own line for anything worth setting apart. It is rendered properly,",
    "so use the real notation: \\frac{a}{b} for a fraction rather than a/b,",
    "\\pi, \\theta, \\cdot, \\le, \\pm, x^{2}, \\sqrt{x}, and \\sin \\cos \\tan for",
    "function names so they don't italicise like variables.",
    "",
    "That means every number-with-symbols goes in maths mode, not just the big",
    "equations: $D = \\frac{2 + (-4)}{2} = -1$, not \"D = (2 + (-4))/2 = -1\".",
    "Plain prose stays plain — don't wrap ordinary words or bare counts.",
    "",
    TUTOR_ACTION_INSTRUCTIONS,
    "",
    canRunSkills ? skillInstructionsForClaude() : skillInstructionsForTextOnlyBackend(),
    "",
    TUTOR_DOCUMENT_INSTRUCTIONS,
    "",
    TUTOR_QUIZ_INSTRUCTIONS,
    "",
    TUTOR_GRAPH_INSTRUCTIONS,
  ]
    .filter(Boolean)
    .join("\n");

  // Only ids from the picker's list are honoured, so a crafted request can't
  // point the tutor at an arbitrary (or far pricier) model.
  const modelId = resolvedModel;

  const modelMessages: ModelMessage[] = messages.map((m) => ({
    role: m.role,
    content: toModelContent(m.content),
  })) as ModelMessage[];

  const backend = tutorModelBackend(modelId);

  if (backend === "cursor-agent") {
    const { text, images } = buildCursorPrompt(system, modelMessages);
    return new Response(streamFromCursorAgentSDK(modelId, text, images), {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  }

  const result =
    backend === "claude-code"
      ? streamText({
          /*
           * Runs through the local Claude Code CLI login — no API key needed.
           *
           * Skills and the sandbox are passed as model *settings*, not as
           * `providerOptions`: that channel carries reasoning options only
           * (`thinking`, `effort`) and silently drops everything else, so
           * configuring the sandbox there left the session with no sandbox at
           * all. See lib/tutor-skills.ts.
           */
          model: claudeCode(modelId, claudeSkillOptions()),
          system,
          messages: modelMessages,
          providerOptions: {
            "claude-code": { effort: thinkingLevel },
          },
        })
      : backend === "openrouter"
        ? streamText({
            model: openrouterModel(modelId),
            system,
            messages: modelMessages,
            providerOptions: {
              openrouter: { reasoning: { effort: thinkingLevel } },
            },
          })
        : (() => {
            const provider = openaiProvider();
            return streamText({
              model: provider(modelId),
              system,
              messages: modelMessages,
              /*
               * The one tool the API-backed models get. A tutor that can't look
               * anything up has to answer exam dates and current syllabi from
               * memory, which is exactly where it makes things up; and it is
               * what puts visible steps in front of the student on these models,
               * which otherwise only ever show reasoning.
               *
               * Taken from the same provider instance that holds the active
               * linked key, so web search and the model don't disagree about
               * credentials.
               */
              tools: { web_search: provider.tools.webSearch({}) },
              providerOptions: {
                /*
                 * `reasoningSummary` is what makes the thinking visible. Without
                 * it the reasoning models still reason, they just never send any
                 * of it, and the panel above the reply has nothing to show.
                 */
                openai: { reasoningEffort: thinkingLevel, reasoningSummary: "auto" },
              },
            });
          })();

  noteStreamUsage("tutor", modelId, backend, result.totalUsage);

  return ndjson(result.fullStream);
}

/**
 * The model's stream, re-emitted as events the client can tell apart.
 *
 * `toTextStreamResponse()` would forward the prose and drop everything else —
 * the reasoning, the tool calls, the step boundaries — which is exactly the
 * material a student needs to see that something is happening and what.
 *
 * An error mid-stream is sent as an event rather than tearing the response
 * down: whatever the tutor already said is worth keeping on screen, and a
 * half-answer with a note beats a blank bubble.
 */
function ndjson(parts: AsyncIterable<StreamPart>): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: TutorEvent) => controller.enqueue(encodeEvent(event));
      try {
        for await (const part of parts) {
          switch (part.type) {
            case "text-delta":
              if (part.text) send({ t: "delta", v: part.text });
              break;
            case "reasoning-delta":
              if (part.text) send({ t: "reasoning", v: part.text });
              break;
            case "tool-call": {
              const name = part.toolName ?? "tool";
              send({ t: "tool", name, label: toolLabel(name) });
              break;
            }
            case "tool-result":
            case "tool-error": {
              const name = part.toolName ?? "tool";
              send({ t: "tool_done", name, label: toolLabel(name), ok: part.type === "tool-result" });
              break;
            }
            case "finish-step":
              send({ t: "step" });
              break;
            case "error":
              send({ t: "error", v: part.error instanceof Error ? part.error.message : String(part.error) });
              break;
          }
        }
        send({ t: "done" });
      } catch (err) {
        send({ t: "error", v: err instanceof Error ? err.message : "The tutor stopped unexpectedly." });
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

/** Whatever `fullStream` yields — narrowed by the switch above, not here. */
type StreamPart = {
  type: string;
  text?: string;
  toolName?: string;
  error?: unknown;
} & Record<string, unknown>;
