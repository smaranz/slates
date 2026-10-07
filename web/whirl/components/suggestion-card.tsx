"use client";

import { useState, type PointerEvent } from "react";
import { IconSparklesFilled, IconX } from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";

import { EASE_OUT, pinRasterPath } from "@whirl/lib/motion";
import { SUGGESTION_ICONS, type SuggestionIcon } from "@whirl/lib/suggestions";
import { useBlockHeight } from "@whirl/lib/use-block-height";
import { cn } from "@whirl/lib/utils";

/** One capsule at rest: an 18px line box inside 9px of padding. */
const COLLAPSED_HEIGHT = 36;
const LINE_HEIGHT = 18;
const PADDING_Y = 9;

/** The capsule's surface, shared with the silhouette in suggestion-cards. */
export const CAPSULE_SURFACE =
  "rounded-full bg-well shadow-[inset_0_0_0_1px_var(--well-outline),inset_0_1px_0_0_var(--well-highlight)]";

const OPEN_TRANSITION = { duration: 0.26, ease: [0.22, 1, 0.36, 1] } as const;

/* Replacing a card's text is a real event — a dismissal landing, or the first
   personalized pair arriving over the standbys — so it crosses over rather
   than cutting. `popLayout` pins the outgoing label out of flow, which is
   what keeps the two from ever stacking and doubling the capsule's height. */
const LABEL_SWAP = {
  initial: { opacity: 0, y: 5 },
  animate: { opacity: 1, y: 0 },
  exit: {
    opacity: 0,
    y: -5,
    transition: { duration: 0.11, ease: [0.4, 0, 1, 1] as const },
  },
  transition: {
    opacity: { duration: 0.2, ease: EASE_OUT },
    y: { type: "spring" as const, stiffness: 560, damping: 40 },
  },
  transformTemplate: pinRasterPath,
};

const GLYPH_SWAP = {
  initial: { opacity: 0, scale: 0.7, rotate: -12 },
  animate: { opacity: 1, scale: 1, rotate: 0 },
  exit: { opacity: 0, scale: 0.7, rotate: 12 },
  transition: { duration: 0.14, ease: EASE_OUT },
  transformTemplate: pinRasterPath,
};

function SuggestionGlyph({
  icon,
  loading,
}: {
  icon: SuggestionIcon;
  loading: boolean;
}) {
  if (loading) return <IconSparklesFilled size={14} />;
  const Icon = SUGGESTION_ICONS[icon];
  return <Icon size={14} />;
}

/* One conversation-starter capsule: the starter's mark and its prompt on a
   single slim line. Clicking hands the prompt to the composer rather than
   firing it off — a starting point to riff on, not a trigger. Same recessed
   well and pill geometry as the composer, so they read as one family.
   Hovering brightens the well a step and draws a hairline ring: an alpha-free
   mix, since chrome and surface share a color and "lift to surface" would be
   invisible.

   A prompt too long for one line opens downward on hover to show the rest.
   Three rules keep that from turning into the jitter it used to be:

     - The text never changes shape. It is always the full prompt, always
       wrapping, always laid out at the same width; collapsed simply clamps it
       to the first line — which is the same first line either way. The old
       card swapped a hand-truncated string for the full one and flipped
       `nowrap` to `normal` underneath it, so every open re-broke every line.
     - The height animates between two known numbers. `auto` has to be read
       off the DOM at the instant the animation starts, and that instant is
       exactly when the label is being rewritten, so the target was measured
       mid-change and the capsule snapped when it got there. A hidden twin of
       the prompt carries the settled number instead.
     - Nothing opens that has nothing to show: short prompts are inert.

   State is per card, on purpose. Hovering one used to re-render its neighbour
   through a shared id set, which re-measured a card nobody was touching. */
export function SuggestionCard({
  id,
  prompt,
  icon,
  loading,
  onPick,
  onDismiss,
}: {
  id: string;
  prompt: string;
  icon: SuggestionIcon;
  /** This card is holding a place for its own replacement. */
  loading: boolean;
  onPick: (prompt: string) => void;
  onDismiss: (id: string) => void;
}) {
  /* Measured off a copy of the prompt that never animates (below). */
  const { ref: measureRef, height: fullHeight } = useBlockHeight();
  const wraps = fullHeight > LINE_HEIGHT + 1;
  const expandable = wraps && !loading;

  const [wantsOpen, setWantsOpen] = useState(false);
  const open = wantsOpen && expandable;

  /* Held from the moment the capsule opens until it has finished closing.
     While it is set the capsule sits above its neighbour and the label keeps
     every line it has; dropping either at the start of the close would take
     the extra lines away from an animation still busy revealing them. Latched
     during render rather than in an effect, so the lines exist in the same
     frame the height starts growing. */
  const [raised, setRaised] = useState(false);
  if (open && !raised) setRaised(true);

  /* A replacement arriving is the one change an open capsule's fixed height
     can't absorb, so a card whose text is being swapped closes first. It opens
     again on the next deliberate move of the pointer. */
  const [shown, setShown] = useState(prompt);
  if (shown !== prompt) {
    setShown(prompt);
    setWantsOpen(false);
  }

  /* Touch has no hover: there, a tap is a pick and nothing else. */
  const expand = (event: PointerEvent) => {
    if (event.pointerType === "mouse") setWantsOpen(true);
  };

  return (
    <div className="relative h-9">
      <motion.div
        initial={false}
        animate={{
          height: open
            ? Math.round(fullHeight) + PADDING_Y * 2
            : COLLAPSED_HEIGHT,
        }}
        transition={OPEN_TRANSITION}
        onAnimationComplete={() => {
          if (!open) setRaised(false);
        }}
        onPointerEnter={expand}
        /* The pointer can already be resting on a card that just closed itself
           for a text swap; a move is how it gets to say so. Guarded, so this
           is a plain comparison for as long as the capsule is open. */
        onPointerMove={(event) => {
          if (!wantsOpen) expand(event);
        }}
        onPointerLeave={() => setWantsOpen(false)}
        /* Keyboard focus only. A tap focuses the button too, and on touch that
           focus is immediately handed to the composer — so without this the
           capsule opened and shut again inside the same gesture. */
        onFocusCapture={(event) => {
          if ((event.target as Element).matches(":focus-visible")) {
            setWantsOpen(true);
          }
        }}
        onBlurCapture={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            setWantsOpen(false);
          }
        }}
        /* Top-anchored: the pill opens downward, so the first line, the glyph
           and the X hold their exact collapsed positions while the rest is
           revealed from under the closing edge. */
        className={cn(
          "group absolute inset-x-0 top-0 flex h-9 w-full items-start overflow-hidden ring-1 ring-transparent transition-[background-color,box-shadow] duration-150",
          CAPSULE_SURFACE,
          "hover:bg-[color-mix(in_oklch,var(--well),var(--foreground)_5%)] hover:ring-border",
          raised ? "z-10" : "z-0",
        )}
      >
        <button
          type="button"
          disabled={loading}
          onClick={() => onPick(prompt)}
          className="flex min-h-9 min-w-0 flex-1 cursor-pointer items-start gap-2 py-[9px] pl-3.5 text-left disabled:cursor-default"
        >
          {/* mt-[2px] centres the 14px glyph on the first 18px line — where
              `items-center` put it while the card was one line tall, and where
              it stays now that it isn't. */}
          <span
            aria-hidden
            className="relative mt-[2px] flex size-3.5 shrink-0 items-center justify-center text-muted-foreground transition-colors duration-150 group-hover:text-foreground"
          >
            <AnimatePresence initial={false}>
              <motion.span
                key={loading ? "loading" : icon}
                {...GLYPH_SWAP}
                className="absolute inset-0 flex items-center justify-center"
              >
                <SuggestionGlyph icon={icon} loading={loading} />
              </motion.span>
            </AnimatePresence>
          </span>
          <span className="relative block min-h-[18px] min-w-0 flex-1 text-[13px]/[18px] text-muted-foreground transition-colors duration-150 group-hover:text-foreground">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={prompt}
                {...LABEL_SWAP}
                /* `block` and `line-clamp-1` both set `display`, so they are
                   never both on: one state per class. Line one breaks in the
                   same place either way — clamping only paints an ellipsis
                   over its tail — which is why opening moves no text. */
                className={cn(
                  "break-words",
                  raised ? "block" : "line-clamp-1",
                  loading && "text-shimmer",
                )}
              >
                {prompt}
              </motion.span>
            </AnimatePresence>
            {/* The same prompt at the same width, hidden and never animated.
                Its height is the height the capsule opens to. */}
            <span
              ref={measureRef}
              aria-hidden
              className="pointer-events-none invisible absolute inset-x-0 top-0 block break-words select-none"
            >
              {prompt}
            </span>
          </span>
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => onDismiss(id)}
          aria-label={`Dismiss “${prompt}”`}
          className={cn(
            /* `scale` is named in the transition list on purpose: Tailwind v4
               compiles it to the standalone `scale` property, which a
               `transform` entry would not cover. */
            "mt-1.5 mr-2 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground/55 transition-[color,background-color,opacity,scale] duration-150 hover:bg-foreground/[0.06] hover:text-foreground active:scale-90 dark:hover:bg-foreground/[0.1]",
            /* Hidden only while THIS card is a placeholder — there is nothing
               to turn down yet. It used to vanish whenever either card was
               loading, which meant both X's faded out and back on every cold
               load. */
            loading && "pointer-events-none opacity-0",
          )}
        >
          <IconX size={13} stroke={2.25} />
        </button>
      </motion.div>
    </div>
  );
}
