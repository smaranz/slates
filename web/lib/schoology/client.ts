import { authorizationHeader, type SchoologyKeys } from "./oauth";

/**
 * A thin, typed reader for the Schoology REST API.
 *
 * Only the shapes Slates actually consumes are declared. Schoology returns a
 * great deal more per object, and typing all of it would be a large surface to
 * keep true against an API whose responses vary by district configuration.
 */

const API = "https://api.schoology.com/v1";

export class SchoologyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** True when the key/secret pair itself was rejected, rather than the request. */
    readonly unauthorized: boolean
  ) {
    super(message);
    this.name = "SchoologyError";
  }
}

function keysFromEnv(): SchoologyKeys {
  const key = process.env.SCHOOLOGY_KEY?.trim();
  const secret = process.env.SCHOOLOGY_SECRET?.trim();
  if (!key || !secret) {
    throw new SchoologyError(
      "SCHOOLOGY_KEY and SCHOOLOGY_SECRET are not set. Generate a key at https://<your-district>.schoology.com/api and put both in web/.env.local.",
      401,
      true
    );
  }
  return { key, secret };
}

async function get<T>(path: string, keys = keysFromEnv()): Promise<T> {
  const url = path.startsWith("http") ? path : `${API}${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: await authorizationHeader("GET", url, keys),
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new SchoologyError(
      res.status === 401 || res.status === 403
        ? "Schoology rejected the API key. Check SCHOOLOGY_KEY / SCHOOLOGY_SECRET, and that your district has API access enabled."
        : `Schoology returned ${res.status} for ${path}${body ? `: ${body.slice(0, 200)}` : ""}`,
      res.status,
      res.status === 401 || res.status === 403
    );
  }
  return (await res.json()) as T;
}

/**
 * Read every page of a collection.
 *
 * Schoology paginates at 20 by default and caps at 200, and hands back the next
 * page as a fully-formed URL in `links.next`. Following that rather than
 * incrementing `start` ourselves is the only way that survives the API deciding
 * to change its own paging scheme.
 */
async function getAll<T>(path: string, collection: string, keys = keysFromEnv()): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined = `${API}${path}${path.includes("?") ? "&" : "?"}limit=200`;
  // Districts with a decade of history can page a long way; stop somewhere.
  for (let page = 0; next && page < 40; page += 1) {
    const body: Record<string, unknown> = await get(next, keys);
    const items = body[collection];
    if (Array.isArray(items)) out.push(...(items as T[]));
    const links = body.links as { next?: string } | undefined;
    next = links?.next;
  }
  return out;
}

/* ---------- the shapes Slates reads ---------- */

export interface SchoologyUser {
  uid: number | string;
  name_display?: string;
  name_first?: string;
  name_last?: string;
  primary_email?: string;
  picture_url?: string;
}

export interface SchoologySection {
  id: string;
  course_title: string;
  section_title?: string;
  /** The period label as the school wrote it, when one is configured. */
  section_school_code?: string;
  course_code?: string;
  /** Present on the section listing; the link a card opens. */
  link?: string;
  admin?: number;
}

export interface SchoologyAssignment {
  id: string;
  title: string;
  description?: string;
  /** "2026-09-12 23:59:00" in the school's timezone, or "" when undated. */
  due?: string;
  max_points?: number;
  /** "assignment" | "discussion" | "test_quiz" | "external_tool" ... */
  type?: string;
  grading_category?: number | string;
  web_url?: string;
  /** 1 when the item is a dropbox that accepts a submission. */
  allow_dropbox?: number;
  completed?: number;
}

export interface SchoologyGradingCategory {
  id: number | string;
  title: string;
  /** Percentage weight when the section is weighted; 0 when it is points-based. */
  weight?: number;
  calculation_type?: number;
}

export interface SchoologyGrade {
  assignment_id: string | number;
  grade?: number | string | null;
  max_points?: number;
  category_id?: number | string;
  /** Present and 1 when the teacher has excused the item. */
  exception?: number;
  comment?: string;
  timestamp?: number;
}

export interface SchoologyFinalGrade {
  section_id: string;
  final_grade?: { period_id?: string; grade?: number; letter?: string }[];
  period?: {
    period_id?: string;
    grade?: number;
    letter?: string;
    assignment?: SchoologyGrade[];
  }[];
}

export interface SchoologyMessage {
  id: string | number;
  subject?: string;
  message?: string;
  /** Unix seconds. */
  last_updated?: number;
  author_id?: string | number;
  recipient_ids?: string;
  message_status?: "read" | "unread";
}

/* ---------- calls ---------- */

export const schoology = {
  /** Who the key acts as. Also the cheapest possible credential check. */
  me: (keys?: SchoologyKeys) => get<SchoologyUser>("/users/me", keys),

  sections: (uid: string | number, keys?: SchoologyKeys) =>
    getAll<SchoologySection>(`/users/${uid}/sections`, "section", keys),

  assignments: (sectionId: string, keys?: SchoologyKeys) =>
    getAll<SchoologyAssignment>(`/sections/${sectionId}/assignments`, "assignment", keys),

  gradingCategories: (sectionId: string, keys?: SchoologyKeys) =>
    getAll<SchoologyGradingCategory>(
      `/sections/${sectionId}/grading_categories`,
      "grading_category",
      keys
    ),

  /** Every graded item plus the section's own final grade, in one call. */
  grades: async (uid: string | number, sectionId: string, keys?: SchoologyKeys) => {
    const body = await get<{ section?: SchoologyFinalGrade[] }>(
      `/users/${uid}/grades?section_id=${encodeURIComponent(sectionId)}`,
      keys
    );
    return body.section?.[0];
  },

  inbox: (uid: string | number, keys?: SchoologyKeys) =>
    getAll<SchoologyMessage>(`/users/${uid}/messages/inbox`, "message", keys),

  user: (id: string | number, keys?: SchoologyKeys) => get<SchoologyUser>(`/users/${id}`, keys),
};

export { keysFromEnv };
