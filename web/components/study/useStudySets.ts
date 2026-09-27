"use client";

import { useCallback, useEffect, useState } from "react";

import type { StudySummary } from "@/app/api/study/route";
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
export const UPLOAD_ACCEPT = ".pdf,.docx,.pptx,.txt,.md,.csv";

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
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSets((await json<{ sets: StudySummary[] }>(await fetch("/api/study", { cache: "no-store" }))).sets);
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

  return { sets, loaded, error, refresh, build, remove };
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
