"use client";

import { useState } from "react";

import type { StudySet } from "@/lib/study/types";
import TutorMarkdown from "../TutorMarkdown";
import { Icon, ICON, Spinner } from "../ui";
import StudyCards from "./StudyCards";
import StudyPractice from "./StudyPractice";
import { useStudySet } from "./useStudySets";

/** One test's study set: its guide, flashcards, practice, and the Schoology files it came from. */

type Tab = "guide" | "cards" | "practice" | "sources";

const PHASES: { status: StudySet["status"]; label: string }[] = [
  { status: "gathering", label: "Find the material in Schoology" },
  { status: "writing", label: "Research and write the guide, flashcards and practice" },
];

function Building({ set }: { set: StudySet }) {
  const current = PHASES.findIndex((phase) => phase.status === set.status);
  const reading = set.sources.filter((source) => source.read);
  const activity = (set.activity ?? []).slice(-6);
  const browsing = (set.activity ?? []).some((entry) => entry.label.startsWith("Browser") || entry.label === "Opened a page");
  return (
    <div className="study-building" aria-live="polite">
      <ol className="study-phases">
        {PHASES.map((phase, index) => (
          <li key={phase.status} className={index < current ? "is-done" : index === current ? "is-now" : ""}>
            <span className="study-phase-mark" aria-hidden="true">
              {index < current ? <Icon path={ICON.check} size={11} /> : index === current ? <Spinner size={11} /> : null}
            </span>
            <div>
              <strong>{phase.label}</strong>
              {index === current && set.status === "gathering" && set.step && <span>{set.step}</span>}
              {index === current && set.status === "writing" && (
                activity.length ? (
                  <ul className="study-activity">
                    {activity.map((entry, row) => (
                      <li key={`${entry.at}-${row}`} className={row === activity.length - 1 ? "is-now" : ""}>
                        {entry.label}{entry.detail ? <span> · {entry.detail}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : set.step ? <span>{set.step}</span> : null
              )}
            </div>
          </li>
        ))}
      </ol>
      {reading.length > 0 && (
        <p className="study-muted">Working from {reading.slice(0, 4).map((source) => `“${source.title}”`).join(", ")}{reading.length > 4 ? ` and ${reading.length - 4} more` : ""}.</p>
      )}
      <p className="study-muted">
        The study agent can use the browser, the web and your class’s Schoology files, so this can take a few minutes. It keeps going if you leave.
        {browsing ? " You can watch its browser in Agent › Computer." : ""}
      </p>
    </div>
  );
}

function Sources({ set, domain }: { set: StudySet; domain: string }) {
  const href = (url: string) => (/^https?:/.test(url) ? url : `https://${domain}${url}`);
  return (
    <div className="study-sources-wrap">
      {set.notice && <p className="study-notice"><Icon path={ICON.alert} size={13} /> {set.notice}</p>}
      <ol className="study-sources">
        {set.sources.map((source) => (
          <li key={source.n} className={source.read ? "" : "is-unread"}>
            <span className="study-source-n">{source.n}</span>
            <div className="study-source-main">
              <strong>{source.title}</strong>
              <span className="study-muted">{source.where}</span>
              <span className={source.read ? "study-source-state" : "study-source-state is-muted"}>
                {source.read ? `Read, ${source.chars.toLocaleString()} characters` : source.note}
              </span>
            </div>
            {source.url && domain && (
              <a className="btn btn--quiet" href={href(source.url)} target="_blank" rel="noreferrer">
                Open <Icon path={ICON.external} size={11} />
              </a>
            )}
          </li>
        ))}
      </ol>
      {set.sources.length === 0 && <p className="study-empty">Nothing was found for this test.</p>}
    </div>
  );
}

export default function StudySetView({
  id,
  domain,
  inert,
  onBack,
  onRebuild,
  onChangeMaterial,
  onDelete,
}: {
  id: string;
  domain: string;
  /** While the build sheet is open over it. */
  inert?: boolean;
  onBack: () => void;
  /** Builds it again from the same material. */
  onRebuild: (set: StudySet) => void;
  /** Opens the build sheet on what it was built from. */
  onChangeMaterial: (set: StudySet) => void;
  onDelete: (set: StudySet) => Promise<void> | void;
}) {
  const { set, error, load, saveProgress, morePractice } = useStudySet(id);
  const [tab, setTab] = useState<Tab>("guide");
  const [confirming, setConfirming] = useState<"rebuild" | "delete" | null>(null);

  function confirm(action: "rebuild" | "delete"): boolean {
    if (confirming === action) {
      setConfirming(null);
      return true;
    }
    setConfirming(action);
    window.setTimeout(() => setConfirming((current) => (current === action ? null : current)), 4000);
    return false;
  }

  function rebuild() {
    if (!set) return;
    if (set.status === "ready" && !confirm("rebuild")) return;
    setConfirming(null);
    onRebuild(set);
    window.setTimeout(() => void load(), 600);
  }

  const chosen = set?.inputs
    ? [
        set.inputs.picks.length && `${set.inputs.picks.length} picked from Materials`,
        set.inputs.uploads.length && `${set.inputs.uploads.length} uploaded`,
        set.inputs.notes && "your notes",
      ].filter(Boolean)
    : [];

  const read = set?.sources.filter((source) => source.read).length ?? 0;
  const readSources = set?.sources.filter((source) => source.read) ?? [];
  const yours = (where: string) => /^(Uploaded|Written) by you$/.test(where);
  const places = [
    readSources.some((source) => source.kind !== "web" && !yours(source.where)) && "Schoology",
    readSources.some((source) => yours(source.where)) && "your own material",
    readSources.some((source) => source.kind === "web") && "the web",
  ].filter((place): place is string => !!place);
  const tabs: { id: Tab; label: string }[] = set
    ? [
        { id: "guide", label: "Guide" },
        { id: "cards", label: `Flashcards ${set.cards.length}` },
        { id: "practice", label: `Practice ${set.questions.length}` },
        { id: "sources", label: `Sources ${read}` },
      ]
    : [];

  return (
    <div className="scroll centered" inert={inert}>
      <div className="col study-set">
        <header className="study-set-head">
          <button type="button" className="ui-back" onClick={onBack}>
            <Icon path={ICON.chevronLeft} size={12} /> All tests
          </button>
          {set && (
            <div className="study-set-title">
              <span className="study-set-kicker">
                {set.course.replace(/\s+-\s+\d+$/, "")}
                {set.custom ? " · Added by you" : ""}
              </span>
              <h1>{set.title}</h1>
              <span className="study-muted">
                {[set.due.replace(/\s+at$/i, ""), chosen.length ? `Built with ${chosen.join(", ")}` : ""].filter(Boolean).join(" · ")}
              </span>
            </div>
          )}
          {set && set.status !== "gathering" && set.status !== "writing" && (
            <div className="study-set-actions">
              <button type="button" className="btn btn--quiet" onClick={() => onChangeMaterial(set)}>
                <Icon path={ICON.folder} size={12} /> Change material
              </button>
              <button type="button" className={`btn btn--quiet${confirming === "rebuild" ? " is-confirming" : ""}`} onClick={rebuild}>
                <Icon path={ICON.retry} size={12} /> {confirming === "rebuild" ? "Rebuild? This clears your progress" : "Rebuild"}
              </button>
              <button
                type="button"
                className={`btn btn--quiet study-delete${confirming === "delete" ? " is-confirming" : ""}`}
                aria-label={confirming === "delete" ? "Really delete this study set?" : "Delete this study set"}
                onClick={() => confirm("delete") && void onDelete(set)}
              >
                <Icon path={ICON.trash} size={12} />
                {confirming === "delete" ? " Delete it?" : ""}
              </button>
            </div>
          )}
        </header>

        {!set && !error && <p className="study-muted"><Spinner size={12} /> Loading</p>}
        {error && !set && <p className="study-notice is-bad" role="alert"><Icon path={ICON.alert} size={13} /> {error}</p>}

        {set && (set.status === "gathering" || set.status === "writing") && <Building set={set} />}

        {set?.status === "failed" && (
          <div className="study-building">
            <p className="study-notice is-bad" role="alert"><Icon path={ICON.alert} size={13} /> {set.error ?? "The build failed."}</p>
            <div className="study-card-actions is-left">
              <button type="button" className="btn btn--primary" onClick={rebuild}>Try again</button>
              <button type="button" className="btn btn--quiet" onClick={() => onChangeMaterial(set)}>Change material</button>
            </div>
          </div>
        )}

        {set?.status === "ready" && (
          <>
            <div className="useg study-tabs" role="tablist" aria-label="Study set">
              {tabs.map((entry) => (
                <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id} className={tab === entry.id ? "is-on" : undefined} onClick={() => setTab(entry.id)}>
                  {entry.label}
                </button>
              ))}
            </div>

            {tab === "guide" && (
              <article className="study-guide">
                {set.notice && <p className="study-notice"><Icon path={ICON.alert} size={13} /> {set.notice}</p>}
                <p className="study-overview">{set.overview}</p>
                <TutorMarkdown text={set.guide} className="study-md" />
                <p className="study-muted study-guide-foot">
                  {set.builder === "agent" ? "Researched and written by the study agent" : "Written"} from {read} {read === 1 ? "source" : "sources"}
                  {places.length ? `: ${places.length === 1 ? places[0] : `${places.slice(0, -1).join(", ")} and ${places.at(-1)}`}` : ""}.{" "}
                  <button type="button" className="study-link" onClick={() => setTab("sources")}>See which</button>
                </p>
              </article>
            )}
            {tab === "cards" && <StudyCards set={set} onMark={(cardId, value) => void saveProgress({ cards: { [cardId]: value } })} />}
            {tab === "practice" && (
              <StudyPractice set={set} onAnswer={(questionId, answer) => void saveProgress({ answers: { [questionId]: answer } })} onMore={() => void morePractice()} />
            )}
            {tab === "sources" && <Sources set={set} domain={domain} />}
          </>
        )}
      </div>
    </div>
  );
}
