import type { ComposerModel } from "./models";

/* One matcher behind every model search: the picker's catalog list, the
   settings list, and the command palette.

   Predictable, not fuzzy. We normalize the *shape* of a name rather than
   guess at typos, so "GPT-4", "GPT 4" and "gpt4" all land on GPT-4 while
   "gtp4" still finds nothing. Model names are a mess of punctuation nobody
   reproduces faithfully — dots in "3.5", slashes in "openai/gpt-4",
   dashes in "gpt-4o-mini" — and a search that demands the exact glyph is
   a search that pretends the model doesn't exist. */

/** Punctuation inside a model name carries no meaning for search — to
 *  anyone typing, "GPT-4", "GPT 4" and "gpt/4" are the same query. */
const SEPARATORS = /[\s\-_./\:+,()[\]]+/g;
const DIACRITICS = /[\u0300-\u036f]/g;

/** Lowercase, drop accents, flatten every run of punctuation to one space. */
export function foldText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .replace(SEPARATORS, " ")
    .trim();
}

/** The same text with the spaces closed up, so a run-together "gpt4"
 *  still reaches "GPT-4" and "claude45" reaches "Claude 4.5". */
const squash = (folded: string) => folded.replace(/ /g, "");

/* Tiers, best first. The gaps are wide enough that a strong hit on a
   weak field still outranks a weak hit on a strong one. */
const EXACT = 100;
const SQUASHED_EXACT = 95;
const PREFIX = 85;
const WORD_PREFIX = 70;
const SQUASHED_PREFIX = 60;
const SUBSTRING = 45;
const SQUASHED_SUBSTRING = 35;
const ALL_TERMS = 25;
const NO_MATCH = 0;

/** How well one string answers a query, 0 for not at all. */
export function scoreText(haystack: string, query: string): number {
  const text = foldText(haystack);
  const needle = foldText(query);
  if (!needle || !text) return NO_MATCH;

  if (text === needle) return EXACT;

  const squashedText = squash(text);
  const squashedNeedle = squash(needle);
  /* "gpt4" names GPT-4 as surely as "gpt 4" does, so it must not lose to
     GPT-4o merely starting the same way. */
  if (squashedText === squashedNeedle) return SQUASHED_EXACT;

  if (text.startsWith(needle)) return PREFIX;

  /* "sonnet" should find "Claude Sonnet 4.5" — typing the distinctive
     word beats typing the maker's name first. */
  const words = text.split(" ");
  if (words.some((word) => word.startsWith(needle))) return WORD_PREFIX;

  if (squashedText.startsWith(squashedNeedle)) return SQUASHED_PREFIX;
  if (text.includes(needle)) return SUBSTRING;
  if (squashedText.includes(squashedNeedle)) return SQUASHED_SUBSTRING;

  /* Last resort: every word typed turns up somewhere, in any order, so
     "sonnet claude" still finds Claude Sonnet. Single words already had
     their chance above. */
  const terms = needle.split(" ");
  if (terms.length > 1 && terms.every((term) => squashedText.includes(term))) {
    return ALL_TERMS;
  }
  return NO_MATCH;
}

/** What you read on the row outranks what you don't. */
const NAME_WEIGHT = 1;
const FULL_NAME_WEIGHT = 0.98;
const COMPANY_WEIGHT = 0.8;
const ALIAS_WEIGHT = 0.75;

/** Retired models still answer a search — they just yield to the current
 *  lineup, the way they're folded away while browsing. A penalty rather
 *  than a hard partition, so an exact hit on a retired model still beats
 *  a loose hit on a current one. */
const LEGACY_PENALTY = 25;

/** How well a model answers a query, 0 for not at all. */
export function scoreModel(model: ComposerModel, query: string): number {
  let best = NO_MATCH;
  let exact = false;
  const consider = (text: string | undefined, weight: number) => {
    if (!text) return;
    const raw = scoreText(text, query);
    if (raw === EXACT || raw === SQUASHED_EXACT) exact = true;
    best = Math.max(best, raw * weight);
  };

  consider(model.name, NAME_WEIGHT);
  consider(model.fullName, FULL_NAME_WEIGHT);
  consider(model.company, COMPANY_WEIGHT);
  for (const alias of model.aliases) consider(alias, ALIAS_WEIGHT);

  if (best === NO_MATCH) return NO_MATCH;
  /* Typing a model's whole name is a request for that model, retired or
     not — only looser matches yield to the current lineup. Never let the
     penalty push a real match down to "no match" either. */
  if (exact || !model.legacy) return best;
  return Math.max(1, best - LEGACY_PENALTY);
}

/** The models a query matches, best first; ties keep catalog order. An
 *  empty query matches everything, untouched. */
export function searchModels(
  models: ComposerModel[],
  query: string,
): ComposerModel[] {
  if (!query.trim()) return models;
  return models
    .map((model, index) => ({ model, index, score: scoreModel(model, query) }))
    .filter((entry) => entry.score > NO_MATCH)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.model);
}
