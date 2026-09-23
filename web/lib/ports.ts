/**
 * The ports Slates runs on.
 *
 * Slates used to sit on 3000 and 4000, which are the two most contested ports
 * on a developer's machine — every Next, Rails, Phoenix and toy Express app
 * wants one of them. That is worse here than the usual annoyance: when
 * something else already holds the portal's port, the desktop launcher sees a
 * healthy socket, decides the portal is already running, and points its window
 * at whatever is actually there. The app then opens showing somebody else's
 * project.
 *
 * So Slates has its own block instead. 7528 is S-L-A-T on a phone keypad,
 * which is the only reason it is memorable and reason enough to pick it; the
 * two services sit directly above it.
 *
 * Every one of these can still be overridden by its environment variable —
 * the desktop app sets them when it spawns each service, and the numbers here
 * are only the default.
 *
 * Changing one means changing it in three places, because these three
 * packages share no module: this file (web), `desktop/main.mjs` (which spawns
 * the others), and `scraper/serve.mjs` (which binds its own socket). Each of
 * those carries a comment pointing back here.
 */

/** The Next server — the app's own window points at this. */
export const PORTAL_PORT = Number(process.env.SLATES_PORT) || 7528;

/** The Schoology scraper, which holds the logged-in browser profile. */
export const SCRAPER_PORT = Number(process.env.SLATES_SCRAPER_PORT) || 7529;

/** The local AI-detector sidecar. See detector/serve.py. */
export const DETECTOR_PORT = Number(process.env.SLATES_DETECTOR_PORT) || 7530;

/**
 * Where the API routes reach the scraper.
 *
 * `SLATES_SCRAPER_URL` still wins when it is set, so pointing the portal at a
 * scraper somewhere else stays a one-variable change.
 */
export const SCRAPER_URL =
  process.env.SLATES_SCRAPER_URL ?? `http://127.0.0.1:${SCRAPER_PORT}`;

export const DETECTOR_URL = `http://127.0.0.1:${DETECTOR_PORT}`;
