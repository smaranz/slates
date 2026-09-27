"use client";

import { useEffect, useState } from "react";

import type { StudySet } from "@/lib/study/types";

/**
 * Flashcards, one at a time. Flip, then say whether you knew it; the ones you
 * didn't come back round when you go through the deck again.
 */

export default function StudyCards({ set, onMark }: { set: StudySet; onMark: (cardId: string, value: "again" | "good") => void }) {
  const [onlyLearning, setOnlyLearning] = useState(false);
  const [deck, setDeck] = useState(() => set.cards.map((card) => card.id));
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const known = set.cards.filter((card) => set.progress.cards[card.id] === "good").length;
  const learning = set.cards.filter((card) => set.progress.cards[card.id] !== "good").map((card) => card.id);
  const card = set.cards.find((entry) => entry.id === deck[index]);

  function restart(learningOnly: boolean) {
    setOnlyLearning(learningOnly);
    setDeck(learningOnly ? learning : set.cards.map((entry) => entry.id));
    setIndex(0);
    setFlipped(false);
  }

  function mark(value: "again" | "good") {
    if (!card) return;
    onMark(card.id, value);
    setFlipped(false);
    setIndex((current) => current + 1);
  }

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable]")) return;
      const onButton = event.target instanceof HTMLElement && !!event.target.closest("button, a");
      if (event.key === " " || (event.key === "Enter" && !onButton)) {
        event.preventDefault();
        setFlipped((value) => !value);
      } else if (event.key === "ArrowRight") setIndex((current) => Math.min(current + 1, deck.length));
      else if (event.key === "ArrowLeft") setIndex((current) => Math.max(current - 1, 0));
      else if (flipped && event.key === "1") mark("again");
      else if (flipped && event.key === "2") mark("good");
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  if (!set.cards.length) return <p className="study-empty">This set has no flashcards.</p>;

  return (
    <div className="study-cards">
      <div className="study-cards-bar">
        <span className="study-muted">
          {card ? `${index + 1} of ${deck.length}` : `${deck.length} of ${deck.length}`}
          {onlyLearning ? " still learning" : ""} · {known} of {set.cards.length} known
        </span>
        <div className="study-cards-track" aria-hidden="true">
          <span style={{ transform: `scaleX(${deck.length ? Math.min(index, deck.length) / deck.length : 0})` }} />
        </div>
      </div>

      {card ? (
        <>
          <button type="button" className={`study-card${flipped ? " is-flipped" : ""}`} onClick={() => setFlipped((value) => !value)} aria-label={flipped ? "Show the question" : "Show the answer"}>
            <span className="study-card-topic">{card.topic}{card.source ? ` · [${card.source}]` : ""}</span>
            <span className="study-card-text">{flipped ? card.back : card.front}</span>
            <span className="study-card-hint">{flipped ? "Answer" : "Click or press space to flip"}</span>
          </button>
          <div className="study-card-actions">
            {flipped ? (
              <>
                <button type="button" className="btn btn--quiet study-again" onClick={() => mark("again")}>Still learning <kbd>1</kbd></button>
                <button type="button" className="btn btn--primary" onClick={() => mark("good")}>Got it <kbd>2</kbd></button>
              </>
            ) : (
              <button type="button" className="btn btn--quiet" onClick={() => setFlipped(true)}>Show answer</button>
            )}
          </div>
        </>
      ) : (
        <div className="study-done">
          <p><strong>{known === set.cards.length ? "You know every card." : `You know ${known} of ${set.cards.length}.`}</strong></p>
          <div className="study-card-actions">
            {learning.length > 0 && (
              <button type="button" className="btn btn--primary" onClick={() => restart(true)}>
                Go through the {learning.length} you’re still learning
              </button>
            )}
            <button type="button" className="btn btn--quiet" onClick={() => restart(false)}>Start over</button>
          </div>
        </div>
      )}
    </div>
  );
}
