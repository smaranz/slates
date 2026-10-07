import {
  IconBookFilled,
  IconBriefcaseFilled,
  IconBulbFilled,
  IconCalendarFilled,
  IconCameraFilled,
  IconChartBar,
  IconChefHat,
  IconCode,
  IconHeartFilled,
  IconMailFilled,
  IconMap,
  IconMusic,
  IconPaletteFilled,
  IconPlaneFilled,
  IconRocket,
  IconSparklesFilled,
  IconTool,
  IconWorld,
  type Icon,
} from "@tabler/icons-react";

export const SUGGESTION_ICONS = {
  book: IconBookFilled,
  briefcase: IconBriefcaseFilled,
  bulb: IconBulbFilled,
  calendar: IconCalendarFilled,
  camera: IconCameraFilled,
  chart: IconChartBar,
  chef: IconChefHat,
  code: IconCode,
  heart: IconHeartFilled,
  mail: IconMailFilled,
  map: IconMap,
  music: IconMusic,
  palette: IconPaletteFilled,
  plane: IconPlaneFilled,
  rocket: IconRocket,
  sparkles: IconSparklesFilled,
  tool: IconTool,
  world: IconWorld,
} satisfies Record<string, Icon>;

export type SuggestionIcon = keyof typeof SUGGESTION_ICONS;

export type Suggestion = {
  prompt: string;
  /** A safe registry key chosen by the suggestion model. */
  icon: SuggestionIcon;
};

/** A suggestion in one of the two cards under the composer. */
export type SuggestionSlot = Suggestion & {
  id: string;
  loading: boolean;
};

/* The standbys a free customer sees live on the server
   (convex/suggestions/fallbacks.ts) — that path returns a random draw from a
   two-dozen pool, so it never needs the client's help. These few are only for
   when the action itself can't be reached at all: no network, no reply, no
   standbys from anywhere else. A deliberate subset, not a copy of that pool. */
const OFFLINE_SUGGESTIONS: Suggestion[] = [
  { prompt: "Help me pick one useful thing to finish today", icon: "calendar" },
  { prompt: "Turn a half-formed idea into a tiny, practical plan", icon: "bulb" },
  { prompt: "Teach me something surprising in five minutes", icon: "book" },
  { prompt: "Help me untangle the task I've been avoiding", icon: "tool" },
  { prompt: "Suggest a small experiment I could run this week", icon: "rocket" },
  { prompt: "Help me weigh a decision I keep putting off", icon: "chart" },
];

/** A random draw of `count` standbys, preferring unseen ones. */
export function pickFallbacks(
  count: number,
  excluded: Iterable<string> = [],
): Suggestion[] {
  const seen = new Set<string>();
  for (const prompt of excluded) seen.add(prompt.toLocaleLowerCase());

  const pool = [...OFFLINE_SUGGESTIONS];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const fresh = pool.filter(
    (suggestion) => !seen.has(suggestion.prompt.toLocaleLowerCase()),
  );
  const stale = pool.filter((suggestion) =>
    seen.has(suggestion.prompt.toLocaleLowerCase()),
  );
  return [...fresh, ...stale].slice(0, Math.max(0, count));
}

export function isSuggestionIcon(value: string): value is SuggestionIcon {
  return value in SUGGESTION_ICONS;
}
