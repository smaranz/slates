/**
 * Shared maths plumbing for every surface that shows student-facing text.
 *
 * The tutor is told to write LaTeX in `$…$` / `$$…$$`. Chat and documents
 * already go through KaTeX; quizzes, assignment write-ups, and review stems
 * were dumping the dollars as literal characters. Schoology also uses
 * MathJax's `\(` `\)` delimiters, and a model writing LaTeX inside quiz JSON
 * often forgets to double the backslashes — `\triangle` is the worst of those
 * because JSON treats `\t` as a tab, so the triangle silently becomes a tab
 * plus "riangle" and the rest of the quiz still parses.
 */

export type MathPart =
  | { type: "text"; value: string }
  | { type: "math"; value: string; display: boolean };

/**
 * LaTeX control words whose first letter is also a JSON escape (`\b` `\f`
 * `\n` `\r` `\t`). Used when repairing quiz/graph JSON the model forgot to
 * double-escape, and when restoring those escapes after a successful parse
 * already ate them.
 */
const LATEX_AFTER_JSON_ESCAPE: Record<string, string[]> = {
  t: ["riangle", "heta", "imes", "an", "ext", "au", "herefore", "ilde", "o"],
  n: ["eq", "abla", "otin", "u", "eg", "ot"],
  b: ["eta", "ar", "inom"],
  r: ["ho", "ightarrow", "angle", "floor"],
  f: ["rac", "orall", "loor"],
};

const JSON_ESCAPES = new Set(["\"", "\\", "/", "b", "f", "n", "r", "t", "u"]);

/** Macros a model writes as English inside maths mode (`$triangle ABC$`). */
const BARE_MACROS = [
  "triangle",
  "approx",
  "circ",
  "infty",
  "pm",
  "leq",
  "geq",
  "neq",
  "cdot",
  "times",
  "theta",
  "alpha",
  "beta",
  "gamma",
  "delta",
  "pi",
  "sin",
  "cos",
  "tan",
  "sec",
  "csc",
  "cot",
  "log",
  "ln",
];

function isWordBoundary(ch: string | undefined): boolean {
  return ch === undefined || !/[A-Za-z]/.test(ch);
}

function looksLikeLatexCommand(raw: string, slashAt: number): boolean {
  const first = raw[slashAt + 1];
  const tails = first ? LATEX_AFTER_JSON_ESCAPE[first] : undefined;
  if (!tails) return false;
  const rest = raw.slice(slashAt + 2);
  return tails.some((tail) => rest.startsWith(tail) && isWordBoundary(rest[tail.length]));
}

/**
 * Makes quiz/graph JSON parseable when the model wrote `\frac` instead of
 * `\\frac`. Valid JSON escapes that are not the start of a LaTeX command
 * (`\n` before "Then", a real `\t` before "world") are left alone.
 */
export function escapeBareLatexInJson(raw: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    const next = raw[i + 1];

    if (!inString) {
      out += c;
      if (c === '"') inString = true;
      continue;
    }

    if (escaped) {
      out += c;
      escaped = false;
      continue;
    }

    if (c === "\\") {
      if (next === undefined) {
        out += "\\\\";
        continue;
      }
      if (next === "u" && /^[0-9a-fA-F]{4}/.test(raw.slice(i + 2, i + 6))) {
        out += c;
        escaped = true;
        continue;
      }
      if (next === '"' || next === "\\") {
        out += c;
        escaped = true;
        continue;
      }
      if (looksLikeLatexCommand(raw, i)) {
        out += "\\\\";
        continue;
      }
      if (JSON_ESCAPES.has(next)) {
        out += c;
        escaped = true;
        continue;
      }
      // `\circ`, `\approx`, `\(` — not valid JSON, so the parse would throw.
      out += "\\\\";
      continue;
    }

    if (c === '"') inString = false;
    out += c;
  }

  return out;
}

/**
 * Puts back control words that JSON.parse already ate (`\triangle` → tab +
 * "riangle"). Existing chats in localStorage were parsed that way; rendering
 * has to undo it or those quizzes stay broken forever.
 */
/**
 * The character JSON.parse produced, plus the rest of the control word.
 * Written as string pairs rather than regex so `\b` is a backspace — in a
 * regex it would be a word boundary and `\beta` would rewrite every "eta".
 *
 * Short leftovers that collide with ordinary prose (`\nu` → newline + "use",
 * `\to` → tab + "option") are not restored; those only get fixed on parse.
 */
const EATEN_LATEX: Array<[string, string]> = [
  ["\triangle", "\\triangle"],
  ["\therefore", "\\therefore"],
  ["\theta", "\\theta"],
  ["\times", "\\times"],
  ["\text", "\\text"],
  ["\tilde", "\\tilde"],
  ["\tau", "\\tau"],
  ["\tan", "\\tan"],
  ["\frac", "\\frac"],
  ["\forall", "\\forall"],
  ["\neq", "\\neq"],
  ["\nabla", "\\nabla"],
  ["\notin", "\\notin"],
  ["\neg", "\\neg"],
  ["\beta", "\\beta"],
  ["\binom", "\\binom"],
  ["\bar", "\\bar"],
  ["\rightarrow", "\\rightarrow"],
  ["\rangle", "\\rangle"],
  ["\rho", "\\rho"],
];

export function restoreEatenLatex(text: string): string {
  let s = text;
  for (const [from, to] of EATEN_LATEX) s = s.split(from).join(to);
  return s;
}

function convertDelimiters(text: string): string {
  return text
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, body: string) => `$${body}$`)
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, body: string) => `$$${body}$$`);
}

/**
 * Fixes the macros a model writes as English once it's already inside maths
 * mode — `$triangle ABC$`, `$40^circ$`, `$m^(2)$`.
 */
export function normalizeLatex(tex: string): string {
  let s = tex.trim();
  s = s.replace(/\^\((\d+)\)/g, "^{$1}");
  s = s.replace(/\^circ\b/g, "^\\circ");
  for (const name of BARE_MACROS) {
    s = s.replace(new RegExp(`(?<!\\\\)\\b${name}\\b`, "g"), `\\${name}`);
  }
  return s;
}

/**
 * What to do with a `$…$` span.
 *
 * - `math` — typeset it.
 * - `raw` — leave the source alone, dollars and all. `$5 and $10` is money.
 * - `plain` — drop the delimiters and keep the contents as ordinary prose.
 *
 * That last verdict exists because a model writes `$87\%$` constantly, and
 * typesetting it is worse than leaving it alone: KaTeX sets the number in
 * Computer Modern at a slightly different size and baseline, so a percentage
 * mid-sentence visibly jumps out of the paragraph it belongs to. Nothing is
 * gained — there is no notation in "87%" to render — and the reply ends up
 * looking like a maths worksheet when it was a sentence about a grade.
 *
 * Only the genuinely inert cases qualify: a bare number, optionally signed,
 * with thousands separators or a decimal, and optionally a percent sign.
 * Anything with an operator, exponent, brace, or letter is real notation and
 * is still typeset.
 */
type MathVerdict = "math" | "raw" | "plain";

/** A number, maybe signed, maybe with separators, maybe a percent. Nothing else. */
const INERT = /^[+-]?\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*(?:\\?%)?$|^[+-]?\d+(?:\.\d+)?\s*(?:\\?%)?$/;

function verdictFor(content: string, display: boolean): MathVerdict {
  if (display) return "math";
  const body = content.trim();
  if (!body) return "raw";
  if (/\band\b/i.test(body) && !/[\\^_={}+\-*/]/.test(body)) return "raw";
  if (INERT.test(body)) return "plain";
  return "math";
}

/** `87\%` reads as `87%` once it is no longer maths. */
function unescapeForProse(body: string): string {
  return body.trim().replace(/\\([%$&#_])/g, "$1");
}

function splitMathRaw(text: string): MathPart[] {
  const parts: MathPart[] = [];
  const re = /\$\$([\s\S]+?)\$\$|(?<!\\)\$(?!\$)((?:\\.|[^$\n])+?)\$(?!\$)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index > last) parts.push({ type: "text", value: text.slice(last, match.index) });
    const display = match[1] != null;
    const body = display ? match[1] : match[2];
    const verdict = verdictFor(body, display);
    if (verdict === "math") {
      parts.push({ type: "math", value: body, display });
    } else if (verdict === "plain") {
      parts.push({ type: "text", value: unescapeForProse(body) });
    } else {
      parts.push({ type: "text", value: match[0] });
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  if (!parts.length) parts.push({ type: "text", value: text });
  return parts;
}

/** Split text into prose and maths, with delimiters and macros already fixed. */
export function mathParts(text: string): MathPart[] {
  return splitMathRaw(convertDelimiters(restoreEatenLatex(text))).map((part) =>
    part.type === "math" ? { ...part, value: normalizeLatex(part.value) } : part
  );
}

/**
 * The same fixes as `mathParts`, joined back into markdown so remark-math
 * sees ordinary `$…$` / `$$…$$` and nothing else.
 */
export function prepareMathMarkdown(text: string): string {
  return mathParts(text)
    .map((part) => {
      if (part.type === "text") {
        // A leftover `$` — streaming, or a price we refused to typeset —
        // must not be visible to remark-math, or it opens a span that eats
        // the rest of the reply until the next dollar arrives.
        return part.value.replace(/(?<!\\)\$/g, "\\$");
      }
      // remark-math only treats `$$` as a display block when it sits on its
      // own lines. Mid-sentence `$$…$$` becomes cramped inline maths.
      return part.display ? `\n\n$$\n${part.value}\n$$\n\n` : `$${part.value}$`;
    })
    .join("");
}

/** Schoology / MathJax leftovers that auto-render will not see as delimiters. */
export function prepareMathHtml(html: string): string {
  return html
    .replace(
      /<script[^>]*type="math\/tex;\s*mode=display"[^>]*>([\s\S]*?)<\/script>/gi,
      (_m, tex: string) => `$$${tex}$$`
    )
    .replace(/<script[^>]*type="math\/tex"[^>]*>([\s\S]*?)<\/script>/gi, (_m, tex: string) => `$${tex}$`);
}
