"use client";

import { useMemo, useState } from "react";

import { countWords } from "@/lib/counselor/ai-signals";
import {
  STAGE_LABEL,
  daysUntil,
  flaggedOf,
  groupByApplication,
  inScope,
  scoreOf,
  stageOf,
} from "@/lib/counselor/essays";
import { DEFAULT_LIMIT, ESSAY_KIND_LABEL } from "@/lib/counselor/rubric";
import { uid } from "@/lib/counselor/state";
import { useCounselor } from "@/lib/counselor/store";
import { ESSAY_KINDS, type Essay, type EssayKind } from "@/lib/counselor/types";
import { Icon, ICON } from "../ui";
import { DeleteEssayDialog, Studio } from "./EssaysView";

/**
 * The college essays, as a set rather than a list.
 *
 * A student doesn't have "an essay" in November — they have eleven, spread
 * across six applications, three of which are 250 words and due the same
 * Tuesday. The school side's list can't answer the question that actually
 * keeps them up: what is still unwritten, what is over the limit, and what
 * is due first. So this half is a tracker, grouped by application and sorted
 * by deadline, and the same editor opens when you pick one.
 *
 * Everything on screen is derived from the essays themselves. There is no
 * status field to keep up to date, because a status field a student has to
 * remember to change is a status field that lies.
 */

type Tab = "draft" | "report" | "history";

export default function CollegeEssaysView() {
  const c = useCounselor();
  const [tab, setTab] = useState<Tab>("draft");
  const [pendingDelete, setPendingDelete] = useState<Essay | null>(null);

  const essays = useMemo(() => c.essays.filter(inScope("college")), [c.essays]);
  const groups = useMemo(() => groupByApplication(essays, c.applications), [essays, c.applications]);

  const essay = useMemo(() => essays.find((e) => e.id === c.essayId) ?? null, [essays, c.essayId]);

  function create(collegeName?: string, kind: EssayKind = collegeName ? "supplement" : "personal-statement") {
    const now = Date.now();
    const fresh: Essay = {
      id: uid(),
      title: collegeName ? `${collegeName} — untitled` : "Personal statement",
      scope: "college",
      kind,
      prompt: "",
      wordLimit: DEFAULT_LIMIT[kind],
      collegeName,
      content: "",
      versions: [],
      createdAt: now,
      updatedAt: now,
    };
    c.createEssay(fresh);
    c.openEssay(fresh.id);
    setTab("draft");
  }

  const totals = useMemo(() => {
    let unwritten = 0;
    let over = 0;
    let checked = 0;
    for (const e of essays) {
      const stage = stageOf(e, countWords(e.content));
      if (stage === "empty") unwritten++;
      if (stage === "over") over++;
      if (stage === "checked") checked++;
    }
    return { unwritten, over, checked };
  }, [essays]);

  return (
    <div className="counselor-split">
      <div className="counselor-list-pane">
        <div className="counselor-pane-head">
          <span className="section-label" style={{ flex: 1 }}>
            College essays
          </span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => create()}
            aria-label="New essay"
            style={{ width: 26, height: 26 }}
          >
            <Icon path={ICON.plus} size={13} />
          </button>
        </div>

        <div className="counselor-list-scroll">
          {essays.length === 0 && (
            <p className="counselor-empty-note">
              Nothing here yet. Start with the personal statement — it&apos;s the one every school
              reads. Supplements get added under whichever application they belong to.
            </p>
          )}

          {groups.map((group) => (
            <div key={group.title} className="essay-group">
              <div className="essay-group-head">
                <span className="essay-group-title">{group.title}</span>
                {group.deadline && <Deadline deadline={group.deadline} />}
              </div>

              {group.essays.length === 0 && (
                <p className="essay-group-empty">No essays yet.</p>
              )}

              {group.essays.map((e) => (
                <EssayRow
                  key={e.id}
                  essay={e}
                  active={e.id === essay?.id}
                  onOpen={() => {
                    c.openEssay(e.id);
                    setTab("draft");
                  }}
                  onDelete={() => setPendingDelete(e)}
                />
              ))}

              <button
                type="button"
                className="essay-group-add"
                onClick={() => create(group.application?.collegeName ?? (group.essays[0]?.collegeName || undefined))}
              >
                <Icon path={ICON.plus} size={11} />
                Add an essay
              </button>
            </div>
          ))}
        </div>
      </div>

      {pendingDelete && (
        <DeleteEssayDialog
          essay={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            c.removeEssay(pendingDelete.id);
            setPendingDelete(null);
          }}
        />
      )}

      {essay ? (
        <Studio
          key={essay.id}
          essay={essay}
          tab={tab}
          setTab={setTab}
          /* Closing the essay drops back to the set, which is this half's home. */
          onShowList={() => c.openEssay(null)}
          onRequestDelete={() => setPendingDelete(essay)}
          scope="college"
          />
      ) : (
        <Overview essays={essays} totals={totals} onOpen={(id) => { c.openEssay(id); setTab("draft"); }} />
      )}
    </div>
  );
}

/** How long is left, in the words a student would use about it. */
function Deadline({ deadline }: { deadline: string }) {
  const days = daysUntil(deadline);
  const tone = days < 0 ? "var(--dim)" : days <= 7 ? "var(--bad)" : days <= 21 ? "var(--warn)" : "var(--dim)";
  const text =
    days < 0 ? "passed" : days === 0 ? "today" : days === 1 ? "tomorrow" : `${days} days`;
  return (
    <span className="essay-group-deadline" style={{ color: tone }}>
      {text}
    </span>
  );
}

function EssayRow({ essay, active, onOpen, onDelete }: { essay: Essay; active: boolean; onOpen: () => void; onDelete: () => void }) {
  const words = countWords(essay.content);
  const stage = stageOf(essay, words);
  const score = scoreOf(essay);

  return (
    <div className={`essay-row${active ? " is-active" : ""}`}>
      <button type="button" className="essay-row-open" onClick={onOpen}>
        <span className="essay-row-top">
          <span className="truncate essay-row-title">{essay.title}</span>
          {score != null && <span className="essay-row-score">{score}</span>}
        </span>
        <span className="essay-row-meta">
          <span className={`essay-stage is-${stage}`}>{STAGE_LABEL[stage]}</span>
          {" · "}
          {words}
          {essay.wordLimit ? `/${essay.wordLimit}` : ""} words
        </span>
      </button>
      <button
        type="button"
        className="essay-list-delete"
        onClick={onDelete}
        aria-label={`Delete ${essay.title || "essay"}`}
        title="Delete essay"
      >
        <Icon path={ICON.trash} size={13} />
      </button>
    </div>
  );
}

/**
 * What's left, when no single essay is open.
 *
 * One row per essay across every application, sorted the way the work has to
 * happen: what's unwritten and due soonest, first.
 */
function Overview({
  essays,
  totals,
  onOpen,
}: {
  essays: Essay[];
  totals: { unwritten: number; over: number; checked: number };
  onOpen: (id: string) => void;
}) {
  if (essays.length === 0) {
    return (
      <div className="counselor-blank">
        Add your personal statement to start tracking.
      </div>
    );
  }

  return (
    <div className="counselor-detail-pane">
      <div className="essay-head">
        <div className="essay-head-id">
          <h2 className="essay-title" style={{ padding: 0, margin: 0 }}>
            College essays
          </h2>
          <p className="essay-head-meta">
            {essays.length} in total · {totals.unwritten} not started · {totals.checked} checked
            {totals.over ? ` · ${totals.over} over the limit` : ""}
          </p>
        </div>
      </div>

      <div className="doc-canvas">
        <div className="doc-sheet doc-sheet--note">
          <table className="essay-table">
            <thead>
              <tr>
                <th>Essay</th>
                <th>For</th>
                <th>Words</th>
                <th>Score</th>
                <th>AI check</th>
              </tr>
            </thead>
            <tbody>
              {essays.map((e) => {
                const words = countWords(e.content);
                const stage = stageOf(e, words);
                const score = scoreOf(e);
                const flagged = flaggedOf(e);
                return (
                  <tr key={e.id} onClick={() => onOpen(e.id)} tabIndex={0} role="button">
                    <td>
                      <span className="essay-table-title">{e.title}</span>
                      <span className={`essay-stage is-${stage}`}>{STAGE_LABEL[stage]}</span>
                    </td>
                    <td className="essay-table-dim">
                      {e.collegeName || ESSAY_KIND_LABEL[e.kind]}
                    </td>
                    <td className={stage === "over" ? "essay-table-bad" : "essay-table-dim"}>
                      {words}
                      {e.wordLimit ? ` / ${e.wordLimit}` : ""}
                    </td>
                    <td>{score != null ? score : <span className="essay-table-dim">—</span>}</td>
                    <td>
                      {flagged == null ? (
                        <span className="essay-table-dim">—</span>
                      ) : flagged ? (
                        <span className="essay-table-bad">Flagged</span>
                      ) : (
                        <span className="essay-table-good">Reads human</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <p className="counselor-essay-hint" style={{ display: "block", marginTop: 16 }}>
            Kinds available: {ESSAY_KINDS.map((k) => ESSAY_KIND_LABEL[k].toLowerCase()).join(", ")}.
            Set one in an essay&apos;s Setup, along with its college and word limit.
          </p>
        </div>
      </div>
    </div>
  );
}
