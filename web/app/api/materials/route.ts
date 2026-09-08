import type { NextRequest } from "next/server";

import { SchoologyError, keysFromEnv } from "@/lib/schoology/client";
import { authorizationHeader } from "@/lib/schoology/oauth";

/**
 * A course's folders, files, pages and links, from the Schoology API.
 *
 * Schoology models course materials as one folder tree per section: asking for
 * a section's folders with no id returns the top level, and each folder's own
 * id walks down from there. `folder-item` is the union type for everything a
 * folder can hold, and `type` is what distinguishes a sub-folder from a file.
 */

const API = "https://api.schoology.com/v1";

interface FolderItem {
  id?: string | number;
  /** "folder" | "document" | "assignment" | "page" | "discussion" | "link" ... */
  type?: string;
  title?: string;
  location?: string;
  /** Present on documents; the page the file lives on. */
  web_url?: string;
  available?: number;
}

async function readFolder(sectionId: string, folderId: string | null) {
  const keys = keysFromEnv();
  const url = folderId
    ? `${API}/sections/${encodeURIComponent(sectionId)}/folders/${encodeURIComponent(folderId)}`
    : `${API}/sections/${encodeURIComponent(sectionId)}/folders`;

  const res = await fetch(url, {
    headers: {
      Authorization: await authorizationHeader("GET", url, keys),
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    throw new SchoologyError(
      res.status === 403 || res.status === 401
        ? "Schoology wouldn't share this class's materials with this key."
        : `Schoology returned ${res.status} for course materials.`,
      res.status,
      res.status === 401 || res.status === 403
    );
  }

  const body = (await res.json()) as {
    folder?: FolderItem[];
    "folder-item"?: FolderItem[];
  };

  // The top level answers under `folder`; a folder's contents under
  // `folder-item`. Same shape either way.
  const raw = body["folder-item"] ?? body.folder ?? [];

  return (
    raw
      // Items the teacher has hidden come back flagged rather than omitted.
      .filter((item) => item.available !== 0)
      .map((item) => {
        const kind = (item.type ?? "document").toLowerCase();
        return {
          kind,
          title: item.title?.trim() || "Untitled",
          // Opening a document goes to its Schoology page. A student-scoped key
          // can list materials but cannot fetch the bytes behind one, so Slates
          // links out rather than pretending to have the file.
          url: item.web_url || item.location || "",
          folderId: kind === "folder" && item.id != null ? String(item.id) : null,
        };
      })
  );
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const course = q.get("course");

  if (!course) return Response.json({ error: "No class given." }, { status: 400 });

  try {
    return Response.json({ items: await readFolder(course, q.get("folder")) });
  } catch (e) {
    const message =
      e instanceof SchoologyError ? e.message : "Couldn't read that class's materials.";
    return Response.json({ error: message }, { status: 502 });
  }
}
