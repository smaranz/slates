import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { addDays } from "./nutrition";
import type { F45Class, F45Day, F45Schedule, F45Studio } from "./types";

/**
 * The student's F45 studio, as its own website reads it.
 *
 * Every F45 studio runs the same workout on the same day; each studio page
 * (f45training.com/studio/<slug>/) carries the studio's record, and its class
 * schedule widget asks F45's booking API for the week's classes, with no
 * sign-in: the day's workout and its type (Cardio, Resistance, Hybrid), every
 * class time, its coach and how many spots are booked. Slates asks the same
 * endpoint, from the host, and keeps the last good answer so a phone at the
 * gym still sees the day when F45 is slow.
 *
 * Booking stays in F45's own app: it needs the member's sign-in.
 */

const BOOKING_API = "https://booking.api.f45training.com";
const UA = "Mozilla/5.0 (Slates personal health tracker)";

/** The studio at Vallco, Cupertino, which is the one this room was set up for. */
export const KNOWN_STUDIOS: Record<string, F45Studio> = {
  cupertino: {
    id: 1670,
    slug: "cupertino",
    name: "F45 Cupertino",
    address: "19700 Vallco Pkwy, Cupertino, CA 95014",
    timezone: "America/Los_Angeles",
    url: "https://f45training.com/studio/cupertino/",
  },
};

export const isStudioSlug = (slug: unknown): slug is string => typeof slug === "string" && /^[a-z0-9][a-z0-9-]{1,60}$/.test(slug);

const dir = () => path.join(os.homedir(), ".slates", "health");

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await fs.rename(temporary, file);
}

/* ── text ──────────────────────────────────────────────────────────────── */

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", eacute: "é", trade: "™", reg: "®", copy: "©",
};

/** A class description is a scrap of HTML: tags dropped, entities read, spaces tidied. */
export function plainText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, " ")
    .replace(/<\/(?:p|div|li)>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
      if (code[0] === "#") {
        const n = code[1]?.toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : match;
      }
      return ENTITIES[code.toLowerCase()] ?? match;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/* ── the studio ────────────────────────────────────────────────────────── */

/** The studio record a studio page embeds as `const STUDIO_DATA = {...};`. */
export function parseStudioPage(html: string, slug: string): F45Studio | null {
  const match = html.match(/STUDIO_DATA\s*=\s*(\{.*?\});\s*$/m);
  if (!match) return null;
  try {
    const data = JSON.parse(match[1]!) as Record<string, unknown>;
    const id = Number(data.id);
    if (!Number.isInteger(id) || id <= 0) return null;
    return {
      id,
      slug,
      name: typeof data.name === "string" && data.name ? data.name : `F45 ${slug}`,
      address: typeof data.address === "string" ? data.address.replace(/, USA$/, "") : "",
      timezone: typeof data.timezone === "string" && data.timezone ? data.timezone : "America/Los_Angeles",
      url: `https://f45training.com/studio/${slug}/`,
    };
  } catch {
    return null;
  }
}

const studios = new Map<string, { at: number; studio: F45Studio }>();
const WEEK = 7 * 24 * 3600_000;

export async function resolveStudio(slug: string): Promise<F45Studio> {
  if (!isStudioSlug(slug)) throw new Error("That isn’t an F45 studio name.");
  const hit = studios.get(slug);
  if (hit && Date.now() - hit.at < WEEK) return hit.studio;

  const file = path.join(dir(), "f45-studios.json");
  const saved = (await readJson<Record<string, { at: number; studio: F45Studio }>>(file)) ?? {};
  if (saved[slug] && Date.now() - saved[slug].at < WEEK) {
    studios.set(slug, saved[slug]);
    return saved[slug].studio;
  }

  let studio: F45Studio | null = null;
  try {
    const res = await fetch(`https://f45training.com/studio/${slug}/`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(12_000) });
    if (res.ok) studio = parseStudioPage(await res.text(), slug);
  } catch {
    /* fall back to what's known or was saved */
  }
  studio ??= saved[slug]?.studio ?? KNOWN_STUDIOS[slug] ?? null;
  if (!studio) throw new Error(`Couldn’t find an F45 studio at f45training.com/studio/${slug}.`);
  const entry = { at: Date.now(), studio };
  studios.set(slug, entry);
  await writeJson(file, { ...saved, [slug]: entry }).catch(() => {});
  return studio;
}

/** The studio's calendar day right now, which is what "today's workout" means. */
export function studioToday(timezone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/* ── the schedule ──────────────────────────────────────────────────────── */

type Raw = Record<string, unknown>;

const hhmm = (stamp: unknown) => (typeof stamp === "string" ? (stamp.match(/\b(\d{2}:\d{2})/)?.[1] ?? "") : "");
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

function classFrom(raw: Raw): F45Class | null {
  const id = Number(raw.id);
  const start = hhmm(raw.datetime_start);
  if (!Number.isFinite(id) || !start) return null;
  return {
    id,
    name: text(raw.name),
    start,
    end: hhmm(raw.datetime_end),
    minutes: Number(raw.duration) || 45,
    coach: text(raw.trainers_name) || null,
    assistants: Array.isArray(raw.assistants) ? raw.assistants.map(text).filter(Boolean) : [],
    size: Number(raw.size) || 0,
    booked: Number(raw.booked) || 0,
    status: text(raw.status) || "active",
  };
}

/** F45's `/v2/schedule/classes` reply as one entry per day, classes in time order. */
export function scheduleFrom(body: unknown): F45Day[] {
  const schedule = (body as { data?: { schedule?: unknown } } | null)?.data?.schedule;
  if (!Array.isArray(schedule)) throw new Error("F45 sent back a schedule Slates can’t read.");
  return schedule
    .map((day: Raw): F45Day | null => {
      const date = text(day.date_start).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
      const program = (day.program ?? {}) as Raw;
      const rawClasses = Array.isArray(day.classes) ? (day.classes as Raw[]) : [];
      const classes = rawClasses.map(classFrom).filter((c): c is F45Class => !!c).sort((a, b) => a.start.localeCompare(b.start));
      const described = rawClasses.find((c) => text(c.description) && text(c.name) === text(program.name)) ?? rawClasses.find((c) => text(c.description));
      return {
        date,
        workout: text(program.name) || classes[0]?.name || "F45",
        type: text(day.workout_type) || text(rawClasses[0]?.workout_type),
        logo: text(program.media_logo_small) || null,
        description: described ? plainText(text(described.description)) : "",
        classes,
      };
    })
    .filter((d): d is F45Day => !!d)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export type ScheduleFetch = (url: string) => Promise<unknown>;

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json", origin: "https://f45training.com", referer: "https://f45training.com/" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`F45 answered ${res.status}.`);
  return res.json();
}

let fetcher: ScheduleFetch = fetchJson;

/** For tests: answer F45's schedule requests with something other than F45. */
export function setScheduleFetch(next: ScheduleFetch | null): void {
  fetcher = next ?? fetchJson;
}

const schedules = new Map<string, F45Schedule>();
/** Spots fill up through the day, so the copy is refreshed every few minutes. */
const FRESH_MS = 5 * 60_000;

/** The week behind and the week ahead at the studio, today in the middle. */
export async function f45Schedule(slug: string, now: Date = new Date()): Promise<F45Schedule> {
  const studio = await resolveStudio(slug);
  const today = studioToday(studio.timezone, now);
  const key = `${studio.id}:${today}`;
  const hit = schedules.get(key);
  if (hit && now.getTime() - hit.fetchedAt < FRESH_MS) return hit;

  const file = path.join(dir(), `f45-schedule-${studio.id}.json`);
  try {
    const url = `${BOOKING_API}/v2/schedule/classes?from=${addDays(today, -7)}&to=${addDays(today, 7)}&studio_id=${studio.id}&service_category_code=training`;
    const fresh: F45Schedule = { studio, today, days: scheduleFrom(await fetcher(url)), fetchedAt: now.getTime() };
    schedules.set(key, fresh);
    await writeJson(file, fresh).catch(() => {});
    return fresh;
  } catch (error) {
    const saved = hit ?? (await readJson<F45Schedule>(file));
    if (saved?.days?.length) return { ...saved, studio, today, stale: true };
    throw new Error(`Couldn’t reach F45 for the ${studio.name} schedule: ${error instanceof Error ? error.message : String(error)}`);
  }
}
