/**
 * A tiny markdown-it plugin that tokenizes `$$…$$` math so it survives the
 * markdown → HTML → TipTap pipeline. It deliberately does NOT render KaTeX here;
 * it only preserves the raw LaTeX on a placeholder element (`data-latex`), which
 * the {@link InlineMath}/{@link BlockMath} TipTap nodes then ingest via parseDOM
 * and render with a NodeView. Block math is a `$$…$$` that owns its whole line;
 * any other `$$…$$` inside text is inline. Single `$` is left alone (so prices
 * stay prices), matching how the chat renderer treats math.
 *
 * The instance markdown-it hands us is reused across every parse, so
 * registration is guarded to run exactly once per instance.
 *
 * markdown-it's parser-state internals aren't worth fully typing for two small
 * rules, so the rule callbacks take the state structurally as `any`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

type MarkdownItLike = {
  inline: { ruler: { after: (name: string, rule: string, fn: any) => void } };
  block: {
    ruler: {
      after: (name: string, rule: string, fn: any, opts?: unknown) => void;
    };
  };
  renderer: { rules: Record<string, (tokens: any[], idx: number) => string> };
  utils: { escapeHtml: (s: string) => string };
};

/** Inline `$$…$$` within a line of text → an `inline-math` placeholder span. */
function mathInline(state: any, silent: boolean): boolean {
  const { src, pos, posMax } = state;
  if (src.charCodeAt(pos) !== 0x24 || src.charCodeAt(pos + 1) !== 0x24) {
    return false;
  }
  let end = pos + 2;
  while (end < posMax) {
    if (src.charCodeAt(end) === 0x24 && src.charCodeAt(end + 1) === 0x24) break;
    end += 1;
  }
  if (end >= posMax) return false; // no closing $$ on this run
  const content = src.slice(pos + 2, end);
  if (!content.trim()) return false; // empty `$$$$`
  if (!silent) {
    const token = state.push("math_inline", "math", 0);
    token.markup = "$$";
    token.content = content;
  }
  state.pos = end + 2;
  return true;
}

/** A `$$…$$` block that owns its line(s) → a `block-math` placeholder div. */
function mathBlock(
  state: any,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  let pos = state.bMarks[startLine] + state.tShift[startLine];
  let max = state.eMarks[startLine];
  if (pos + 2 > max) return false;
  if (state.src.slice(pos, pos + 2) !== "$$") return false;
  pos += 2;

  let firstLine = state.src.slice(pos, max);
  if (silent) return true;

  let found = false;
  if (firstLine.trim().endsWith("$$")) {
    firstLine = firstLine.trim().replace(/\$\$\s*$/, "");
    found = true;
  }

  let nextLine = startLine;
  let lastLine = "";
  while (!found) {
    nextLine += 1;
    if (nextLine >= endLine) break;
    pos = state.bMarks[nextLine] + state.tShift[nextLine];
    max = state.eMarks[nextLine];
    if (pos < max && state.tShift[nextLine] < state.blkIndent) break;
    const lineText = state.src.slice(pos, max).trim();
    if (lineText.endsWith("$$")) {
      const lastPos = state.src.slice(0, max).lastIndexOf("$$");
      lastLine = state.src.slice(pos, lastPos);
      found = true;
    }
  }

  // No closing `$$` — leave it as a normal paragraph rather than swallowing the
  // rest of the document. This keeps a half-written `$$…` readable as it streams
  // in, snapping to a rendered formula only once the closing `$$` lands.
  if (!found) return false;

  state.line = nextLine + 1;
  const token = state.push("math_block", "math", 0);
  token.block = true;
  token.content =
    (firstLine.trim() ? `${firstLine}\n` : "") +
    state.getLines(startLine + 1, nextLine, state.tShift[startLine], true) +
    (lastLine.trim() ? lastLine : "");
  token.map = [startLine, state.line];
  token.markup = "$$";
  return true;
}

/**
 * Register the `$$…$$` math rules on a markdown-it instance, once. Adds the two
 * tokenizer rules plus renderers that emit LaTeX-carrying placeholder elements.
 */
export function registerMathParsing(md: MarkdownItLike): void {
  const flagged = md as MarkdownItLike & { __whirlMath?: boolean };
  if (flagged.__whirlMath) return;
  flagged.__whirlMath = true;

  md.inline.ruler.after("escape", "math_inline", mathInline);
  md.block.ruler.after("blockquote", "math_block", mathBlock, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });

  md.renderer.rules.math_inline = (tokens, idx) =>
    `<span data-type="inline-math" data-latex="${md.utils.escapeHtml(
      tokens[idx].content.trim(),
    )}"></span>`;
  md.renderer.rules.math_block = (tokens, idx) =>
    `<div data-type="block-math" data-latex="${md.utils.escapeHtml(
      tokens[idx].content.trim(),
    )}"></div>\n`;
}
