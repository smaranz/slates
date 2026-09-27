import { noteFromUsage } from "@/lib/ai-usage/note";
import { generateText, NoObjectGeneratedError, NoOutputGeneratedError, Output } from "ai";
import { claudeCode } from "ai-sdk-provider-claude-code";
import type { z } from "zod";

/**
 * The model behind every piece of essay feedback: Claude Opus 5.5.
 *
 * One pin, one place. The rubric review, the line-by-line read and the single
 * sentence re-check all come through here, so they can't drift apart — a
 * student who gets a 17/25 from one pass and a contradictory note from another
 * has no way to tell which to believe, and "whichever key happened to be set"
 * is not an answer.
 *
 * It runs through the Claude Code login on the computer that hosts Slates, so
 * there is no API key and no per-call cost. It was GPT-5.6 Terra for a while,
 * after that login once hit its monthly spend limit mid-essay; if that happens
 * again, the error names the login rather than failing silently.
 *
 * AI *detection* is unaffected and deliberately separate: that runs on MELD,
 * locally, and no model in this file ever sees it (lib/counselor/detector.ts).
 */

export const ESSAY_MODEL = "claude-opus-5-5";

/**
 * Medium effort.
 *
 * A 650-word essay is forty-odd sentences, each needing a note and often
 * steps, and the route has to answer inside its ceiling. What these passes ask
 * for is close reading, which more depth doesn't materially improve.
 */
const OPTIONS = { "claude-code": { effort: "medium" } } as const;

/** Claude Code's own wording when its login is missing or spent. */
export function claudeLoginProblem(err: unknown, what: string): Error | null {
  const message = err instanceof Error ? err.message.split("\n")[0]! : String(err);
  if (/not logged in|unauthor|authentication|no api key|credit balance|usage limit|spend limit|command not found|ENOENT/i.test(message)) {
    return new Error(
      `${what} runs on Claude Opus 5.5 through the Claude Code login on the computer that runs Slates, and it isn't available (${message}). Run \`claude\` there to sign in, then try again.`
    );
  }
  return null;
}

/**
 * One structured answer from the essay model.
 *
 * Structured output through `generateText` + `Output.object`: the Claude Code
 * provider exposes the Agent SDK's constrained decoding that way and rejects
 * the schema-less JSON path `generateObject` would otherwise take.
 *
 * A parse failure is retried once. `maxRetries` covers transport errors, not a
 * reply that arrived and didn't fit the schema, so a single bad roll used to
 * reach the student as "could not parse the response", with their essay
 * unreviewed and nothing to do but press the button again. That is a retry the
 * code can do on their behalf.
 */
export async function essayObject<T extends z.ZodType>(
  schema: T,
  system: string,
  prompt: string
): Promise<z.infer<T>> {
  const run = async () => {
    const result = await generateText({
      model: claudeCode(ESSAY_MODEL),
      output: Output.object({ schema }),
      system,
      prompt,
      providerOptions: OPTIONS,
    });
    noteFromUsage("essay", ESSAY_MODEL, "claude-code", result.usage);
    return result.output as z.infer<T>;
  };
  const unreadable = (err: unknown) => NoObjectGeneratedError.isInstance(err) || NoOutputGeneratedError.isInstance(err);

  try {
    return await run();
  } catch (err) {
    const login = claudeLoginProblem(err, "Essay feedback");
    if (login) throw login;
    if (!unreadable(err)) throw err;

    // Logged rather than swallowed: without the reason, a recurrence is unattributable.
    console.error(`[essay] unreadable reply, retrying once: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
    try {
      return await run();
    } catch (retryErr) {
      if (!unreadable(retryErr)) throw claudeLoginProblem(retryErr, "Essay feedback") ?? retryErr;
      throw new Error(
        "The model's reply couldn't be read as a report, twice. This is usually a one-off — try again, " +
          "and if it keeps happening the draft may be long enough to split in half."
      );
    }
  }
}
