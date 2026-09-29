"use client";

import { useCallback, useEffect, useState } from "react";

import type { StudySummary } from "@/app/api/study/route";
import type { HiddenEntry } from "@/lib/study/store";
import type { BuildRequest, StudyAnswer, StudySet, StudyUpload } from "@/lib/study/types";

/** The host's study sets, kept fresh while any of them is building. */

const UNREACHABLE = "Slates on your PC isn’t answering.";

/** A request to the host that failed, and whether trying again could help. */
export class HostError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }

  /** The PC was restarting, or the connection to it dropped for a moment (Funnel answers 502 then). */
  get transient(): boolean {
    return this.status === null || this.status === 502 || this.status === 503 || this.status === 504;
  }
}

async function call<T>(input: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    throw new HostError(UNREACHABLE, null);
  }
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new HostError(body.error ?? ([502, 503, 504].includes(response.status) ? UNREACHABLE : `Request failed (${response.status}).`), response.status);
  }
  return body;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Soon at first, then every half minute until the host answers again. */
const RETRY_MS = [2_000, 5_000, 10_000, 20_000, 30_000];

function useRetry(failures: number, retry: () => Promise<unknown>) {
  useEffect(() => {
    if (!failures) return;
    const timer = window.setTimeout(() => void retry(), RETRY_MS[Math.min(failures, RETRY_MS.length) - 1]);
    return () => window.clearTimeout(timer);
  }, [failures, retry]);
}

/** One quiet retry before a dropped connection is mentioned; anything else is said at once. */
function problemOf(error: string | null, failures: number): { message: string; retrying: boolean } | null {
  if (!error) return null;
  if (failures === 1) return null;
  return { message: error, retrying: failures > 1 };
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
  return (await call<{ items: MaterialEntry[] }>(`/api/study/materials?${query}`, { cache: "no-store" })).items;
}

/** Files up to 25 MB, the same limit the host enforces (lib/study/uploads.ts). */
export const MAX_UPLOAD_MB = 25;
/** Photos are read off the page on the host, like scanned PDFs (lib/study/scan.ts). */
export const PHOTO_EXTS = ["png", "jpg", "jpeg", "webp", "gif"];
export const UPLOAD_ACCEPT = [".pdf", ".docx", ".pptx", ".txt", ".md", ".csv", ...PHOTO_EXTS.map((ext) => `.${ext}`)].join(",");

export async function uploadFile(file: File): Promise<StudyUpload> {
  const form = new FormData();
  form.append("file", file);
  return (await call<{ upload: StudyUpload }>("/api/study/upload", { method: "POST", body: form })).upload;
}

export async function removeUpload(id: string): Promise<void> {
  await fetch(`/api/study/upload?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
}

export function useStudySets() {
  const [sets, setSets] = useState<StudySummary[]>([]);
  const [hidden, setHidden] = useState<HiddenEntry[]>([]);
  /*
   * Only once the host has answered. A failed first load used to count as
   * loaded, which showed "0 study sets" and offered to build every test again,
   * sets and progress included.
   */
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const body = await call<{ sets: StudySummary[]; hidden?: HiddenEntry[] }>("/api/study", { cache: "no-store" });
      setSets(body.sets);
      setHidden(body.hidden ?? []);
      setError(null);
      setFailures(0);
      setLoaded(true);
    } catch (err) {
      // The last list that loaded stays up while the host is away.
      setFailures((count) => (err instanceof HostError && err.transient ? count + 1 : 0));
      setError(messageOf(err));
    }
  }, []);

  useRetry(failures, refresh);

  useEffect(() => {
    const first = window.setTimeout(() => void refresh(), 0);
    // Coming back to Slates is when a set may have finished, or the host come back.
    const back = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", back);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", back);
    };
  }, [refresh]);

  const busy = sets.some((set) => set.status === "gathering" || set.status === "writing");
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(timer);
  }, [busy, refresh]);

  const build = useCallback(async (request: BuildRequest) => {
    await call("/api/study", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
    await refresh();
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    await call(`/api/study?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await refresh();
  }, [refresh]);

  /** Takes tests off the list, or puts them back. Shown at once; the host's answer then settles it, and a failure is thrown to say so. */
  const changeHidden = useCallback(async (change: { hide?: { id: string; title: string; courseId: string }[]; show?: string[] | "all" }) => {
    setHidden((current) => [
      ...(change.hide ?? []).map((test) => ({ ...test, at: Date.now() })),
      ...current.filter((entry) => change.show !== "all" && !change.show?.includes(entry.id) && !change.hide?.some((test) => test.id === entry.id)),
    ]);
    try {
      setHidden((await call<{ hidden: HiddenEntry[] }>("/api/study/hidden", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(change) })).hidden);
    } catch (err) {
      await refresh();
      throw err;
    }
  }, [refresh]);

  return { sets, hidden, loaded, problem: problemOf(error, failures), refresh, build, remove, changeHidden };
}

/** One full set, polled while it builds or while a practice round is being written. */
export function useStudySet(id: string) {
  const [set, setSet] = useState<StudySet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);

  const load = useCallback(async () => {
    try {
      setSet((await call<{ set: StudySet }>(`/api/study?id=${encodeURIComponent(id)}`, { cache: "no-store" })).set);
      setError(null);
      setFailures(0);
    } catch (err) {
      setFailures((count) => (err instanceof HostError && err.transient ? count + 1 : 0));
      setError(messageOf(err));
    }
  }, [id]);

  useRetry(failures, load);

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
      setSet((await call<{ set: StudySet }>("/api/study/practice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) })).set);
    } catch (err) {
      setFailures(0);
      setError(messageOf(err));
    }
  }, [id]);

  return { set, error: problemOf(error, failures)?.message ?? null, load, saveProgress, morePractice };
}
