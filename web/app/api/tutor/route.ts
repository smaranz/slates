import { Agent } from "@/lib/cursor-sdk";
import { claudeCode } from "ai-sdk-provider-claude-code";
import { stepCountIs, streamText, type ModelMessage, type ToolSet } from "ai";

import { browserMcp, ensureBrowser } from "@/lib/agent/browser";
import { runDevin } from "@/lib/devin-acp";
import { browserTools, type BrowserSession } from "@/lib/agent/browser-tools";
import { openaiProvider, openrouterModel } from "@/lib/ai-usage/clients";
import { noteStreamUsage, noteUsage } from "@/lib/ai-usage/note";
import { tutorBook } from "@/lib/learning/memory";
import { isTutorChatId, saveTutorTranscript, type TranscriptLine } from "@/lib/learning/recall";
import { planReview, startReview, type ReviewTurn } from "@/lib/learning/review";
import {
  DEFAULT_THINKING,
  DEFAULT_TUTOR_MODEL,
  devinModelUid,
  isThinkingLevel,
  migrateTutorModelId,
  tutorModelBackend,
  tutorModelComposer,
  tutorModelGrok,
  tutorModelSupportsAttachments,
  type ThinkingLevel,
  type TutorModelId,
} from "@/lib/tutor-models";
import type { TutorMessagePart } from "@/lib/attachments";
import { TUTOR_ACTION_INSTRUCTIONS } from "@/lib/tutor-actions";
import {
  claudeSkillOptions,
  skillInstructionsForClaude,
  skillInstructionsForTextOnlyBackend,
  WORKSPACE,
} from "@/lib/tutor-skills";
import { TUTOR_DOCUMENT_INSTRUCTIONS } from "@/lib/tutor-documents";
import { TUTOR_GRAPH_INSTRUCTIONS } from "@/lib/tutor-graph";
import { TUTOR_QUIZ_INSTRUCTIONS } from "@/lib/tutor-quiz";
import { encodeEvent, toolDetail, toolLabel, type TutorEvent } from "@/lib/tutor-stream";
import {
  TUTOR_BROWSER_DIR,
  tutorAgentPrompt,
  tutorAiTools,
  tutorClaudeServer,
  tutorCursorTools,
  type TutorToolContext,
} from "@/lib/tutor-tools";

// Streaming keeps the connection alive for long answers instead of
// hitting a request timeout. The CLI-backed models (Claude Code, Cursor)
// spin up a subprocess, so they get more headroom than a plain API call needs.
// A turn that browses takes minutes, not seconds.
export const maxDuration = 600;

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
  /** The conversation's id, so the host can keep a copy to recall and learn from. */
  chatId?: string;
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

/** What one turn does, whichever backend is doing it: the stream out, and what's kept of it. */
interface Emit {
  text(v: string): void;
  reasoning(v: string): void;
  tool(name: string, input: unknown): void;
  toolDone(name: string, ok: boolean): void;
  step(): void;
  error(message: string): void;
}

/** A Cursor tool call's name and input: custom tools and MCP servers both come through as `mcp`. */
function cursorTool(call: { type?: string; args?: Record<string, unknown> } | undefined): { name: string; input: unknown } {
  const args = call?.args ?? {};
  return call?.type === "mcp" ? { name: String(args.toolName ?? "tool"), input: args.args } : { name: String(call?.type ?? "tool"), input: args };
}

/**
 * Grok and Composer run through the local Cursor CLI login instead of an API
 * key, via the official `@cursor/sdk`. They run in agent mode now, with the
 * tutor's own tools and the agents' browser, but the built-in toolset is cut
 * down to the web and a to-do list: no shell and no editing files on the PC,
 * which is what `mode: "plan"` used to guarantee on its own.
 */
async function runCursorAgent(
  modelId: TutorModelId,
  prompt: string,
  images: CursorImage[],
  ctx: TutorToolContext,
  emit: Emit,
  signal: AbortSignal
): Promise<void> {
  const browser = browserMcp(TUTOR_BROWSER_DIR);
  const browserUp = browser ? await ensureBrowser().then(() => true, () => false) : false;
  const agent = await Agent.create({
    model: cursorModelSelection(modelId),
    local: { cwd: WORKSPACE, customTools: tutorCursorTools(ctx) },
    ...(browser && browserUp ? { mcpServers: { browser } } : {}),
    tools: ["mcp", "webSearch", "webFetch", "updateTodos", "readTodos"],
  });
  const run = await agent.send(
    { text: prompt, images: images.length ? images : undefined },
    {
      mode: "agent",
      onDelta: ({ update }) => {
        /*
         * The Cursor agent reports its own thinking and tool use through
         * the same delta channel as the prose, so they are separated
         * here rather than being flattened into the answer — which is
         * what happened before, when only `text-delta` was read and
         * everything else was dropped on the floor.
         */
        const u = update as {
          type: string;
          text?: string;
          toolName?: string;
          name?: string;
          toolCall?: { type?: string; args?: Record<string, unknown>; result?: { error?: unknown; status?: string } };
        };
        if (u.type === "text-delta" && u.text) emit.text(u.text);
        else if ((u.type === "thinking-delta" || u.type === "reasoning-delta") && u.text) emit.reasoning(u.text);
        else if (u.type === "tool-call-started") {
          const call = cursorTool(u.toolCall);
          emit.tool(call.name, call.input);
        } else if (u.type === "tool-call-completed") {
          emit.toolDone(cursorTool(u.toolCall).name, u.toolCall?.result?.error === undefined && u.toolCall?.result?.status !== "error");
        } else if (u.type === "tool-call") emit.tool(u.toolName ?? u.name ?? "tool", undefined);
        else if (u.type === "tool-result") emit.toolDone(u.toolName ?? u.name ?? "tool", true);
      },
    }
  );
  const stop = () => void run.cancel().catch(() => {});
  signal.addEventListener("abort", stop, { once: true });
  const result = await run.wait().finally(() => signal.removeEventListener("abort", stop));
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
    emit.error(result.error?.message ?? "Cursor agent run failed.");
  }
}

/** The conversation as the host keeps it: text only, so attachments are the words pulled out of them. */
function transcriptOf(messages: TutorRequest["messages"], reply: string): TranscriptLine[] {
  const text = (content: string | TutorMessagePart[]) =>
    typeof content === "string" ? content : content.filter((part) => part.type !== "image").map((part) => part.text ?? "").join("\n");
  const clip = (value: string) => (value.length > 6_000 ? `${value.slice(0, 6_000)}…` : value);
  return [
    ...messages.map((m) => ({ who: m.role === "user" ? "Student" : "Tutor", text: clip(text(m.content).trim()), at: Date.now() })),
    { who: "Tutor", text: clip(reply.trim()), at: Date.now() },
  ].filter((line) => line.text);
}

function titleOf(messages: TutorRequest["messages"]): string {
  const first = messages.find((m) => m.role === "user");
  const text = (typeof first?.content === "string" ? first.content : first?.content.find((part) => part.type === "text")?.text ?? "").replace(/\s+/g, " ").trim();
  return text.length > 60 ? `${text.slice(0, 57)}…` : text || "Tutor chat";
}

export async function POST(req: Request) {
  const { messages, context, focus, studentName, model, thinking, chatId }: TutorRequest = await req.json();
  const thinkingLevel: ThinkingLevel = isThinkingLevel(thinking) ? thinking : DEFAULT_THINKING;
  const chat = isTutorChatId(chatId) ? chatId : null;

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
  const hasBrowser = !!browserMcp();

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
    // What it remembers of the student, and what it can do beyond answering.
    tutorAgentPrompt({ browser: hasBrowser }),
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
  const vision = tutorModelSupportsAttachments(modelId);

  return respond(async (send) => {
    const turn = { reply: "", steps: [] as string[], wroteMemory: false, wroteSkill: false, failed: false };
    const emit: Emit = {
      text: (v) => {
        turn.reply += v;
        send({ t: "delta", v });
      },
      reasoning: (v) => send({ t: "reasoning", v }),
      tool: (name, input) => {
        const label = toolLabel(name);
        const detail = toolDetail(name, input);
        turn.steps.push(detail ? `${label}: ${detail}` : label);
        send({ t: "tool", name, label, detail });
      },
      toolDone: (name, ok) => send({ t: "tool_done", name, label: toolLabel(name), ok }),
      step: () => send({ t: "step" }),
      error: (v) => {
        turn.failed = true;
        send({ t: "error", v });
      },
    };
    // Whatever the tutor saves while it answers shows under the reply as it happens.
    const ctx: TutorToolContext = {
      chatId: chat ?? "",
      onLearned: (item) => {
        if (item.kind === "memory") turn.wroteMemory = true;
        else turn.wroteSkill = true;
        send({ t: "learned", items: [item] });
      },
    };

    if (backend === "cursor-agent") {
      const { text, images } = buildCursorPrompt(system, modelMessages);
      await runCursorAgent(modelId, text, images, ctx, emit, req.signal);
    } else if (backend === "devin") {
      // Like Cursor, Devin takes one prompt rather than a conversation; it brings its own web tools.
      const { text, images } = buildCursorPrompt(system, modelMessages);
      await runDevin({
        model: devinModelUid(modelId, thinkingLevel) ?? "adaptive",
        prompt: text,
        images,
        cwd: WORKSPACE,
        signal: req.signal,
        on: emit,
      });
    } else if (backend === "claude-code") {
      const browser = hasBrowser ? browserMcp(TUTOR_BROWSER_DIR) : null;
      const browserUp = browser ? await ensureBrowser().then(() => true, () => false) : false;
      const result = streamText({
        /*
         * Runs through the local Claude Code CLI login — no API key needed.
         *
         * Skills and the sandbox are passed as model *settings*, not as
         * `providerOptions`: that channel carries reasoning options only
         * (`thinking`, `effort`) and silently drops everything else, so
         * configuring the sandbox there left the session with no sandbox at
         * all. See lib/tutor-skills.ts.
         *
         * The tutor's own tools reach the CLI as an in-process MCP server,
         * since it runs its own tool loop and never sees AI SDK tools.
         */
        model: claudeCode(
          modelId,
          claudeSkillOptions({ mcpServers: { slates: tutorClaudeServer(ctx), ...(browser && browserUp ? { browser } : {}) } })
        ),
        system,
        messages: modelMessages,
        providerOptions: {
          "claude-code": { effort: thinkingLevel },
        },
        abortSignal: req.signal,
      });
      noteStreamUsage("tutor", modelId, backend, result.totalUsage);
      await forward(result.fullStream, emit);
    } else {
      // Started on its first use, so a reply that never browses doesn't pay for it.
      const browser: BrowserSession | null = hasBrowser
        ? await browserTools({ outputDir: TUTOR_BROWSER_DIR, images: backend === "openai" && vision })
        : null;
      try {
        const tools: ToolSet = { ...tutorAiTools(ctx), ...(browser?.tools ?? {}) };
        if (backend === "openrouter") {
          const run = (withTools: boolean) => {
            const result = streamText({
              model: openrouterModel(modelId),
              system,
              messages: modelMessages,
              ...(withTools ? { tools, stopWhen: stepCountIs(30) } : {}),
              providerOptions: {
                openrouter: { reasoning: { effort: thinkingLevel } },
              },
              abortSignal: req.signal,
            });
            noteStreamUsage("tutor", modelId, backend, result.totalUsage);
            return result;
          };
          // A model with no tool-calling endpoint on OpenRouter still answers, just without them.
          const outcome = await forward(run(true).fullStream, emit, { retryOnToolRefusal: true });
          if (outcome === "retry") await forward(run(false).fullStream, emit);
        } else {
          const provider = openaiProvider();
          const result = streamText({
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
             *
             * Web search is no longer the only one: the tutor's own tools and
             * the agents' browser ride alongside it.
             */
            tools: { web_search: provider.tools.webSearch({}), ...tools },
            stopWhen: stepCountIs(30),
            providerOptions: {
              /*
               * `reasoningSummary` is what makes the thinking visible. Without
               * it the reasoning models still reason, they just never send any
               * of it, and the panel above the reply has nothing to show.
               */
              openai: { reasoningEffort: thinkingLevel, reasoningSummary: "auto" },
            },
            abortSignal: req.signal,
          });
          noteStreamUsage("tutor", modelId, backend, result.totalUsage);
          await forward(result.fullStream, emit);
        }
      } finally {
        await browser?.close();
      }
    }

    /*
     * The host keeps the conversation so helpers can recall it later, and
     * counts the turn toward a review: a second, small model that reads it
     * afterwards and saves what the tutor didn't. The reply is finished
     * before that starts, so it never waits on it. A turn that failed (a
     * provider's usage limit comes back as text, too) isn't worth either.
     */
    if (chat && turn.reply.trim() && !turn.failed && !req.signal.aborted) {
      const lines = transcriptOf(messages, turn.reply);
      saveTutorTranscript({ id: chat, title: titleOf(messages), lines });
      const review: ReviewTurn = {
        helper: { key: "tutor", name: "Tutor", kind: "tutor" },
        notes: tutorBook(),
        transcript: lines.slice(-16),
        steps: turn.steps,
        wroteMemory: turn.wroteMemory,
        wroteSkill: turn.wroteSkill,
        fromStudent: true,
      };
      const plan = planReview(review);
      if (plan.memory || plan.skills) {
        const id = `rev_${chat}_${Date.now().toString(36)}`;
        startReview(id, review, plan);
        send({ t: "review", id });
      }
    }
    send({ t: "done" });
  });
}

/**
 * One NDJSON response for every backend.
 *
 * An error mid-stream is sent as an event rather than tearing the response
 * down: whatever the tutor already said is worth keeping on screen, and a
 * half-answer with a note beats a blank bubble.
 */
function respond(work: (send: (event: TutorEvent) => void) => Promise<void>): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: TutorEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encodeEvent(event));
        } catch {
          // The page went away; the turn still finishes and is still kept.
          open = false;
        }
      };
      try {
        await work(send);
      } catch (err) {
        send({ t: "error", v: err instanceof Error ? err.message : "The tutor stopped unexpectedly." });
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          // Already closed by the page leaving.
        }
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

/**
 * The model's stream, re-emitted as events the client can tell apart.
 *
 * `toTextStreamResponse()` would forward the prose and drop everything else —
 * the reasoning, the tool calls, the step boundaries — which is exactly the
 * material a student needs to see that something is happening and what.
 *
 * With `retryOnToolRefusal`, a provider saying it can't do tools before
 * anything else has happened is handed back as "retry" instead of shown.
 */
async function forward(parts: AsyncIterable<StreamPart>, emit: Emit, options: { retryOnToolRefusal?: boolean } = {}): Promise<"done" | "retry"> {
  let said = false;
  for await (const part of parts) {
    switch (part.type) {
      case "text-delta":
        if (part.text) {
          said = true;
          emit.text(part.text);
        }
        break;
      case "reasoning-delta":
        if (part.text) emit.reasoning(part.text);
        break;
      case "tool-call":
        said = true;
        emit.tool(part.toolName ?? "tool", part.input);
        break;
      case "tool-result":
      case "tool-error":
        emit.toolDone(part.toolName ?? "tool", part.type === "tool-result");
        break;
      case "finish-step":
        emit.step();
        break;
      case "error": {
        const message = part.error instanceof Error ? part.error.message : String(part.error);
        if (options.retryOnToolRefusal && !said && /tool/i.test(message)) return "retry";
        emit.error(message);
        break;
      }
    }
  }
  return "done";
}

/** Whatever `fullStream` yields — narrowed by the switch above, not here. */
type StreamPart = {
  type: string;
  text?: string;
  toolName?: string;
  input?: unknown;
  error?: unknown;
} & Record<string, unknown>;
