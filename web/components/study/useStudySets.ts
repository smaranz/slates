"use client";

import { useCallback, useEffect, useState } from "react";

import type { StudySummary } from "@/app/api/study/route";
import type { HiddenEntry } from "@/lib/study/store";
import type { BuildRequest, StudyAnswer, StudySet, StudyUpload } from "@/lib/study/types";

/** The host's study sets, kept fresh while any of them is building. */

async function json<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status}).`);
  return body;
}

/** One entry in a class's Schoology Materials, as /api/study/materials lists it. */
export interface MaterialEntry {
  kind: string;
  title: string;
  url: string;
  folderId: string | null;
  readable: boolean;
}

export async function listMaterials(courseId: string, folderId: string | null): Promise<MaterialEntry[]> {
  const query = `course=${encodeURIComponent(courseId)}${folderId ? `&folder=${encodeURIComponent(folderId)}` : ""}`;
  return (await json<{ items: MaterialEntry[] }>(await fetch(`/api/study/materials?${query}`, { cache: "no-store" }))).items;
}

/** Files up to 25 MB, the same limit the host enforces (lib/study/uploads.ts). */
export const MAX_UPLOAD_MB = 25;
/** Photos are read off the page on the host, like scanned PDFs (lib/study/scan.ts). */
export const PHOTO_EXTS = ["png", "jpg", "jpeg", "webp", "gif"];
export const UPLOAD_ACCEPT = [".pdf", ".docx", ".pptx", ".txt", ".md", ".csv", ...PHOTO_EXTS.map((ext) => `.${ext}`)].join(",");

export async function uploadFile(file: File): Promise<StudyUpload> {
  const form = new FormData();
  form.append("file", file);
  return (await json<{ upload: StudyUpload }>(await fetch("/api/study/upload", { method: "POST", body: form }))).upload;
}

export async function removeUpload(id: string): Promise<void> {
  await fetch(`/api/study/upload?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
}

export function useStudySets() {
  const [sets, setSets] = useState<StudySummary[]>([]);
  const [hidden, setHidden] = useState<HiddenEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const body = await json<{ sets: StudySummary[]; hidden?: HiddenEntry[] }>(await fetch("/api/study", { cache: "no-store" }));
      setSets(body.sets);
      setHidden(body.hidden ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(first);
  }, [refresh]);

  const busy = sets.some((set) => set.status === "gathering" || set.status === "writing");
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(timer);
  }, [busy, refresh]);

  const build = useCallback(async (request: BuildRequest) => {
    await json(await fetch("/api/study", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) }));
    await refresh();
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    await json(await fetch(`/api/study?id=${encodeURIComponent(id)}`, { method: "DELETE" }));
    await refresh();
  }, [refresh]);

  /** Takes tests off the list, or puts them back. Shown at once; the host's answer then settles it. */
  const changeHidden = useCallback(async (change: { hide?: { id: string; title: string; courseId: string }[]; show?: string[] | "all" }) => {
    setHidden((current) => [
      ...(change.hide ?? []).map((test) => ({ ...test, at: Date.now() })),
      ...current.filter((entry) => change.show !== "all" && !change.show?.includes(entry.id) && !change.hide?.some((test) => test.id === entry.id)),
    ]);
    try {
      const body = await json<{ hidden: HiddenEntry[] }>(
        await fetch("/api/study/hidden", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(change) }),
      );
      setHidden(body.hidden);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await refresh();
    }
  }, [refresh]);

  return { sets, hidden, loaded, error, refresh, build, remove, changeHidden };
}

/** One full set, polled while it builds or while a practice round is being written. */
export function useStudySet(id: string) {
  const [set, setSet] = useState<StudySet | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSet((await json<{ set: StudySet }>(await fetch(`/api/study?id=${encodeURIComponent(id)}`, { cache: "no-store" }))).set);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id]);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(first);
  }, [load]);

  const waiting = !!set && (set.status === "gathering" || set.status === "writing" || !!set.practicing);
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(timer);
  }, [waiting, load]);

  const saveProgress = useCallback(async (patch: { cards?: Record<string, "again" | "good">; answers?: Record<string, StudyAnswer> }) => {
    setSet((current) => current && {
      ...current,
      progress: { cards: { ...current.progress.cards, ...patch.cards }, answers: { ...current.progress.answers, ...patch.answers } },
    });
    await fetch("/api/study/progress", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, ...patch }) }).catch(() => {});
  }, [id]);

  const morePractice = useCallback(async () => {
    try {
      setSet((await json<{ set: StudySet }>(await fetch("/api/study/practice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }))).set);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id]);

  return { set, error, load, saveProgress, morePractice };
}
