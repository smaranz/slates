import { noteFromUsage } from "@/lib/ai-usage/note";
import { extractText } from "@/lib/attachment-text";
import { claudeLoginProblem, ESSAY_MODEL } from "@/lib/counselor/essay-model";
import { generateText, NoObjectGeneratedError, NoOutputGeneratedError, Output } from "ai";
import { claudeCode } from "ai-sdk-provider-claude-code";
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
   * Text files and PDFs go in as text rather than as an image: the model reads
   * a typed rubric more reliably from characters than from a picture of
   * characters, and Claude Code takes images but not PDF attachments. A PDF
   * with no text layer is a scan, and a photo of it reads better.
   */
  let text: string | null = null;
  if (type.startsWith("text/")) text = new TextDecoder().decode(bytes).slice(0, 40_000);
  else if (type === "application/pdf") {
    try {
      text = await extractText(bytes, "pdf", { chars: 40_000, pages: 20 });
    } catch (err) {
      const why = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return Response.json({ error: `Slates couldn't read that PDF (${why}). A photo of the page works too.` }, { status: 422 });
    }
    if (!text.trim()) {
      return Response.json(
        { error: "That PDF has no readable text, so it's probably a scan. Take a photo of the page instead." },
        { status: 422 }
      );
    }
  }

  try {
    const result = await generateText({
      model: claudeCode(ESSAY_MODEL),
      output: Output.object({ schema: RUBRIC }),
      system,
      providerOptions: { "claude-code": { effort: "medium" } },
      messages: [
        {
          role: "user",
          content: text !== null
            ? [
                { type: "text", text: "The rubric:" },
                { type: "text", text },
              ]
            : [
                { type: "text", text: "Read the rubric in this image." },
                { type: "file", data: new Uint8Array(bytes), mediaType: type },
              ],
        },
      ],
    });
    noteFromUsage("rubric", ESSAY_MODEL, "claude-code", result.usage);

    return Response.json({ rubric: result.output });
  } catch (err) {
    const login = claudeLoginProblem(err, "Reading a rubric");
    if (login) return Response.json({ error: login.message }, { status: 502 });
    if (NoObjectGeneratedError.isInstance(err) || NoOutputGeneratedError.isInstance(err)) {
      console.error(`[rubric] unreadable reply: ${err.message.split("\n")[0]}`);
      return Response.json(
        { error: "The model couldn't turn that into a rubric. A clearer photo of the page usually fixes it." },
        { status: 502 }
      );
    }
    const message = err instanceof Error ? err.message.split("\n")[0] : "Reading that rubric failed.";
    return Response.json({ error: message }, { status: 502 });
  }
}
