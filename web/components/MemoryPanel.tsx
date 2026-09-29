"use client";

import { useCallback, useEffect, useState } from "react";

import type { MemoryBookView } from "@/lib/learning/types";
import s from "./agent/agent.module.css";
import f from "./host-files.module.css";
import { Icon, ICON, Spinner } from "./ui";

/**
 * What the tutor remembers, where the student can see it and correct it: the
 * profile every agent and the tutor share, the tutor's own notes, and the
 * skills they've all learned. `version` changes whenever a reply saves
 * something, so the panel keeps up while it's open.
 */

interface MemoryView {
  student: MemoryBookView;
  tutor: MemoryBookView;
  skills: { id: string; name: string; description?: string; by?: string; uses: number }[];
}

function Usage({ book }: { book: MemoryBookView }) {
  const share = Math.min(1, book.used / book.limit);
  return (
    <div title={`${book.used.toLocaleString()} of ${book.limit.toLocaleString()} characters`}>
      <div className={`${f.usage} ${share > 0.85 ? f.usageFull : ""}`} role="meter" aria-valuemin={0} aria-valuemax={book.limit} aria-valuenow={book.used} aria-label="How full this memory is">
        <i style={{ width: `${Math.max(2, share * 100)}%` }} />
      </div>
    </div>
  );
}

export default function MemoryPanel({ onClose, version }: { onClose: () => void; version: number }) {
  const [view, setView] = useState<MemoryView | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/memory", { cache: "no-store" });
      if (!response.ok) throw new Error(`Couldn't load memory (${response.status}).`);
      setView((await response.json()) as MemoryView);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, version]);

  const change = async (body: Record<string, string>) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/memory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `That didn't save (${response.status}).`);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const book = (name: "student" | "tutor", entries: MemoryBookView["entries"], empty: string) =>
    entries.length ? (
      <ul className={s.memory}>
        {entries.map((entry) => (
          <li key={entry.id}>
            <span>{entry.text}</span>
            <button type="button" aria-label={`Forget: ${entry.text}`} title="Forget" disabled={busy} onClick={() => void change({ op: "forget", book: name, id: entry.id })}>
              <Icon path={ICON.close} size={10} />
            </button>
          </li>
        ))}
      </ul>
    ) : (
      <p className={s.muted}>{empty}</p>
    );

  return (
    <aside className={s.panel} aria-label="Memory">
      <div className={s.panelHead}>
        <h2>Memory</h2>
        <button type="button" className={s.iconButton} aria-label="Close memory" onClick={onClose}>
          <Icon path={ICON.close} size={14} />
        </button>
      </div>
      <div className={s.panelBody}>
        {!view ? (
          error ? <p className={s.bad}>{error}</p> : <Spinner size={16} />
        ) : (
          <>
            <h3 className={s.section}>About you</h3>
            <p className={s.muted}>Shared with your agents. The tutor saves what it learns as you talk, and looks back over chats afterwards for anything it missed.</p>
            <Usage book={view.student} />
            {book("student", view.student.entries, "Nothing yet.")}
            <form
              className={f.addRow}
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.trim()) void change({ op: "add", book: "student", text: draft }).then((ok) => ok && setDraft(""));
              }}
            >
              <input className={s.field} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Something it should always know" aria-label="Add a memory" maxLength={400} />
              <button type="submit" className={s.quiet} disabled={busy || !draft.trim()}>
                Add
              </button>
            </form>

            <h3 className={s.section}>The tutor&apos;s notes</h3>
            <Usage book={view.tutor} />
            {book("tutor", view.tutor.entries, "What it learns about helping you: what worked, how you like answers.")}

            <h3 className={s.section}>Skills</h3>
            {view.skills.length ? (
              <ul className={f.list}>
                {view.skills.map((skill) => (
                  <li key={skill.id} className={f.row}>
                    <span className={f.rowText}>
                      <span className={f.rowName}>{skill.name}</span>
                      <span className={f.rowMeta}>
                        {[skill.description, skill.by && skill.by !== "You" ? `learned by ${skill.by}` : "", skill.uses ? `used ${skill.uses}×` : ""].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={s.muted}>Saved procedures the tutor and your agents follow, like how you want a study guide laid out. They learn them from what works; edit them in Agent › Skills.</p>
            )}
            {error && <p className={s.bad}>{error}</p>}
          </>
        )}
      </div>
    </aside>
  );
}
