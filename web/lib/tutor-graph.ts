import { z } from "zod";

import { escapeBareLatexInJson } from "./math-text";

/**
 * A graph the tutor plotted with Desmos — asked for directly in chat, folded
 * into a study guide, or attached to a graphing question in a quiz. One shape
 * everywhere it shows up, since it's the same `DesmosGraph` embed underneath.
 */
export interface TutorGraph {
  title?: string;
  /** Desmos expression strings — "y=x^2-4", "x^2+y^2=25", "y=2x+1", etc. */
  expressions: string[];
}

export const TutorGraphSchema = z.object({
  title: z.string().optional(),
  expressions: z.array(z.string().min(1)).min(1).max(12),
});

export const TUTOR_GRAPH_INSTRUCTIONS = `
When a graph would actually help — the student asks for one, a practice
question is about reading or sketching a graph, or a study guide's topic is
easier to understand plotted than described — draw it yourself with Desmos
instead of describing what it would look like. Put it in exactly one block,
on its own lines, in this form (the block itself is invisible to the student
— never mention it or describe its syntax):
  [[graph title="y = x^2 - 4"]]
  {"expressions":["y=x^2-4","y=0"]}
  [[/graph]]
Requirements: valid JSON, no comments or trailing commas. Each entry in
"expressions" is one Desmos expression string — a function ("y=2x+1"), a
relation ("x^2+y^2=25"), or a point ("(3,4)") — written the way you'd type it
into Desmos, not LaTeX. Up to 12 expressions in one graph. This block can
also appear inside a [[doc]] document's body, wherever the graph belongs in
the text, and inside a quiz question's JSON as that question's own "graph"
field (same {"expressions":[...]} shape) — use whichever fits what's being
built.
`.trim();

const BLOCK_RE = /\[\[graph(?:\s+title="([^"]*)")?\]\]([\s\S]*?)\[\[\/graph\]\]/;
const GLOBAL_BLOCK_RE = /\[\[graph(?:\s+title="([^"]*)")?\]\]([\s\S]*?)\[\[\/graph\]\]/g;
const TRAILING_OPEN_RE = /\[\[graph(?:\s+title="[^"]*")?\]\][\s\S]*$/;

function toGraph(title: string | undefined, raw: string): TutorGraph | null {
  try {
    const parsed = TutorGraphSchema.parse(JSON.parse(escapeBareLatexInJson(raw)));
    return { ...parsed, title: parsed.title ?? title?.trim() };
  } catch {
    return null;
  }
}

/** Hides a graph block — complete or still streaming in — from what the student reads. */
export function stripTutorGraph(text: string): string {
  return text.replace(GLOBAL_BLOCK_RE, "").replace(TRAILING_OPEN_RE, "").trimEnd();
}

/**
 * Full parse for a top-level chat reply, run once it finishes streaming. A
 * block that fails to parse is left in place rather than silently dropped —
 * losing a graph the student asked for is worse than showing the raw block.
 */
export function parseTutorGraph(text: string): { clean: string; graph: TutorGraph | null } {
  const match = BLOCK_RE.exec(text);
  if (!match) return { clean: text, graph: null };

  const graph = toGraph(match[1], match[2]);
  if (!graph) return { clean: text, graph: null };

  return { clean: (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim(), graph };
}

export type DocumentBlock = { type: "text"; value: string } | { type: "graph"; graph: TutorGraph };

/**
 * A finished document's body can carry graph blocks mid-text — this doesn't
 * need the streaming dance `parseTutorGraph` does, because the whole document
 * (graphs and all) is already hidden as one unit by `stripTutorDocument`
 * until it closes. Splits the body into the plain-markdown and graph pieces,
 * in order, so `DocumentCard` can render each with the right component.
 */
export function splitDocumentGraphs(body: string): DocumentBlock[] {
  const blocks: DocumentBlock[] = [];
  let cursor = 0;

  for (const match of body.matchAll(GLOBAL_BLOCK_RE)) {
    const graph = toGraph(match[1], match[2]);
    if (!graph) continue;

    if (match.index > cursor) {
      const pre = body.slice(cursor, match.index);
      if (pre.trim()) blocks.push({ type: "text", value: pre });
    }
    blocks.push({ type: "graph", graph });
    cursor = match.index + match[0].length;
  }

  if (cursor < body.length) {
    const rest = body.slice(cursor);
    if (rest.trim() || !blocks.length) blocks.push({ type: "text", value: rest });
  }

  return blocks;
}
