import { execFile, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { composeLesson, planTimeline, type SceneTiming } from "./compose";
import { drawScene } from "./images";
import { writeLessonScript } from "./script";
import type { LessonRequest, LessonStatus } from "./types";
import { audioSeconds, hasVoiceKey, MissingVoiceKeyError, speak } from "./voice";

/**
 * One lesson, start to finish.
 *
 * Every lesson gets a directory under ~/.slates — the same place Slates
 * keeps its cache and session — holding its script, narration, artwork, the
 * composition, and the finished MP4. That directory *is* the job record:
 * status is written to disk after each stage rather than held in memory, so a
 * poll still answers after Next reloads the module in dev, and a finished
 * video survives a restart.
 */

export const LESSONS_DIR = path.join(os.homedir(), ".slates", "lessons");

/**
 * Illustrations per lesson.
 *
 * Each one is 30-60s of image model, and the tutor is occupied for the whole
 * build — a five-scene lesson that draws every scene took four minutes against
 * forty seconds for the same lesson in words. Three is enough for the scenes
 * that genuinely need a picture without turning a lesson into an errand.
 */
const MAX_IMAGES = 3;

/** Renders are minutes of CPU across six Chrome workers. One at a time. */
let running: Promise<void> | null = null;

/**
 * Lessons currently being built, so one can be called off.
 *
 * The tutor is occupied for the whole build, so there has to be a way out of
 * it. Stopping is checked between stages and, during the render, kills the
 * renderer outright — the expensive part is the one you're most likely to
 * want to abandon.
 */
const inFlight = new Map<string, { cancelled: boolean; child: ChildProcess | null }>();

class CancelledError extends Error {
  constructor() {
    super("Stopped.");
    this.name = "CancelledError";
  }
}

/** Call off a lesson. Returns false if it already finished. */
export function cancelLesson(id: string): boolean {
  const job = inFlight.get(id);
  if (!job) return false;
  job.cancelled = true;
  job.child?.kill("SIGTERM");
  return true;
}

function checkCancelled(id: string): void {
  if (inFlight.get(id)?.cancelled) throw new CancelledError();
}

export function lessonDir(id: string): string {
  return path.join(LESSONS_DIR, id);
}

export function lessonVideoPath(id: string): string {
  return path.join(lessonDir(id), "renders", "lesson.mp4");
}

/**
 * Ids are generated here and only ever used to name a directory, so they are
 * checked before touching the filesystem — an id arriving from a request must
 * never be able to walk out of the lessons directory.
 */
export function isLessonId(id: string): boolean {
  return /^[a-z0-9]{6,32}$/.test(id);
}

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function writeStatus(status: LessonStatus): Promise<void> {
  await fs.mkdir(lessonDir(status.id), { recursive: true });
  await fs.writeFile(path.join(lessonDir(status.id), "status.json"), JSON.stringify(status, null, 2));
}

export async function readLessonStatus(id: string): Promise<LessonStatus | null> {
  if (!isLessonId(id)) return null;
  try {
    return JSON.parse(await fs.readFile(path.join(lessonDir(id), "status.json"), "utf8")) as LessonStatus;
  } catch {
    return null;
  }
}

/** Every lesson on disk, newest first — the library behind the tutor's cards. */
export async function listLessons(): Promise<LessonStatus[]> {
  try {
    const ids = await fs.readdir(LESSONS_DIR);
    const all = await Promise.all(ids.filter(isLessonId).map(readLessonStatus));
    return all
      .filter((s): s is LessonStatus => s !== null)
      .sort((a, b) => b.startedAt - a.startedAt);
  } catch {
    return [];
  }
}

/**
 * Start a lesson and return its id immediately.
 *
 * The work is deliberately not awaited: a render runs for minutes, and an
 * HTTP request held open that long dies to some timeout between here and the
 * browser. The caller polls the status file instead.
 */
export async function startLesson(request: LessonRequest): Promise<LessonStatus> {
  if (!hasVoiceKey()) throw new MissingVoiceKeyError();

  const id = newId();
  const status: LessonStatus = {
    id,
    topic: request.topic,
    stage: "script",
    note: "Writing the lesson",
    startedAt: Date.now(),
  };
  await writeStatus(status);

  inFlight.set(id, { cancelled: false, child: null });

  // Queue behind any render already in flight, then run detached.
  const previous = running ?? Promise.resolve();
  running = previous
    .catch(() => {})
    .then(() => runLesson(id, request))
    .catch(async (error: unknown) => {
      const stopped = error instanceof CancelledError || inFlight.get(id)?.cancelled;
      await writeStatus({
        ...status,
        stage: stopped ? "cancelled" : "error",
        note: stopped ? "Stopped" : "Couldn't finish this video",
        error: stopped ? undefined : error instanceof Error ? error.message : String(error),
        finishedAt: Date.now(),
      });
    })
    .finally(() => {
      inFlight.delete(id);
    });

  return status;
}

async function runLesson(id: string, request: LessonRequest): Promise<void> {
  const dir = lessonDir(id);
  const started = Date.now();
  const update = (patch: Partial<LessonStatus>) =>
    writeStatus({ id, topic: request.topic, startedAt: started, stage: "script", note: "", ...patch } as LessonStatus);

  /* ---- 1. the script ---- */
  const script = await writeLessonScript(request);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "script.json"), JSON.stringify(script, null, 2));

  checkCancelled(id);
  const lines = [script.intro, ...script.scenes.map((s) => s.narration)];
  const scenes = lines.length;
  await update({ stage: "narration", title: script.title, scenes, note: `Recording narration (0/${scenes})` });

  /* ---- 2. narration, one file per scene ---- */
  const timings: SceneTiming[] = [];
  for (const [i, line] of lines.entries()) {
    checkCancelled(id);
    const file = path.join(dir, "audio", `scene-${i}.mp3`);
    const seconds = await speak(line, file);
    timings.push({ audioSeconds: seconds, audioFile: `audio/scene-${i}.mp3` });
    await update({
      stage: "narration",
      title: script.title,
      scenes,
      note: `Recording narration (${i + 1}/${scenes})`,
    });
  }

  /* ---- 3. artwork, only where the script asked for it ---- */
  const asked = script.scenes
    .map((scene, i) => ({ prompt: scene.imagePrompt, index: i + 1 }))
    .filter((s): s is { prompt: string; index: number } => !!s.prompt);
  // Earliest scenes win: a lesson builds in order, so the first picture is the
  // one carrying the idea everything after it rests on.
  const wanted = asked.slice(0, MAX_IMAGES);
  if (asked.length > wanted.length) {
    console.log(`[lesson ${id}] ${asked.length} scenes wanted art; drawing the first ${wanted.length}.`);
  }

  if (wanted.length) {
    await update({ stage: "images", title: script.title, scenes, note: `Drawing (0/${wanted.length})` });
    for (const [n, { prompt, index }] of wanted.entries()) {
      checkCancelled(id);
      const file = path.join(dir, "images", `scene-${index}.png`);
      if (await drawScene(prompt, file)) {
        timings[index].imageFile = `images/scene-${index}.png`;
      }
      await update({ stage: "images", title: script.title, scenes, note: `Drawing (${n + 1}/${wanted.length})` });
    }
  }

  /* ---- 4. the composition ---- */
  checkCancelled(id);
  await update({ stage: "composing", title: script.title, scenes, note: "Drawing the board" });
  await installPen(dir);
  await fs.writeFile(path.join(dir, "index.html"), composeLesson(script, timings));

  /* ---- 5. render ---- */
  const { total } = planTimeline(timings);
  checkCancelled(id);
  await update({
    stage: "rendering",
    title: script.title,
    scenes,
    durationSec: Math.floor(total),
    note: `Rendering ${Math.floor(total)}s of video`,
  });
  await renderComposition(id, dir);

  await update({
    stage: "done",
    title: script.title,
    scenes,
    durationSec: Math.floor(total),
    note: "Ready",
    finishedAt: Date.now(),
  });
}

/**
 * The pen font, copied in beside the composition.
 *
 * The renderer serves the lesson directory and nothing else, so a font sitting
 * in node_modules is not reachable from the composition's CSS — it has to be a
 * real file in the project. Copying it per lesson costs 31 KB and buys a
 * self-contained directory: it still renders months from now, with no network
 * and without this app being installed at all.
 *
 * A font that will not copy is not worth failing a render over. The board's
 * font stack falls through to the system's handwriting faces, so it still
 * reads as handwriting — just not in the same hand as the strokes around it.
 */
async function installPen(dir: string): Promise<void> {
  try {
    // Resolved against the portal's own package rather than `import.meta.url`,
    // which does not survive every bundler this file passes through.
    const resolve = createRequire(path.join(process.cwd(), "package.json")).resolve;
    const source = path.join(path.dirname(resolve("drawably/font.css")), "DrawablyPen.ttf");
    await fs.mkdir(path.join(dir, "fonts"), { recursive: true });
    await fs.copyFile(source, path.join(dir, "fonts", "DrawablyPen.ttf"));
  } catch (error) {
    console.warn("[lesson] the pen font didn't copy; the board falls back to a system hand.", error);
  }
}

/**
 * Hand the finished composition to HyperFrames.
 *
 * Run through `npx` rather than a dependency: the renderer drives its own
 * Chrome and ffmpeg, and pinning it into the portal's bundle would drag a
 * browser-sized toolchain into a Next build that has no use for it.
 */
async function renderComposition(id: string, dir: string): Promise<void> {
  try {
    // Not promisified, because the child handle is what makes the render
    // killable — a student who stops a lesson mid-render should not leave six
    // Chrome workers grinding away for another two minutes.
    await new Promise<void>((resolve, reject) => {
      const child = execFile(
        "npx",
        [
          "--yes",
          "hyperframes@0.8.21",
          "render",
          // Draft is visually identical for flat colour and type, and roughly
          // halves the wait — the thing a student notices about a lesson is
          // whether it arrived, not its bitrate.
          "--quality", "draft",
          "--output", "renders/lesson.mp4",
          "--quiet",
          dir,
        ],
        { cwd: dir, timeout: 15 * 60_000, maxBuffer: 8 * 1024 * 1024 },
        (error) => (error ? reject(error) : resolve())
      );
      const job = inFlight.get(id);
      if (job) job.child = child;
      // Stopped between the check above and the spawn — kill it right back.
      if (job?.cancelled) child.kill("SIGTERM");
    });
  } catch (error) {
    checkCancelled(id);
    const detail = error instanceof Error && "stderr" in error ? String(error.stderr).trim() : "";
    throw new Error(`The render failed.${detail ? ` ${detail.split("\n").slice(-3).join(" ")}` : ""}`);
  } finally {
    const job = inFlight.get(id);
    if (job) job.child = null;
  }

  // execFile resolving only means the CLI exited 0; the artifact is what
  // matters, and a zero-length file would play as a broken video.
  const file = path.join(dir, "renders", "lesson.mp4");
  const { size } = await fs.stat(file).catch(() => ({ size: 0 }));
  if (!size) throw new Error("The render finished but produced no video.");
}

/** Seconds of finished video, straight from the file, for the player. */
export async function lessonVideoSeconds(id: string): Promise<number | null> {
  try {
    return await audioSeconds(lessonVideoPath(id));
  } catch {
    return null;
  }
}
