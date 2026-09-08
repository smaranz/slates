"use client";

import { useMemo, useState } from "react";

import { useCounselor } from "@/lib/counselor/store";
import { uid } from "@/lib/counselor/state";
import type { CounselorDoc, DocumentKind } from "@/lib/counselor/types";
import TutorMarkdown from "../TutorMarkdown";
import { Icon, ICON } from "../ui";

/**
 * What the counselor actually wrote.
 *
 * These are the point of the whole thing: a brag sheet, a deadline checklist,
 * an essay outline you can hand a teacher. So they get a real reading view and
 * a real editor rather than being a transcript of a chat message — you own
 * them, and can change what the counselor got wrong.
 */

const KIND_LABEL: Record<DocumentKind, string> = {
  "activity-list": "Activity list",
  "brag-sheet": "Brag sheet",
  checklist: "Checklist",
  "college-research": "College research",
  "essay-outline": "Essay outline",
  "essay-brainstorm": "Essay brainstorm",
  "letter-draft": "Draft letter",
  "study-plan": "Study plan",
  timeline: "Timeline",
  summary: "Summary",
  notes: "Notes",
  other: "Document",
};

export default function DocumentsView() {
  const c = useCounselor();

  // The editor is keyed to a document rather than being a boolean, so
  // selecting a different one drops the edit instead of carrying the previous
  // document's body across into it.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const open = useMemo(
    () => c.documents.find((d) => d.id === c.docId) ?? c.documents[0] ?? null,
    [c.documents, c.docId]
  );

  const editing = Boolean(open) && editingId === open?.id;

  function create() {
    const now = Date.now();
    const doc: CounselorDoc = {
      id: uid(),
      kind: "notes",
      title: "Untitled",
      content: "",
      source: "student",
      createdAt: now,
      updatedAt: now,
    };
    c.saveDoc(doc);
    c.openDoc(doc.id);
    setDraft("");
    setEditingId(doc.id);
  }

  return (
    <div className="counselor-split">
      <div className="counselor-list-pane">
        <div className="counselor-pane-head">
          <span className="section-label" style={{ flex: 1 }}>
            Documents
          </span>
          <button type="button" className="icon-btn" onClick={create} aria-label="New document" style={{ width: 26, height: 26 }}>
            <Icon path={ICON.plus} size={13} />
          </button>
        </div>

        <div className="counselor-list-scroll">
          {c.documents.length === 0 && (
            <p className="counselor-empty-note">
              Nothing yet. Ask the counselor for an activity list, a brag sheet, or a deadline
              checklist and it&apos;ll write one here.
            </p>
          )}
          {c.documents.map((d) => (
            <button
              key={d.id}
              type="button"
              className={`counselor-doc-row${d.id === open?.id ? " is-active" : ""}`}
              onClick={() => c.openDoc(d.id)}
            >
              <span className="truncate counselor-doc-title">{d.title}</span>
              <span className="counselor-doc-meta">
                {KIND_LABEL[d.kind]} · {new Date(d.updatedAt).toLocaleDateString([], { month: "short", day: "numeric" })}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="counselor-detail-pane">
        {!open ? (
          <div className="counselor-blank">Pick a document.</div>
        ) : (
          <>
            <div className="counselor-detail-head">
              <div style={{ minWidth: 0, flex: 1 }}>
                <p className="counselor-detail-title truncate">{open.title}</p>
                <p className="counselor-detail-sub">
                  {KIND_LABEL[open.kind]} · {open.source === "counselor" ? "written by your counselor" : "yours"}
                </p>
              </div>
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => {
                  if (editing) {
                    c.saveDoc({ ...open, content: draft, updatedAt: Date.now() });
                    setEditingId(null);
                  } else {
                    setDraft(open.content);
                    setEditingId(open.id);
                  }
                }}
              >
                {editing ? "Save" : "Edit"}
              </button>
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => download(open)}
              >
                <Icon path={ICON.download} size={13} />
                Download
              </button>
              <button
                type="button"
                className="icon-btn"
                style={{ width: 30, height: 30 }}
                onClick={() => c.removeDoc(open.id)}
                aria-label="Delete document"
              >
                <Icon path={ICON.trash} size={13} />
              </button>
            </div>

            <div className="counselor-detail-scroll">
              {editing ? (
                <textarea
                  className="counselor-doc-editor"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  spellCheck
                />
              ) : open.content.trim() ? (
                <TutorMarkdown text={open.content} />
              ) : (
                <p className="counselor-empty-note">Empty. Hit Edit to write something.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Saves the Markdown as-is. The counselor writes real Markdown, so this is the document. */
function download(doc: CounselorDoc) {
  const blob = new Blob([`# ${doc.title}\n\n${doc.content}`], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${doc.title.replace(/[^\w\s-]/g, "").trim() || "document"}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
