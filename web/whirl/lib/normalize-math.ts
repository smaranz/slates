// Code regions (fenced blocks and inline spans) must never be rewritten, so
// we split on them and only transform the prose in between.
const CODE_REGION = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g;

// Existing $$...$$ math is protected the same way while we look at single-$.
const DOLLAR_MATH_REGION = /(\$\$[^$]*?\$\$)/g;

/* [\s\S] instead of the dotAll flag — v2's tsconfig targets pre-es2018. */
const PAREN_MATH = /\\\(([\s\S]+?)\\\)/g;
const BRACKET_MATH = /\\\[([\s\S]+?)\\\]/g;
const SINGLE_DOLLAR = /\$([^$\n]+?)\$/g;

/**
 * Whether the inside of a single-dollar pair reads as math rather than prose
 * with two prices in it ("$5 and $10"). Deliberately strict: LaTeX commands,
 * relations/scripts, or a full arithmetic expression — never a bare number or
 * something that starts/ends with whitespace (TeX wouldn't accept it either).
 */
function looksLikeMath(tex: string): boolean {
  if (/^\s|\s$/.test(tex)) return false;
  return (
    /\\[a-zA-Z]/.test(tex) ||
    /[=^_]/.test(tex) ||
    // digits joined by at least one operator, e.g. "3+5" or "12 * 9"
    /^[\d.,]+(?:\s*[+\-*/×÷]\s*[\d.,()]+)+$/.test(tex)
  );
}

function convertSingleDollars(prose: string): string {
  return prose
    .split(DOLLAR_MATH_REGION)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(SINGLE_DOLLAR, (match, tex: string) =>
            looksLikeMath(tex) ? `$$${tex}$$` : match,
          ),
    )
    .join("");
}

/**
 * Models slip out of the $$...$$ delimiters they're told to use — into
 * \(...\)/\[...\] (not parsed at all) or single-dollar pairs like
 * "$3 + 5 = 8$" (kept as plain text so prices stay prices). Rewrite the
 * slips that are unambiguously math to $$...$$ outside of code, so they
 * still typeset — inline and inside table cells alike.
 */
export function normalizeMathDelimiters(content: string): string {
  if (
    !content.includes("\\(") &&
    !content.includes("\\[") &&
    !content.includes("$")
  ) {
    return content;
  }
  return content
    .split(CODE_REGION)
    .map((part, i) => {
      // Odd indices are the captured code regions; leave them untouched.
      if (i % 2 === 1) return part;
      return convertSingleDollars(
        part
          .replace(PAREN_MATH, (_, tex: string) => `$$${tex}$$`)
          .replace(BRACKET_MATH, (_, tex: string) => `$$${tex}$$`),
      );
    })
    .join("");
}
