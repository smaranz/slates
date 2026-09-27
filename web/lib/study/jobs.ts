import { gather } from "./gather";
import { getMaterial, getSet, saveMaterial, saveSet, updateSet } from "./store";
import type { BuildRequest, StudyAnswer, StudySet } from "./types";
import { SET_MODEL, writeRound, writeSet } from "./write";

/**
 * Builds and practice rounds run in the background of the server, so leaving
 * the page doesn't cancel them; the set on disk says where each one is.
 */

const running = new Map<string, Promise<void>>();
/** A set that says it's building but has had no word for this long was cut off by a restart. */
const STALE_MS = 4 * 60_000;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0]! : String(error);
}

export async function startBuild(request: BuildRequest): Promise<StudySet> {
  const { target, course } = request;
  const existing = await getSet(target.id);
  if (running.has(target.id) && existing) return existing;

  const set = await saveSet({
    id: target.id,
    courseId: course.id,
    course: course.name,
    title: target.title,
    kind: target.testKind,
    due: target.due ?? "",
    status: "gathering",
    step: `Looking through ${course.name} in Schoology`,
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
    try {
      const found = await gather(request, (step) => void updateSet(target.id, (current) => ({ ...current, step })));
      const material = [...found.texts].map(([n, text]) => ({ n, title: found.sources[n - 1]!.title, text }));
      await saveMaterial(target.id, material);
      await updateSet(target.id, (current) => ({
        ...current,
        status: "writing",
        step: material.length ? `Writing from ${material.length} ${material.length === 1 ? "source" : "sources"}` : "Writing from the test’s title",
        sources: found.sources,
        notice: found.notice,
      }));
      const written = await writeSet({ title: target.title, kind: target.testKind, course: course.name, due: target.due ?? "", sources: found.sources, material });
      await updateSet(target.id, (current) => ({ ...current, ...written, status: "ready", step: "", builtAt: Date.now(), model: SET_MODEL, error: undefined }));
    } catch (error) {
      await updateSet(target.id, (current) => ({ ...current, status: "failed", step: "", error: messageOf(error) }));
    }
  })().finally(() => running.delete(target.id));
  running.set(target.id, job);
  return set;
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
