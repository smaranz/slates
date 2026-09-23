"use client";

import { useEffect, useRef } from "react";

import { MENTION_KIND_LABEL, type Mention } from "@/lib/tutor-mentions";
import { Dot, Icon, ICON } from "./ui";

/**
 * The `@` picker.
 *
 * Opens over the composer while you are still typing, because the point of
 * `@` is that you never leave the sentence to go and find the thing. Grouped
 * by kind so a list of forty assignments and six classes still reads, and
 * driven entirely from the keyboard — arrows, enter, escape — since your
 * hands are already on it.
 */

const ICON_FOR: Record<Mention["kind"], string> = {
  assignment: ICON.assignments,
  class: ICON.classes,
  essay: ICON.essay,
  material: ICON.folder,
};

export default function MentionMenu({
  items,
  active,
  loading,
  grouped,
  onPick,
  onHover,
}: {
  items: Mention[];
  active: number;
  loading?: boolean;
  /**
   * Headings only make sense on the unfiltered list. Once something is typed
   * the order is relevance, not kind, so the groups interleave and the
   * headings repeat — "assignments, classes, assignments" down the list. The
   * row icon already says what each one is.
   */
  grouped: boolean;
  onPick: (mention: Mention) => void;
  onHover: (index: number) => void;
}) {
  const activeRef = useRef<HTMLButtonElement | null>(null);

  // Arrowing past the visible end should scroll, not walk off the list.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!items.length) {
    return (
      <div className="mention-menu">
        <p className="mention-empty">
          {loading ? "Looking…" : "Nothing by that name. Try a class, an assignment, or an essay."}
        </p>
      </div>
    );
  }

  return (
    <div className="mention-menu" role="listbox" aria-label="Attach something to your question">
      {items.map((item, i) => {
        // Derived from the neighbour rather than a running variable: a heading
        // is "the kind changed here", which the list already knows.
        const heading =
          grouped && items[i - 1]?.kind !== item.kind ? MENTION_KIND_LABEL[item.kind] : null;
        return (
          <div key={`${item.kind}:${item.id}`}>
            {heading && <span className="mention-group">{heading}</span>}
            <button
              ref={i === active ? activeRef : undefined}
              type="button"
              role="option"
              aria-selected={i === active}
              className={`mention-item${i === active ? " is-active" : ""}`}
              /*
               * The composer must keep focus and the caret: this fires on
               * mousedown because a click would blur the textarea first, and
               * the insertion point is where the mention has to land.
               */
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(item);
              }}
              onMouseEnter={() => onHover(i)}
            >
              {/*
                * The class's own colour, the same dot the board, grades and
                * calendar use — so an assignment is recognisable as belonging
                * to a class before its name is read. Essays have no class, so
                * they keep the plain icon.
                */}
              {item.color ? (
                <span className="mention-mark">
                  <Dot color={item.color} size={8} radius={3} />
                </span>
              ) : (
                <Icon path={ICON_FOR[item.kind]} size={13} />
              )}
              <span className="mention-text">
                <span className="truncate mention-label">
                  {item.label}
                  {item.done && <span className="mention-done">done</span>}
                </span>
                {item.detail && <span className="truncate mention-detail">{item.detail}</span>}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
