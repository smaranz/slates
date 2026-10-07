/* Everything that ties this build to one particular Whirl: its address and
   the places it sends people. A fork edits this file and sets
   NEXT_PUBLIC_SITE_URL; nothing else in the app hardcodes a domain.

   The optional links can be set to null, and every surface that shows one
   leaves it out. */

export const SITE_NAME = "Whirl";

/** The public origin, without a trailing slash. When it's unset,
 *  next.config.ts fills it in from Vercel's production domain, or falls
 *  back to localhost. */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"
).replace(/\/+$/, "");

type SiteLinks = {
  /** The source code. */
  repo: string;
  /** The admin console (apps/console), where integrations and skills are
   *  published. */
  console: string;
  status: string | null;
  discord: string | null;
  contactEmail: string | null;
  privacy: string | null;
  terms: string | null;
};

export const SITE_LINKS: SiteLinks = {
  repo: "https://github.com/whirlchat/whirl",
  console: "https://console.whirl.chat",
  status: "https://status.whirl.chat",
  discord: "https://discord.gg/SrgwbaGHqE",
  contactEmail: "hello@whirl.chat",
  privacy: "https://anterra.sh/legal/whirl/privacy",
  terms: "https://anterra.sh/legal/whirl/terms",
};

/** "console.whirl.chat" out of "https://console.whirl.chat", for copy. */
export function displayHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
