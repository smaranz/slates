/* Models are split on math delimiters: some emit remark-math's `$$...$$`,
   others (notably OpenAI's) emit LaTeX-style `\(...\)` / `\[...\]`, which
   remark-math doesn't parse. This normalizes the LaTeX pair-delimiters to
   dollars so one renderer handles both — without touching code, where a
   literal `\(` is usually regex or C, not math. */

const FENCE = /^(```|~~~)/;

/* Inline code spans get masked before rewriting so `\(` inside backticks
   survives untouched. NUL sentinels can't appear in model output. */
const INLINE_CODE = /(`+)[^`]*?\1/g;
const NUL = String.fromCharCode(0);
const MASK = new RegExp(NUL + "(\\d+)" + NUL, "g");

const BLOCK_MATH = /\\\[([\s\S]*?)\\\]/g;
const INLINE_MATH = /\\\(([\s\S]*?)\\\)/g;

function rewriteProse(chunk: string): string {
  const masks: string[] = [];
  const masked = chunk.replace(INLINE_CODE, (span) => {
    masks.push(span);
    return NUL + (masks.length - 1) + NUL;
  });

  return masked
    .replace(BLOCK_MATH, (_, tex: string) => `$$${tex}$$`)
    .replace(INLINE_MATH, (_, tex: string) => `$$${tex}$$`)
    .replace(MASK, (_, i: string) => masks[Number(i)] ?? "");
}

export function normalizeMathDelimiters(markdown: string): string {
  /* Fast path: nothing that looks like a LaTeX delimiter, hand it back. */
  if (!markdown.includes("\\(") && !markdown.includes("\\[")) return markdown;

  const lines = markdown.split("\n");
  const out: string[] = [];
  let inFence = false;

  /* Display math spans lines, so rewriting happens on whole prose runs
     between fences rather than line-by-line. Unpaired delimiters (a `\[`
     still streaming in) stay literal until their closer arrives. */
  let run: string[] = [];
  const flush = () => {
    if (run.length === 0) return;
    out.push(rewriteProse(run.join("\n")));
    run = [];
  };

  for (const line of lines) {
    if (FENCE.test(line.trimStart())) {
      flush();
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    run.push(line);
  }
  flush();

  return out.join("\n");
}
