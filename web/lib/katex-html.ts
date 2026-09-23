import katex from "katex";

/**
 * Typeset one expression with the same KaTeX the rest of the app imports.
 *
 * rehype-katex ships its own older KaTeX, and HTML+MathML together is how
 * equations "glitch" when a parent clip or font-feature setting un-hides the
 * MathML copy. HTML only, same version everywhere, no second ghost layer.
 */
export function renderKatexHtml(tex: string, display = false): string {
  return katex.renderToString(tex, {
    throwOnError: false,
    displayMode: display,
    strict: "ignore",
    output: "html",
  });
}
