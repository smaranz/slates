"use client";

import { useState } from "react";

import { canSaveToComputer, openHostFile, saveHostFile } from "@/lib/desktop-bridge";
import { describeLearned, type Learned } from "@/lib/learning/types";
import s from "./host-files.module.css";
import { Icon, ICON, Spinner } from "./ui";

/**
 * A file that lives on the host, offered where it was made: open it in its
 * own app (the Mac app saves it into Downloads › Slates first), or keep a
 * copy. Same card in an agent's chat and under a tutor reply.
 */

/** A four-point spark: what a helper learned. */
export const LEARNED_ICON = "M12 2.5l1.9 5.4 5.6 1.9-5.6 1.9L12 17.1l-1.9-5.4-5.6-1.9 5.6-1.9zM18.5 14.5l.9 2.3 2.1.8-2.1.8-.9 2.3-.9-2.3-2.1-.8 2.1-.8z";

/** What the extension means, in the words a student would use. */
const KIND: Record<string, string> = {
  docx: "Word document",
  doc: "Word document",
  pdf: "PDF",
  pptx: "Presentation",
  key: "Presentation",
  xlsx: "Spreadsheet",
  csv: "Spreadsheet",
  png: "Image",
  jpg: "Image",
  jpeg: "Image",
  gif: "Image",
  webp: "Image",
  svg: "Image",
  md: "Markdown",
  txt: "Text",
  html: "Web page",
  zip: "Zip archive",
  mp3: "Audio",
  mp4: "Video",
  json: "Data",
};

export function fileKind(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return KIND[ext] ?? (ext ? ext.toUpperCase() : "File");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Open and Save, with what went wrong if either did. */
export function useHostFile(url: string, name: string) {
  const [busy, setBusy] = useState<"open" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (kind: "open" | "save") => {
    setBusy(kind);
    setError(null);
    void (kind === "open" ? openHostFile(url, name) : saveHostFile(url, name))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(null));
  };
  return { busy, error, open: () => run("open"), save: () => run("save") };
}

export function FileCard({ url, name, size, note, from }: { url: string; name: string; size: number; note?: string; from?: string }) {
  const file = useHostFile(url, name);
  const desktop = canSaveToComputer();
  return (
    <div>
      <div className={s.card}>
        <span className={s.icon}>
          <Icon path={ICON.file} size={16} />
        </span>
        <span className={s.text}>
          <span className={s.name} title={name}>{name}</span>
          <span className={s.meta}>{[fileKind(name), formatBytes(size), from ? `from ${from}` : ""].filter(Boolean).join(" · ")}</span>
          {note && <span className={s.note}>{note}</span>}
        </span>
        <span className={s.actions}>
          <button type="button" className={`${s.button} ${s.primary}`} onClick={file.open} disabled={!!file.busy}>
            {file.busy === "open" ? <Spinner size={12} /> : null}
            Open
          </button>
          <button
            type="button"
            className={s.button}
            onClick={file.save}
            disabled={!!file.busy}
            aria-label={desktop ? `Show ${name} in Finder` : `Download ${name}`}
            title={desktop ? "Saved in Downloads › Slates; show it in Finder" : "Download"}
          >
            {file.busy === "save" ? <Spinner size={12} /> : <Icon path={ICON.download} size={13} />}
            {desktop ? "Show" : "Save"}
          </button>
        </span>
      </div>
      {file.error && <p className={s.error}>{file.error}</p>}
    </div>
  );
}

/** What a helper saved to memory or its skills, in a line the student can skim past. */
export function LearnedNote({ items }: { items: Learned[] }) {
  if (!items.length) return null;
  return (
    <div className={s.learned}>
      {items.map((item, i) => (
        <div key={`${item.kind}-${item.text}-${i}`} className={s.learnedRow}>
          <Icon path={LEARNED_ICON} size={12} />
          <span>{describeLearned(item)}</span>
        </div>
      ))}
    </div>
  );
}
