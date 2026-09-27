import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { StudySet } from "./types";

/**
 * Study sets on disk, under ~/.slates/study.
 *
 * On the server rather than in browser storage so a set built on the laptop is
 * there on the phone too — both talk to the same host. The material a set was
 * written from is kept beside it, so "more practice" can draw on the same
 * handouts without going back to Schoology.
 */

/** A Schoology item id, or "c…" for a test the student added by hand. */
const ID = /^(?:\d{1,24}|c[a-z0-9]{10,30})$/;
const FILE = /^(?:\d{1,24}|c[a-z0-9]{10,30})\.json$/;

export function isStudyId(id: string): boolean {
  return ID.test(id);
}

function dir(): string {
  return path.join(os.homedir(), ".slates", "study");
}

function fileFor(id: string, suffix = ""): string {
  if (!isStudyId(id)) throw new Error("Invalid study id.");
  return path.join(dir(), `${id}${suffix}.json`);
}

async function writeAtomic(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await fs.rename(temporary, file);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function getSet(id: string): Promise<StudySet | null> {
  return readJson<StudySet>(fileFor(id));
}

export async function saveSet(set: StudySet): Promise<StudySet> {
  const next = { ...set, updatedAt: Date.now() };
  await writeAtomic(fileFor(set.id), next);
  return next;
}

const queues = new Map<string, Promise<unknown>>();

/**
 * Read, change and write one set; returns null when it no longer exists.
 *
 * Changes to the same set run one after another. A build reports its steps
 * while the student is marking cards, and two read-modify-writes racing each
 * other would drop whichever landed first.
 */
export function updateSet(id: string, change: (set: StudySet) => StudySet): Promise<StudySet | null> {
  const next = (queues.get(id) ?? Promise.resolve()).then(async () => {
    const set = await getSet(id);
    return set ? saveSet(change(set)) : null;
  });
  queues.set(id, next.catch(() => {}));
  return next;
}

export async function listSets(): Promise<StudySet[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const sets = await Promise.all(
    names
      .filter((name) => FILE.test(name))
      .map((name) => getSet(name.slice(0, -5)).catch(() => null)),
  );
  return sets.filter((set): set is StudySet => !!set);
}

/** A test the student took off the Study list, kept by id so the next sync doesn't bring it back. */
export interface HiddenTest {
  title: string;
  courseId: string;
  at: number;
}

const hiddenFile = () => path.join(dir(), "hidden.json");

export async function getHidden(): Promise<Record<string, HiddenTest>> {
  return (await readJson<Record<string, HiddenTest>>(hiddenFile())) ?? {};
}

/** Newest first, as the list shows them. */
export function hiddenList(hidden: Record<string, HiddenTest>) {
  return Object.entries(hidden)
    .map(([id, test]) => ({ id, ...test }))
    .sort((a, b) => b.at - a.at);
}

export type HiddenEntry = ReturnType<typeof hiddenList>[number];

/** Takes tests off the list or puts them back, in one write, queued like a set's own changes. */
export function changeHidden(change: (hidden: Record<string, HiddenTest>) => Record<string, HiddenTest>): Promise<Record<string, HiddenTest>> {
  const next = (queues.get("hidden") ?? Promise.resolve()).then(async () => {
    const updated = change(await getHidden());
    await writeAtomic(hiddenFile(), updated);
    return updated;
  });
  queues.set("hidden", next.catch(() => {}));
  return next;
}

export async function deleteSet(id: string): Promise<void> {
  await fs.rm(fileFor(id), { force: true });
  await fs.rm(fileFor(id, ".material"), { force: true });
}

export interface StoredMaterial {
  n: number;
  title: string;
  text: string;
}

export function getMaterial(id: string): Promise<StoredMaterial[] | null> {
  return readJson<StoredMaterial[]>(fileFor(id, ".material"));
}

export function saveMaterial(id: string, material: StoredMaterial[]): Promise<void> {
  return writeAtomic(fileFor(id, ".material"), material);
}
