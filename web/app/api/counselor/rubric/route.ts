import { openaiModel, hasSecret } from "@/lib/ai-usage/clients";
import { noteFromUsage } from "@/lib/ai-usage/note";
import { generateObject, NoObjectGeneratedError } from "ai";
import { z } from "zod";

/**
 * A teacher's rubric, read off a photo or a file.
 *
 * The built-in rubrics cover the essays an application asks for. They do not
 * cover the rubric a history teacher handed out on paper, which is the one a
 * school essay is actually graded against — so a student had the choice of
 * being scored on the wrong criteria or not at all. Point a camera at the
 * handout instead.
 *
 * The output is the same `Rubric` shape the built-in ones use, so nothing
 * downstream needs to know where a rubric came from: the same grading pass,
 * the same rendering, the same criteria panel.
 */

/** Matches `Rubric` in lib/counselor/rubric.ts. */
const RUBRIC = z.object({
  label: z
    .string()
    .min(2)
    .max(60)
    .describe("What this rubric is called, as the document calls it. Title case, no trailing punctuation."),
  criteria: z
    .array(
      z.object({
        name: z
          .string()
          .min(2)
          .max(40)
          .describe("The criterion's name as the document names it — not a paraphrase."),
        detail: z
          .string()
          .min(20)
          .describe(
            "What earns a high score and what earns a low one, written as an instruction to whoever is grading. Use the document's own standards; do not invent thresholds it does not state."
          ),
      })
    )
    .min(2)
    .max(8)
    .describe("Every criterion the document scores, in the order it lists them."),
  note: z
    .string()
    .min(10)
    .describe(
      "One closing line about what this assignment must not do — a length limit, a banned source, a required format. Say 'Nothing specified.' when the document states none."
    ),
});

/*
 * A photo of a handout, plus the reasoning to read a table off it. The page is
 * one image; most of the time goes to the model looking at it.
 */
export const maxDuration = 120;

const MAX_BYTES = 20 * 1024 * 1024;

const READABLE = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/markdown",
]);

export async function POST(req: Request) {
  if (!hasSecret("openai")) {
    return Response.json(
      { error: "No OpenAI key. Link one in AI Usage, or add OPENAI_API_KEY to .env and restart." },
      { status: 500 }
    );
  }

  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!READABLE.has(type)) {
    return Response.json(
      { error: `Slates can't read ${type || "that"}. Use a photo, a PDF, or a text file.` },
      { status: 415 }
    );
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await req.arrayBuffer();
  } catch {
    return Response.json({ error: "Could not read that file." }, { status: 400 });
  }
  if (bytes.byteLength === 0) return Response.json({ error: "That file is empty." }, { status: 400 });
  if (bytes.byteLength > MAX_BYTES) {
    return Response.json({ error: "That file is too large." }, { status: 413 });
  }

  const system = [
    "You are reading a teacher's grading rubric and turning it into structured criteria.",
    "",
    "Transcribe, do not design. Use the document's own criterion names and its own standards, in its own order. If it scores 'Conventions', the criterion is called Conventions — not 'Mechanics & Grammar'.",
    "Do not add a criterion the document does not have, however standard it seems, and do not merge two it lists separately.",
    "If the document gives point values, put them in the detail as the document states them. Never invent a threshold it does not state.",
    "If the image is unreadable or is not a rubric, say so in `label` as 'Unreadable' and return a single criterion explaining what you saw.",
  ].join("\n");

  /*
   * Text files go in as text rather than as an image: the model reads a typed
   * rubric more reliably from characters than from a picture of characters,
   * and it costs a fraction as much.
   */
  const isText = type.startsWith("text/");

  try {
    const result = await generateObject({
      model: openaiModel("gpt-5.6-terra"),
      schema: RUBRIC,
      system,
      maxOutputTokens: 4_000,
      providerOptions: { openai: { reasoningEffort: "medium" } },
      messages: [
        {
          role: "user",
          content: isText
            ? [
                { type: "text", text: "The rubric:" },
                { type: "text", text: new TextDecoder().decode(bytes).slice(0, 40_000) },
              ]
            : [
                { type: "text", text: "Read the rubric in this document." },
                { type: "file", data: new Uint8Array(bytes), mediaType: type },
              ],
        },
      ],
    });
    noteFromUsage("rubric", "gpt-5.6-terra", "openai", result.usage);

    return Response.json({ rubric: result.object });
  } catch (err) {
    if (NoObjectGeneratedError.isInstance(err)) {
      console.error(
        `[rubric] unparseable reply (finish: ${err.finishReason ?? "?"}, out: ${err.usage?.outputTokens ?? "?"} tokens)`
      );
      if (err.usage) noteFromUsage("rubric", "gpt-5.6-terra", "openai", err.usage);
      return Response.json(
        { error: "The model couldn't turn that into a rubric. A clearer photo of the page usually fixes it." },
        { status: 502 }
      );
    }
    const message = err instanceof Error ? err.message.split("\n")[0] : "Reading that rubric failed.";
    return Response.json({ error: message }, { status: 502 });
  }
}
