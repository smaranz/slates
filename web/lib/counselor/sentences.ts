import type { LineNote, LineReview } from "./types";

/**
 * Lining a model's sentence-level judgements back up with the draft on screen.
 *
 * The review comes back as a list of sentences the model quoted. To tint the
 * draft itself, each quote has to be found again in the text — and a model
 * quoting prose reliably normalizes it a little: a curly apostrophe becomes
 * straight, an em dash becomes a hyphen, a line break becomes a space. So the
 * matching happens on a normalized copy, and a sentence that still can't be
 * matched is left untinted rather than given a made-up verdict.
 */

/** Punctuation-and-whitespace-insensitive enough to survive a model's quoting. */
function normalize(text: string): string {
  return text
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export interface Span {
  text: string;
  /** Offsets into the original draft, so the text can be rebuilt exactly. */
  start: number;
  end: number;
}

/**
 * Splits a draft into sentences, keeping offsets.
 *
 * Deliberately naive — terminal punctuation plus any closing quote. It splits
 * "Dr. Ramos" in two, which costs a tint on one fragment and nothing else;
 * a real abbreviation list would be more accuracy than this display needs.
 */
export function splitSentences(text: string): Span[] {
  const spans: Span[] = [];
  const re = /[^.!?]*[.!?]+["'’”]?\s*/g;

  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match[0].trim()) {
      spans.push({ text: match[0].trim(), start: match.index, end: match.index + match[0].length });
    }
  }

  // Whatever trails the last full stop — usually the sentence being typed.
  const tailStart = spans.length ? spans[spans.length - 1].end : 0;
  if (tailStart < text.length && text.slice(tailStart).trim()) {
    spans.push({ text: text.slice(tailStart).trim(), start: tailStart, end: text.length });
  }

  return spans;
}

/** How much of a normalized sentence has to agree before it counts as the same one. */
const ENOUGH = 30;

/** The model's judgement of this sentence, or null when it didn't judge it. */
export function noteFor(sentence: string, review: LineReview): LineNote | null {
  const target = normalize(sentence);
  if (!target) return null;

  for (const line of review.lines) {
    const quoted = normalize(line.text);
    if (!quoted) continue;
    if (quoted === target) return line;
    if (target.length >= ENOUGH && quoted.includes(target.slice(0, ENOUGH))) return line;
    if (quoted.length >= ENOUGH && target.includes(quoted.slice(0, ENOUGH))) return line;
  }

  return null;
}

/** Counts per verdict, for the summary line above the draft. */
export function verdictCounts(review: LineReview): { strong: number; okay: number; weak: number } {
  return {
    strong: review.lines.filter((l) => l.verdict === "strong").length,
    okay: review.lines.filter((l) => l.verdict === "okay").length,
    weak: review.lines.filter((l) => l.verdict === "weak").length,
  };
}
