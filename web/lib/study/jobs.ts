import { ensureBrowser } from "@/lib/agent/browser";
import { studyWithAgent } from "./agent";
import { gather } from "./gather";
import { getMaterial, getSet, saveMaterial, saveSet, updateSet } from "./store";
import type { BuildRequest, StudyAnswer, StudyInputs, StudySet } from "./types";
import { readUpload } from "./uploads";
import { SET_MODEL, writeRound, writeSet, type WrittenSet } from "./write";

/**
 * Builds and practice rounds run in the background of the server, so leaving
 * the page doesn't cancel them; the set on disk says where each one is.
 */

/*
 * On globalThis because Next bundles each route on its own: the route that
 * starts a build and the one that reads it would otherwise each see their own
 * empty map, and a live build would look abandoned.
 */
const running: Map<string, Promise<void>> = ((globalThis as typeof globalThis & { __slatesStudyRunning?: Map<string, Promise<void>> }).__slatesStudyRunning ??= new Map());

/** Keeps a working set's updatedAt fresh while the agent is quiet (writing, thinking), so it never reads as stale. */
function heartbeat(id: string): () => void {
  const timer = setInterval(() => void updateSet(id, (current) => ({ ...current })), 60_000);
  return () => clearInterval(timer);
}
/**
 * A set that says it's building but has had no word for this long was cut off
 * by a restart. The study agent reports every step, so a long quiet stretch
 * means it is gone rather than thinking.
 */
const STALE_MS = 6 * 60_000;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0]! : String(error);
}

/** What the student chose for this build, with upload names so the set can show them later. */
async function inputsOf(request: BuildRequest): Promise<StudyInputs | undefined> {
  const chose = !!(request.picks?.length || request.uploads?.length || request.notes?.trim()) || request.auto === false;
  if (!chose) return undefined;
  const uploads = await Promise.all(
    (request.uploads ?? []).map(async (id) => ({ id, name: (await readUpload(id).catch(() => null))?.name ?? "Uploaded file" })),
  );
  return { picks: request.picks ?? [], uploads, notes: request.notes?.trim() ?? "", auto: request.auto !== false };
}

export async function startBuild(request: BuildRequest): Promise<StudySet> {
  const { target, course } = request;
  const existing = await getSet(target.id);
  if (running.has(target.id) && existing) return existing;

  const inputs = await inputsOf(request);
  const set = await saveSet({
    id: target.id,
    courseId: course.id,
    course: course.name,
    title: target.title,
    kind: target.testKind,
    due: target.due ?? "",
    ...(request.custom ? { custom: true } : {}),
    ...(request.date ? { date: request.date } : {}),
    ...(inputs ? { inputs } : {}),
    status: "gathering",
    step: request.auto === false ? "Reading the material you chose" : `Looking through ${course.name} in Schoology`,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    sources: [],
    overview: "",
    guide: "",
    cards: [],
    questions: [],
    progress: { cards: {}, answers: {} },
  });

  const job = (async () => {
    const stopBeat = heartbeat(target.id);
    try {
      // The browser the tutor and Study share holds the student's Google sign-in, which the gatherer uses for school-only Google files.
      await ensureBrowser().catch(() => {});
      const found = await gather(request, (step) => void updateSet(target.id, (current) => ({ ...current, step })));
      const material = [...found.texts].map(([n, text]) => ({ n, title: found.sources[n - 1]!.title, text }));
      await saveMaterial(target.id, material);
      await updateSet(target.id, (current) => ({
        ...current,
        status: "writing",
        step: "Starting the study agent",
        sources: found.sources,
        notice: found.notice,
        activity: [],
      }));
      await research(request, found.sources, material, found.notice);
    } catch (error) {
      await updateSet(target.id, (current) => ({ ...current, status: "failed", step: "", error: messageOf(error) }));
    } finally {
      stopBeat();
    }
  })().finally(() => running.delete(target.id));
  running.set(target.id, job);
  return set;
}

/**
 * The study agent researches past what `gather` found and writes the set. When
 * it can't run — no Cursor sign-in on the host, a crash, a run that ends
 * without saving — the plain writer builds the set from the gathered material
 * instead, and the set says so.
 */
async function research(request: BuildRequest, sources: StudySet["sources"], material: { n: number; title: string; text: string }[], notice: string | undefined): Promise<void> {
  const { target, course } = request;
  const held: { set?: WrittenSet } = {};
  try {
    const result = await studyWithAgent({
      request,
      sources,
      material,
      onActivity: (entry) => void updateSet(target.id, (current) => ({
        ...current,
        step: entry.detail ? `${entry.label}: ${entry.detail}` : entry.label,
        activity: [...(current.activity ?? []), entry].slice(-40),
      })),
      onSource: (source, text) => {
        material.push({ n: source.n, title: source.title, text });
        void saveMaterial(target.id, material);
        void updateSet(target.id, (current) => ({ ...current, sources: [...current.sources.filter((entry) => entry.n !== source.n), source].sort((a, b) => a.n - b.n) }));
      },
      onSave: async (set) => {
        held.set = set;
        await updateSet(target.id, (current) => ({ ...current, ...set, status: "ready", step: "", builtAt: Date.now(), builder: "agent", error: undefined }));
      },
    });
    if (!result.saved) throw new Error("it finished without saving a study set");
    await updateSet(target.id, (current) => ({ ...current, model: result.model }));
  } catch (error) {
    if (held.set) return;
    const why = `The study agent couldn’t finish (${messageOf(error)}), so this was written from the gathered material without it.`;
    await updateSet(target.id, (current) => ({ ...current, step: "Writing without the study agent", notice: [notice, why].filter(Boolean).join(" ") }));
    const current = (await getSet(target.id))!;
    const written = await writeSet({ title: target.title, kind: target.testKind, course: course.name, due: target.due ?? "", sources: current.sources, material });
    await updateSet(target.id, (set) => ({ ...set, ...written, status: "ready", step: "", builtAt: Date.now(), builder: "writer", model: SET_MODEL, error: undefined }));
  }
}

export async function startRound(id: string): Promise<StudySet | null> {
  const set = await getSet(id);
  const key = `round:${id}`;
  if (!set || set.status !== "ready" || running.has(key)) return set;
  const marked = await updateSet(id, (current) => ({ ...current, practicing: true, practiceError: undefined }));

  const job = (async () => {
    try {
      const round = Math.max(1, ...set.questions.map((question) => question.round)) + 1;
      const questions = await writeRound({
        title: set.title,
        course: set.course,
        material: (await getMaterial(id)) ?? [],
        asked: set.questions,
        missed: set.questions.filter((question) => set.progress.answers[question.id]?.correct === false),
        round,
      });
      await updateSet(id, (current) => ({ ...current, questions: [...current.questions, ...questions], practicing: false }));
    } catch (error) {
      await updateSet(id, (current) => ({ ...current, practicing: false, practiceError: messageOf(error) }));
    }
  })().finally(() => running.delete(key));
  running.set(key, job);
  return marked;
}

/** Marks a build or round that a server restart cut off, so it doesn't spin forever. */
export async function settle(set: StudySet): Promise<StudySet> {
  const quiet = Date.now() - set.updatedAt > STALE_MS;
  if ((set.status === "gathering" || set.status === "writing") && !running.has(set.id) && quiet) {
    return (await updateSet(set.id, (current) => ({ ...current, status: "failed", step: "", error: "The build was interrupted. Build it again." }))) ?? set;
  }
  if (set.practicing && !running.has(`round:${set.id}`) && quiet) {
    return (await updateSet(set.id, (current) => ({ ...current, practicing: false, practiceError: "That round was interrupted. Try again." }))) ?? set;
  }
  return set;
}

export function recordProgress(
  id: string,
  patch: { cards?: Record<string, "again" | "good">; answers?: Record<string, StudyAnswer> },
): Promise<StudySet | null> {
  return updateSet(id, (current) => {
    const cards = Object.fromEntries(Object.entries(patch.cards ?? {}).filter(([cardId]) => current.cards.some((card) => card.id === cardId)));
    const answers = Object.fromEntries(Object.entries(patch.answers ?? {}).filter(([questionId]) => current.questions.some((question) => question.id === questionId)));
    return { ...current, progress: { cards: { ...current.progress.cards, ...cards }, answers: { ...current.progress.answers, ...answers } } };
  });
}
