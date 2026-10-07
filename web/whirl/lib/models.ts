import {
  IconBarbellFilled,
  IconBoltFilled,
  IconFeatherFilled,
  IconPhotoFilled,
  IconSparklesFilled,
  type Icon,
} from "@tabler/icons-react";

/* The chat model lineup for the composer's model picker. Keys mirror the
   backend's MODEL_IDS keys (convex/inference/billing.ts) — they're what
   gets persisted, so never rename them; the white-label names here are the
   user-facing truth (key Fast = the Free tier). Capabilities and thinking
   configs follow the notes in apps/legacy/app/lib/attachment-upload.ts and
   the backend's REASONING_OFF_OPTIONS. The picker only surfaces Free for
   free users (lib/model-access.ts) — paid plans ride Fast/Heavy instead. */

export type ChatModelKey = "Auto" | "Fast" | "Basic" | "Max" | "Image";

export type ThinkingLevel = "none" | "low" | "medium" | "high";

export const THINKING_LABELS: Record<ThinkingLevel, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
};

export type ChatModel = {
  key: ChatModelKey;
  name: string;
  icon: Icon;
  /** What model search matches besides the name — underlying model names,
   *  providers, nicknames. Lowercase. */
  aliases: string[];
  /** Accepts image input. */
  vision: boolean;
  /** Accepts document/file input natively. */
  files: boolean;
  /** Paints pictures instead of paragraphs. */
  imageOutput: boolean;
  /** What the thinking rotator cycles through — never empty. Models that
   *  can't think just carry ["none"]; Heavy always reasons, so "none"
   *  isn't on its wheel at all. */
  thinkingLevels: ThinkingLevel[];
  /** Whirl's own white-labeled tier — cheaper for us, so users get more
   *  usage out of these than out of by-name models. */
  whiteLabel: boolean;
  /** The model runs the search/thinking gates itself (Auto decides,
   *  Image has neither) — the picker blanks them out. */
  autoGates: boolean;
};

export const CHAT_MODELS: ChatModel[] = [
  {
    key: "Auto",
    name: "Auto",
    icon: IconSparklesFilled,
    // In Slates, Auto runs each agent on the model set in its profile.
    aliases: ["auto", "default", "agent's model", "picks for you"],
    vision: true,
    files: true,
    imageOutput: false,
    thinkingLevels: ["none", "low", "medium", "high"],
    whiteLabel: true,
    autoGates: true,
  },
  {
    key: "Fast",
    name: "Free",
    icon: IconFeatherFilled,
    aliases: ["free", "nano", "gpt-5.4-nano", "openai"],
    vision: true,
    files: false,
    imageOutput: false,
    /* The free tier never thinks — thinking is a paid perk. */
    thinkingLevels: ["none"],
    whiteLabel: true,
    autoGates: false,
  },
  {
    key: "Basic",
    name: "Fast",
    icon: IconBoltFilled,
    aliases: ["kimi", "k2.6", "kimi k2.6", "moonshot", "moonshotai"],
    vision: true,
    files: false,
    imageOutput: false,
    /* Kimi K2.6 is a hybrid thinker — it's either on or off. */
    thinkingLevels: ["none", "high"],
    whiteLabel: true,
    autoGates: false,
  },
  {
    key: "Max",
    name: "Heavy",
    icon: IconBarbellFilled,
    aliases: ["grok", "grok 4.5", "xai", "x-ai", "max"],
    vision: true,
    files: true,
    imageOutput: false,
    /* Grok 4.5 always reasons — there's no off, only how hard. */
    thinkingLevels: ["low", "medium", "high"],
    whiteLabel: true,
    autoGates: false,
  },
  {
    key: "Image",
    name: "Image",
    icon: IconPhotoFilled,
    aliases: ["gpt image", "gpt-image-2", "openai", "picture", "art"],
    vision: true,
    files: false,
    imageOutput: true,
    thinkingLevels: ["none"],
    whiteLabel: true,
    autoGates: true,
  },
];

/* Where a composer starts, and where a never-chosen preference lands:
   Auto picks the model so nobody has to (lib/model-pref.ts). */
export const DEFAULT_MODEL_KEY: ChatModelKey = "Auto";

/** The free plan's tier — the one model a free user can actually reach,
 *  and so the one a never-chosen preference is allowed to keep. */
export const FREE_MODEL_KEY: ChatModelKey = "Fast";

/* What the picker actually renders: the static lineup above, tier entries
   re-skinned by an admin override, and admin-added catalog models. Catalog
   models are keyed by their OpenRouter slug (always contains "/", so they
   can never collide with the tier keys), wear an uploaded monochrome SVG
   instead of a Tabler glyph, and carry their company for search and
   subtitles. */
export type ComposerModel = Omit<ChatModel, "key" | "icon"> & {
  key: string;
  icon?: Icon;
  iconSvg?: string;
  company?: string;
  /** The maker's full model name ("Claude Fable 5") — what the search
   *  list shows. Absent on white-labeled tiers, which go by `name`. */
  fullName?: string;
  /** Admin-retired: hidden from the picker's lists until a typed search
   *  matches it. Still fully usable once picked. */
  legacy?: boolean;
};

/** Catalog models are keyed by slug; tier keys never contain a slash. */
export function isCustomModelKey(key: string): boolean {
  return key.includes("/");
}
