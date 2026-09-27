"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { TestKind } from "@/lib/study/detect";
import type { StudyInputs, StudyPick, StudyUpload } from "@/lib/study/types";
import type { Course } from "@/lib/types";
import { Icon, ICON, Spinner, Toggle } from "../ui";
import { listMaterials, MAX_UPLOAD_MB, removeUpload, UPLOAD_ACCEPT, uploadFile, type MaterialEntry } from "./useStudySets";

/**
 * Where a study set's material comes from, chosen before it's built: the
 * unit's material Slates finds on its own, items the student picks from the
 * class's Materials, files they upload, and their own notes on what's on it.
 * The same sheet adds a test Slates didn't find.
 */

export interface SheetTest {
  /** A test Slates found, or a set already built; absent when adding one by hand. */
  id?: string;
  custom: boolean;
  title: string;
  courseId: string;
  kind: TestKind;
  /** yyyy-mm-dd; only asked for when adding a test by hand. */
  date: string;
  /** How a found test reads, e.g. "AP Physics 1 · Quiz · tomorrow". */
  meta?: string;
}

export interface BuildChoice {
  title: string;
  courseId: string;
  kind: TestKind;
  date: string;
  picks: StudyPick[];
  uploads: string[];
  notes: string;
  auto: boolean;
}

interface UploadRow {
  key: string;
  name: string;
  state: "uploading" | "ready" | "failed";
  upload?: StudyUpload;
  error?: string;
  /** Uploaded in this sheet, so cancelling throws it away; ones from an earlier build stay. */
  fresh: boolean;
}

const KINDS: { id: TestKind; label: string }[] = [
  { id: "test", label: "Test" },
  { id: "quiz", label: "Quiz" },
  { id: "exam", label: "Exam" },
];

const KIND_OF_ITEM: Record<string, string> = {
  document: "File",
  page: "Page",
  link: "Link",
  assignment: "Assignment",
  assessment: "Test",
  discussion: "Discussion",
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extOf(name: string): string {
  return (/\.([a-z0-9]{1,8})$/i.exec(name)?.[1] ?? "").toLowerCase();
}

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function list(parts: string[]): string {
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** One level of the class's Materials at a time, with folders to open and items to pick. */
function MaterialsBrowser({ courseId, picked, onToggle }: { courseId: string; picked: StudyPick[]; onToggle: (pick: StudyPick) => void }) {
  const [trail, setTrail] = useState<{ id: string | null; title: string }[]>([{ id: null, title: "Materials" }]);
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<{ key: string; items: MaterialEntry[]; error: string | null } | null>(null);
  const folder = trail.at(-1)!;
  const key = `${courseId}:${folder.id ?? ""}:${nonce}`;
  const loading = result?.key !== key;

  useEffect(() => {
    let alive = true;
    listMaterials(courseId, folder.id).then(
      (items) => alive && setResult({ key, items, error: null }),
      (error: unknown) => alive && setResult({ key, items: [], error: message(error) }),
    );
    return () => {
      alive = false;
    };
  }, [courseId, folder.id, key]);

  const where = trail.map((step) => step.title).join(" › ");
  const items = loading ? [] : (result?.items ?? []);
  const folders = items.filter((item) => item.kind === "folder" && item.folderId);
  const files = items.filter((item) => item.kind !== "folder");

  return (
    <div className="study-browser">
      <nav className="study-crumbs" aria-label="Folder">
        {trail.map((step, index) => (
          <span key={`${step.id ?? "root"}-${index}`}>
            {index > 0 && <span className="study-crumb-sep" aria-hidden="true">›</span>}
            <button type="button" disabled={index === trail.length - 1} onClick={() => setTrail(trail.slice(0, index + 1))}>
              {step.title}
            </button>
          </span>
        ))}
      </nav>

      {loading && (
        <ul className="study-browser-list" aria-busy="true">
          {[0, 1, 2, 3].map((row) => (
            <li key={row} className="study-skeleton-row"><span /><span /></li>
          ))}
        </ul>
      )}

      {!loading && result?.error && (
        <div className="study-browser-empty" role="alert">
          <p>Couldn’t open this class’s Materials: {result.error}</p>
          <button type="button" className="btn btn--quiet" onClick={() => setNonce((n) => n + 1)}>
            <Icon path={ICON.retry} size={12} /> Try again
          </button>
        </div>
      )}

      {!loading && !result?.error && !items.length && <p className="study-browser-empty">This folder is empty.</p>}

      {!loading && !result?.error && items.length > 0 && (
        <ul className="study-browser-list">
          {folders.map((item) => (
            <li key={`f-${item.folderId}`}>
              <button type="button" className="study-browser-row is-folder" onClick={() => setTrail([...trail, { id: item.folderId, title: item.title }])}>
                <Icon path={ICON.folder} size={14} />
                <span className="study-browser-title">{item.title}</span>
                <Icon path={ICON.chevronLeft} size={11} style={{ transform: "rotate(180deg)" }} />
              </button>
            </li>
          ))}
          {files.map((item) => {
            const on = picked.some((pick) => pick.url === item.url);
            return (
              <li key={`i-${item.url}`}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  className={`study-browser-row${on ? " is-on" : ""}`}
                  disabled={!item.readable}
                  title={item.readable ? undefined : "Slates can't read this kind of item"}
                  onClick={() => onToggle({ title: item.title, url: item.url, where })}
                >
                  <span className="study-check" aria-hidden="true">{on && <Icon path={ICON.check} size={10} />}</span>
                  <span className="study-browser-title">{item.title}</span>
                  <span className="study-browser-kind">{item.readable ? (KIND_OF_ITEM[item.kind] ?? item.kind) : "Can’t read"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function StudyBuildSheet({
  test,
  courses,
  initial,
  onClose,
  onBuild,
}: {
  test: SheetTest;
  courses: Course[];
  initial?: StudyInputs;
  onClose: () => void;
  onBuild: (choice: BuildChoice) => Promise<void>;
}) {
  const ids = useId();
  const panel = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(test.title);
  const [courseId, setCourseId] = useState(test.courseId || courses[0]?.id || "");
  const [kind, setKind] = useState<TestKind>(test.kind);
  const [date, setDate] = useState(test.date);
  const [auto, setAuto] = useState(initial?.auto ?? true);
  const [picks, setPicks] = useState<StudyPick[]>(initial?.picks ?? []);
  const [uploads, setUploads] = useState<UploadRow[]>(
    (initial?.uploads ?? []).map((upload) => ({ key: upload.id, name: upload.name, state: "ready", upload: { id: upload.id, name: upload.name, ext: extOf(upload.name), bytes: 0, chars: 0, at: 0 }, fresh: false })),
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [browsing, setBrowsing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploadsRef = useRef(uploads);
  const cancelRef = useRef<() => void>(() => {});
  const customRef = useRef(test.custom);

  useEffect(() => {
    uploadsRef.current = uploads;
  }, [uploads]);

  // Mount-only: the list behind polls while a set builds, and re-running this would pull focus out of a field mid-word.
  // Focus the first thing to fill in, keep Tab inside, close on Escape, and hand focus back on the way out.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const root = panel.current;
    root?.querySelector<HTMLElement>(customRef.current ? "input" : ".study-sheet-close")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelRef.current();
      } else if (event.key === "Tab" && root) {
        const focusables = [...root.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select, textarea, [tabindex='0']")];
        const first = focusables[0];
        const last = focusables.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("keydown", keydown);
      opener?.focus();
    };
  }, []);

  function cancel() {
    // Files uploaded here and never used would otherwise sit on the host forever.
    for (const row of uploadsRef.current) if (row.fresh && row.upload) void removeUpload(row.upload.id);
    onClose();
  }

  useEffect(() => {
    cancelRef.current = cancel;
  });

  async function addFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
      const accepted = UPLOAD_ACCEPT.split(",").map((ext) => ext.slice(1));
      if (!accepted.includes(extOf(file.name))) {
        setUploads((rows) => [...rows, { key, name: file.name, state: "failed", error: "Slates reads PDF, Word, PowerPoint and text files.", fresh: true }]);
        continue;
      }
      if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
        setUploads((rows) => [...rows, { key, name: file.name, state: "failed", error: `Over ${MAX_UPLOAD_MB} MB.`, fresh: true }]);
        continue;
      }
      setUploads((rows) => [...rows, { key, name: file.name, state: "uploading", fresh: true }]);
      try {
        const upload = await uploadFile(file);
        setUploads((rows) => rows.map((row) => (row.key === key ? { ...row, upload, state: upload.error ? "failed" : "ready", error: upload.error } : row)));
      } catch (err) {
        setUploads((rows) => rows.map((row) => (row.key === key ? { ...row, state: "failed", error: message(err) } : row)));
      }
    }
  }

  function dropUpload(row: UploadRow) {
    if (row.fresh && row.upload) void removeUpload(row.upload.id);
    setUploads((rows) => rows.filter((entry) => entry.key !== row.key));
  }

  function togglePick(pick: StudyPick) {
    setPicks((current) => (current.some((entry) => entry.url === pick.url) ? current.filter((entry) => entry.url !== pick.url) : [...current, pick]));
  }

  const ready = uploads.filter((row) => row.state === "ready" && row.upload);
  const uploading = uploads.some((row) => row.state === "uploading");
  const missing = test.custom && (!title.trim() || !courseId);
  const course = courses.find((entry) => entry.id === courseId);

  const using = [
    auto && "the unit’s material in Schoology",
    picks.length && `${picks.length} ${picks.length === 1 ? "item" : "items"} you picked`,
    ready.length && `${ready.length} ${ready.length === 1 ? "file" : "files"} you uploaded`,
    notes.trim() && "your notes",
  ].filter(Boolean) as string[];

  async function build() {
    setBuilding(true);
    setError(null);
    try {
      await onBuild({ title: title.trim(), courseId, kind, date, picks, uploads: ready.map((row) => row.upload!.id), notes: notes.trim(), auto });
    } catch (err) {
      setError(message(err));
      setBuilding(false);
    }
  }

  return (
    <div className="study-sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && cancel()}>
      <div ref={panel} className="study-sheet" role="dialog" aria-modal="true" aria-labelledby={`${ids}-title`}>
        <header className="study-sheet-head">
          <div>
            <h2 id={`${ids}-title`}>{test.custom ? (test.id ? "Edit this test" : "Add a test") : "Build a study set"}</h2>
            <p className="study-muted">
              {test.custom ? "Tell Slates what it is and what it’s on." : (test.meta ?? "Choose what Slates builds it from.")}
            </p>
          </div>
          <button type="button" className="icon-btn study-sheet-close" aria-label="Close" onClick={cancel}>
            <Icon path={ICON.close} size={14} />
          </button>
        </header>

        <div className="study-sheet-body">
          {test.custom ? (
            <section className="study-field-group" aria-label="The test">
              <label className="study-field">
                <span>What’s the test?</span>
                <input className="input input--lg" value={title} maxLength={200} placeholder="e.g. Ch 4 quiz: friction and inclines" onChange={(event) => setTitle(event.target.value)} />
              </label>
              <div className="study-field-row">
                <label className="study-field">
                  <span>Class</span>
                  <select className="input input--lg" value={courseId} onChange={(event) => setCourseId(event.target.value)}>
                    {courses.map((entry) => (
                      <option key={entry.id} value={entry.id}>{entry.short?.trim() || entry.name}</option>
                    ))}
                  </select>
                </label>
                <label className="study-field">
                  <span>Date</span>
                  <input className="input input--lg" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
                </label>
              </div>
              <div className="study-field">
                <span id={`${ids}-kind`}>Kind</span>
                <div className="useg study-kinds" role="radiogroup" aria-labelledby={`${ids}-kind`}>
                  {KINDS.map((entry) => (
                    <button key={entry.id} type="button" role="radio" aria-checked={kind === entry.id} className={kind === entry.id ? "is-on" : undefined} onClick={() => setKind(entry.id)}>
                      {entry.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          ) : (
            <section className="study-sheet-test" aria-label="The test">
              {course && <span className="study-course"><span className="study-course-dot" style={{ background: course.dot }} />{course.short?.trim() || course.name}</span>}
              <strong>{test.title}</strong>
            </section>
          )}

          <section className="study-field-group" aria-labelledby={`${ids}-material`}>
            <h3 id={`${ids}-material`}>Material</h3>

            <div className="study-option">
              <div>
                <strong>Find the unit’s material in Schoology</strong>
                <span>Review sheets, the unit’s folders and its homework, the way Slates does on its own.</span>
              </div>
              <Toggle on={auto} label="Find the unit's material in Schoology" onClick={() => setAuto((value) => !value)} />
            </div>

            <div className="study-option is-stacked">
              <div className="study-option-head">
                <div>
                  <strong>From the class’s Materials</strong>
                  <span>{picks.length ? `${picks.length} picked, read first` : "Pick the exact slides, notes or review sheets."}</span>
                </div>
                <button type="button" className="btn btn--quiet" aria-expanded={browsing} disabled={!courseId} onClick={() => setBrowsing((value) => !value)}>
                  {browsing ? "Done" : "Browse"}
                </button>
              </div>
              {picks.length > 0 && (
                <ul className="study-picks">
                  {picks.map((pick) => (
                    <li key={pick.url}>
                      <Icon path={ICON.file} size={12} />
                      <span className="study-pick-title">{pick.title}</span>
                      <button type="button" className="study-x" aria-label={`Remove ${pick.title}`} onClick={() => togglePick(pick)}>
                        <Icon path={ICON.close} size={10} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {browsing && courseId && <MaterialsBrowser courseId={courseId} picked={picks} onToggle={togglePick} />}
            </div>

            <div className="study-option is-stacked">
              <div>
                <strong>Your own files</strong>
                <span>Notes, a review packet, slides the teacher handed out in class.</span>
              </div>
              <label
                className={`study-drop${dragging ? " is-over" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  void addFiles(event.dataTransfer.files);
                }}
              >
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  accept={UPLOAD_ACCEPT}
                  className="study-drop-input"
                  onChange={(event) => {
                    if (event.target.files) void addFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
                <Icon path={[ICON.upload, ICON.uploadTray]} size={16} />
                <span>
                  <strong>Drop files here</strong> or choose them
                </span>
                <span className="study-drop-hint">PDF, Word, PowerPoint or text, up to {MAX_UPLOAD_MB} MB each</span>
              </label>
              {uploads.length > 0 && (
                <ul className="study-uploads">
                  {uploads.map((row) => (
                    <li key={row.key} className={row.state === "failed" ? "is-bad" : undefined}>
                      <span className="study-upload-ext" aria-hidden="true">{extOf(row.name) || "file"}</span>
                      <span className="study-upload-main">
                        <span className="study-pick-title">{row.name}</span>
                        <span className="study-upload-state">
                          {row.state === "uploading" ? (
                            <><Spinner size={10} /> Reading it</>
                          ) : row.state === "failed" ? (
                            row.error
                          ) : row.upload && row.upload.chars ? (
                            `${sizeLabel(row.upload.bytes)} · ${row.upload.chars.toLocaleString()} characters read`
                          ) : (
                            "Added earlier"
                          )}
                        </span>
                      </span>
                      {row.state !== "uploading" && (
                        <button type="button" className="study-x" aria-label={`Remove ${row.name}`} onClick={() => dropUpload(row)}>
                          <Icon path={ICON.close} size={10} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <label className="study-option is-stacked">
              <span>
                <strong>What’s on it?</strong>
                <span>Optional. Whatever the teacher said: chapters, topics, what to focus on.</span>
              </span>
              <textarea
                className="input study-notes"
                value={notes}
                maxLength={4000}
                rows={3}
                placeholder="e.g. Sections 4.4–4.6, friction and inclined planes. No calculators."
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>
          </section>
        </div>

        <footer className="study-sheet-foot">
          {error ? (
            <p className="study-notice is-bad" role="alert"><Icon path={ICON.alert} size={13} /> {error}</p>
          ) : (
            <p className="study-muted">
              {using.length ? `Built from ${list(using)}.` : "Nothing chosen, so it’s built from the test’s title alone."}
            </p>
          )}
          <div className="study-sheet-actions">
            <button type="button" className="btn btn--quiet" onClick={cancel}>Cancel</button>
            <button type="button" className={`btn btn--primary${building ? " btn--busy" : ""}`} disabled={missing || uploading || building} onClick={() => void build()}>
              {building ? <><Spinner size={12} /> Starting</> : "Build study set"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
