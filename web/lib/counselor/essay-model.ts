import { openaiModel, hasSecret } from "@/lib/ai-usage/clients";
import { noteFromUsage } from "@/lib/ai-usage/note";
import { generateObject, NoObjectGeneratedError } from "ai";
import type { z } from "zod";

/**
 * The model behind every piece of essay feedback: GPT-5.6 Terra.
 *
 * One pin, one place. The rubric review, the line-by-line read and the single
 * sentence re-check all come through here, so they can't drift apart — a
 * student who gets a 17/25 from one pass and a contradictory note from another
 * has no way to tell which to believe, and "whichever key happened to be set"
 * is not an answer.
 *
 * This was Claude Sonnet 5 through the local Claude Code login, which worked
 * well and cost nothing per call; it moved to Terra because that login hit its
 * monthly spend limit mid-essay, and feedback a student is waiting on cannot
 * depend on a budget resetting at 2am. Terra uses the active OpenAI key from
 * AI Usage (or OPENAI_API_KEY), the same key the tutor's GPT models use.
 *
 * AI *detection* is unaffected and deliberately separate: that runs on MELD,
 * locally, and no model in this file ever sees it (lib/counselor/detector.ts).
 */

export const ESSAY_MODEL = "gpt-5.6-terra";

/**
 * Medium reasoning effort.
 *
 * A 650-word essay is forty-odd sentences, each needing a note and often
 * steps, and the route has to answer inside its ceiling. What these passes ask
 * for is close reading, which more depth doesn't materially improve.
 */
const OPTIONS = { openai: { reasoningEffort: "medium" } } as const;

/*
 * Room for the longest answer these passes produce.
 *
 * The line-by-line read returns one entry per sentence, so a 1,200-word draft
 * is 120 objects of note-and-steps — and on a reasoning model the thinking
 * comes out of the same budget. Left to the provider default, a long essay can
 * run out mid-array, and half a JSON document fails to parse with no hint that
 * length was the reason.
 */
const MAX_OUTPUT = 16_000;

/**
 * One structured answer from the essay model.
 *
 * Back to `generateObject` now that this is a normal API provider — the
 * `generateText` + `Output` shape was there because the Claude Code provider
 * exposes the Agent SDK's constrained decoding that way and rejects the
 * schema-less JSON path `generateObject` would otherwise take.
 *
 * A parse failure is retried once. `generateObject` does not retry these
 * itself — `maxRetries` covers transport errors, not a reply that arrived and
 * didn't fit the schema — so a single bad roll used to reach the student as
 * "No object generated: could not parse the response", with their essay
 * unreviewed and nothing to do but press the button again. That is a retry the
 * code can do on their behalf.
 */
export async function essayObject<T extends z.ZodType>(
  schema: T,
  system: string,
  prompt: string
): Promise<z.infer<T>> {
  if (!hasSecret("openai")) {
    throw new Error("No OpenAI key. Link one in AI Usage, or add OPENAI_API_KEY to .env and restart.");
  }

  const run = async (maxOutputTokens: number) => {
    const result = await generateObject({
      model: openaiModel(ESSAY_MODEL),
      schema,
      system,
      prompt,
      maxOutputTokens,
      providerOptions: OPTIONS,
    });
    noteFromUsage("essay", ESSAY_MODEL, "openai", result.usage);
    return result.object as z.infer<T>;
  };

  try {
    return await run(MAX_OUTPUT);
  } catch (err) {
    if (!NoObjectGeneratedError.isInstance(err)) throw err;

    // Logged rather than swallowed: `finishReason` is how you tell a truncated
    // answer from a refusal from a model that simply wrote prose, and without
    // it a recurrence is unattributable.
    console.error(
      `[essay] unparseable reply (finish: ${err.finishReason ?? "?"}, ` +
        `out: ${err.usage?.outputTokens ?? "?"} tokens). Retrying once.`,
      err.text ? `Tail: ${err.text.slice(-200)}` : "No text returned."
    );
    if (err.usage) noteFromUsage("essay", ESSAY_MODEL, "openai", err.usage);

    try {
      // Twice the room when it ran out of room; otherwise the same call, since
      // an unparseable answer is usually just a bad roll.
      return await run(err.finishReason === "length" ? MAX_OUTPUT * 2 : MAX_OUTPUT);
    } catch (retryErr) {
      if (!NoObjectGeneratedError.isInstance(retryErr)) throw retryErr;
      if (retryErr.usage) noteFromUsage("essay", ESSAY_MODEL, "openai", retryErr.usage);
      throw new Error(
        "The model's reply couldn't be read as a report, twice. This is usually a one-off — try again, " +
          "and if it keeps happening the draft may be long enough to split in half."
      );
    }
  }
}
