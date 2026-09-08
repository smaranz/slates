import type { AiSignal } from "./types";

/**
 * How machine-written a piece of prose reads.
 *
 * A word on what this is not. The obvious build — post the essay to ten free
 * detector sites and average the verdicts — fails for reasons worth writing
 * down, because it looks reasonable right up until you rely on it:
 *
 *   - Those sites have no public API. Reaching them means scraping a form,
 *     which breaks on their next deploy, violates their terms, and puts a
 *     student's unpublished personal statement through ten companies that
 *     never agreed to receive it.
 *   - Averaging does not fix unreliability. The detectors are correlated —
 *     several are the same underlying classifier — so ten scores are not ten
 *     independent measurements, and the mean of ten correlated wrong answers
 *     is a confident wrong answer.
 *   - They are known to misfire on exactly this student. Detectors flag
 *     non-native English writers and formal, carefully edited prose at far
 *     higher rates. A polished essay is the failure case, and a college essay
 *     is polished by definition.
 *
 * So this measures the text directly instead. Every signal below is a real
 * statistic over the student's own words, computed here with no network call,
 * and each one is reported with the number behind it — so the output is
 * something a student can argue with rather than a verdict they must accept.
 *
 * The signals are chosen because they are what actually separates a personal
 * essay from generated prose: variety of rhythm, concrete detail, contractions,
 * and the absence of a specific vocabulary that language models overuse.
 *
 * It is still advisory. It cannot prove authorship, and it is not evidence.
 */

/* ─────────────────────────── tokenizing ─────────────────────────── */

function sentencesOf(text: string): string[] {
  return text
    // Abbreviations would otherwise split a sentence in the middle.
    .replace(/\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e)\./gi, "$1<DOT>")
    .split(/(?<=[.!?])["')\]]?\s+/)
    .map((s) => s.replace(/<DOT>/g, ".").trim())
    .filter((s) => s.length > 1);
}

function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[a-z']+/g) ?? [];
}

export function countWords(text: string): number {
  return (text.trim().match(/\S+/g) ?? []).length;
}

/* ─────────────────────────── vocabulary ─────────────────────────── */

/**
 * Words and phrases language models reach for far more often than people do.
 *
 * Drawn from the register that shows up in generated prose: abstract nouns
 * standing in for detail, and transitions that announce structure rather than
 * carry an idea. None of them is wrong on its own — the signal is density.
 */
const TELLS = [
  "delve", "tapestry", "testament to", "navigate the complexit", "navigating the complexit",
  "in today's", "ever-evolving", "ever-changing", "multifaceted", "myriad",
  "underscore", "showcase", "showcasing", "pivotal", "profound impact",
  "it is important to note", "it's important to note", "it is worth noting",
  "moreover", "furthermore", "in conclusion", "overall,", "in essence",
  "not only", "but also", "serves as a", "plays a crucial role", "plays a vital role",
  "a beacon", "embark", "realm of", "landscape of", "foster a", "fostering",
  "resonate", "resonated deeply", "invaluable", "instill", "instilled in me",
  "meticulous", "unwavering", "steadfast", "profound", "transformative journey",
  "shaped my perspective", "taught me the importance of", "little did i know",
  "from a young age", "sparked my interest", "ignited my passion", "opened my eyes",
];

/** Concrete things: named people, places, numbers, quoted speech. */
function specificityScore(text: string, sentences: string[]): number {
  const properNouns = (text.match(/(?<![.!?]\s)(?<!^)\b[A-Z][a-z]{2,}/g) ?? []).length;
  const numbers = (text.match(/\b\d+(?:[.,]\d+)?\b/g) ?? []).length;
  const quoted = (text.match(/["“][^"”]{4,}["”]/g) ?? []).length;
  const per = (properNouns + numbers * 1.5 + quoted * 2) / Math.max(sentences.length, 1);
  // ~1.2 concrete markers per sentence is a well-grounded personal essay.
  return clamp01(1 - per / 1.2);
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/* ─────────────────────────── the signals ─────────────────────────── */

export function aiSignals(text: string): { signals: AiSignal[]; score: number } {
  const sentences = sentencesOf(text);
  const words = wordsOf(text);
  const signals: AiSignal[] = [];

  if (words.length < 60) {
    return {
      signals: [
        {
          label: "Too short to judge",
          score: 0,
          detail: `${words.length} words. Below about 60 the statistics are noise — this needs a real draft.`,
        },
      ],
      score: 0,
    };
  }

  // 1. Burstiness. People write a nine-word sentence next to a thirty-word one.
  // Generated prose settles into a narrow band and stays there.
  const lengths = sentences.map((s) => (s.match(/\S+/g) ?? []).length);
  const mean = lengths.reduce((a, b) => a + b, 0) / Math.max(lengths.length, 1);
  const sd = Math.sqrt(
    lengths.reduce((sum, n) => sum + (n - mean) ** 2, 0) / Math.max(lengths.length, 1)
  );
  // A coefficient of variation around 0.55+ is comfortably human.
  const burstiness = clamp01(1 - sd / mean / 0.55);
  signals.push({
    label: "Sentence rhythm",
    score: burstiness,
    detail: `Sentences average ${mean.toFixed(1)} words, varying by ±${sd.toFixed(1)}. Human writing swings much more than generated prose.`,
  });

  // 2. Model vocabulary.
  const lower = text.toLowerCase();
  const found = TELLS.filter((t) => lower.includes(t));
  const per1k = (found.length / words.length) * 1000;
  signals.push({
    label: "Model vocabulary",
    score: clamp01(per1k / 6),
    detail: found.length
      ? `${found.length} flagged ${found.length === 1 ? "phrase" : "phrases"}: ${found.slice(0, 6).join(", ")}${found.length > 6 ? "…" : ""}`
      : "None of the usual generated-prose phrasing.",
  });

  // 3. Concrete detail. The strongest signal in a personal essay: a real one
  // is full of names, numbers and specifics only that student could supply.
  const vague = specificityScore(text, sentences);
  const markers =
    (text.match(/(?<![.!?]\s)(?<!^)\b[A-Z][a-z]{2,}/g) ?? []).length +
    (text.match(/\b\d+(?:[.,]\d+)?\b/g) ?? []).length;
  signals.push({
    label: "Concrete detail",
    score: vague,
    detail: `${markers} names, numbers, or quoted moments across ${sentences.length} sentences. Specifics are what a model can't invent for you.`,
  });

  // 4. Contractions. Personal writing uses them; generated prose writes out
  // "do not" and "it is" at a rate that reads like a press release.
  const contractions = (lower.match(/\b\w+'(?:s|t|re|ve|ll|d|m)\b/g) ?? []).length;
  const expandable = (lower.match(/\b(?:do not|does not|did not|it is|i am|cannot|will not|would not|that is|there is|i have|i would)\b/g) ?? []).length;
  const rate = contractions / Math.max(contractions + expandable, 1);
  signals.push({
    label: "Contractions",
    score: clamp01(1 - rate / 0.6),
    detail: `${contractions} contractions against ${expandable} written-out forms. A personal essay usually contracts.`,
  });

  // 5. Sentence openers. Repeating the same opening word is a human habit;
  // never repeating one, across thirty sentences, is not.
  const openers = sentences.map((s) => (s.match(/[A-Za-z']+/) ?? [""])[0].toLowerCase());
  const uniqueOpeners = new Set(openers).size;
  const openerRatio = uniqueOpeners / Math.max(openers.length, 1);
  // Below a dozen sentences every opener being distinct is unremarkable rather
  // than suspicious — there simply hasn't been room to repeat one — so the
  // signal is held at neutral instead of firing on every short draft.
  const enoughSentences = sentences.length >= 12;
  signals.push({
    label: "Sentence openers",
    score: enoughSentences ? clamp01((openerRatio - 0.72) / 0.28) : 0,
    detail: enoughSentences
      ? `${uniqueOpeners} distinct openings across ${openers.length} sentences.`
      : `${uniqueOpeners} distinct openings across ${openers.length} sentences — too few to read anything into.`,
  });

  // 6. Triads and em-dashes. Both are fine; both are used at a rate in
  // generated text that a person rarely sustains.
  const triads = (text.match(/\b\w+,\s+\w+,\s+and\s+\w+/g) ?? []).length;
  const dashes = (text.match(/[—–]|\s-\s/g) ?? []).length;
  const per100 = ((triads * 2 + dashes) / sentences.length) * 100;
  signals.push({
    label: "Triads and dashes",
    score: clamp01(per100 / 60),
    detail: `${triads} "x, y, and z" constructions and ${dashes} dashes in ${sentences.length} sentences.`,
  });

  // Weighted because they are not equally informative. Concrete detail and
  // rhythm carry a real essay; the vocabulary check is the loudest but also
  // the easiest to defeat by swapping a few words, so it counts for less.
  const weights = [0.24, 0.16, 0.28, 0.12, 0.1, 0.1];
  const composite = signals.reduce((sum, s, i) => sum + s.score * weights[i], 0);

  return { signals, score: Math.round(composite * 100) };
}

/** A plain reading of the composite, stated with the uncertainty it deserves. */
export function verdictFor(score: number): string {
  if (score < 25) {
    return "Reads as your own writing. The rhythm varies and the detail is specific enough that a model couldn't have supplied it.";
  }
  if (score < 45) {
    return "Mostly reads as yours, with patches of generic phrasing. Worth tightening, not worth worrying about.";
  }
  if (score < 65) {
    return "Reads flatter than a personal essay should — even if every word is yours. The fixes below are the same ones that would make it a better essay.";
  }
  return "Reads strongly like generated prose: even rhythm, abstract nouns, little that's specific to you. If you wrote it, it still needs the specifics put back in.";
}
