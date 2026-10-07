"use client";

import { useState } from "react";
import {
  IconCheck,
  IconCircleCheckFilled,
  IconLink,
  IconX,
} from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";

import { MorphHeight } from "@whirl/components/morph-height";
import { Button } from "@whirl/components/ui/button";
import { Dialog, DialogContent } from "@whirl/components/ui/dialog";
import { pinRasterPath, SHED_BLUR } from "@whirl/lib/motion";
import { showToast } from "@whirl/lib/toasts";
import { cn } from "@whirl/lib/utils";

/* A modal that walks through steps, in v2's language. Every step is a full
   card page: the whole card slides sideways to the next one while its height
   glides along, and ALL content lives inside the one height morph, so
   nothing can ever resize outside the animation.

   Grown out of the integration store's install modal, which is still its
   biggest user (components/integrations/modal-bits.tsx re-exports these
   under the store's own names). Locked threads use it for both the setup
   walkthrough and the unlock prompt. */

/** Step pages slide in from the right; the outgoing page drifts left. */
const stepMotion = {
  initial: { opacity: 0, x: 16, filter: "blur(4px)" },
  animate: {
    opacity: 1,
    x: 0,
    filter: "blur(0px)",
    transitionEnd: SHED_BLUR,
  },
  exit: { opacity: 0, x: -16, filter: "blur(4px)" },
  transition: { duration: 0.22, ease: [0.22, 0.61, 0.36, 1] as const },
};

/** The same, mirrored, for a step the user is walking back out of. */
const stepMotionBack = {
  ...stepMotion,
  initial: { opacity: 0, x: -16, filter: "blur(4px)" },
  exit: { opacity: 0, x: 16, filter: "blur(4px)" },
};

/**
 * The modal shell. `step` keys the current page: changing it slides the whole
 * card to the next one while the height glides. Header buttons ride above the
 * pages, so they hold still.
 */
export function StepModal({
  open,
  onOpenChange,
  ariaLabel,
  step,
  back = false,
  dismissible = true,
  className,
  buttons,
  initialFocus,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ariaLabel: string;
  step: string;
  /** Set while moving backwards, so the slide runs the way the user is
   *  going. Forward is the default; nothing else has to change. */
  back?: boolean;
  /** Clear for a step that must be answered rather than escaped from — the
   *  backdrop stops dismissing and Escape is swallowed, so only the step's
   *  own buttons can leave. Reserve it for the ones where walking away
   *  destroys something (a recovery key shown exactly once). */
  dismissible?: boolean;
  className?: string;
  /** Persistent overlay controls — a close button, a copy-link button. */
  buttons?: React.ReactNode;
  /** Where focus lands on open. Base UI's default is the first control,
   *  which wears a focus ring when nothing was clicked to open the modal
   *  (one that opens itself on load). */
  initialFocus?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}) {
  return (
    <Dialog
      open={open}
      /* Base UI has no single "can't be dismissed" switch: the backdrop is
         `disablePointerDismissal`, and Escape only ever arrives here as a
         close request — so it's swallowed in the same place. */
      disablePointerDismissal={!dismissible}
      onOpenChange={(next: boolean) => {
        if (!next && !dismissible) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        aria-label={ariaLabel}
        className={cn(
          "top-1/2 max-w-sm -translate-y-1/2 overflow-hidden p-0",
          className,
        )}
        backdropClassName="backdrop-blur-xs"
        {...(initialFocus ? { initialFocus } : {})}
      >
        {buttons}
        <MorphHeight>
          {/* popLayout: the outgoing page leaves the flow and exits WHILE the
              incoming one slides in — wait-mode's exit-then-enter reads as
              twice the duration. */}
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={step}
              {...(back ? stepMotionBack : stepMotion)}
              transformTemplate={pinRasterPath}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </MorphHeight>
      </DialogContent>
    </Dialog>
  );
}

export function StepModalIconButton({
  label,
  onClick,
  className = "",
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`absolute top-3 z-10 rounded-full text-muted-foreground ${className}`}
    >
      {children}
    </Button>
  );
}

export function StepModalCloseButton({ onClose }: { onClose: () => void }) {
  return (
    <StepModalIconButton label="Close" className="right-3" onClick={onClose}>
      <IconX size={15} stroke={2} />
    </StepModalIconButton>
  );
}

/** Copies a URL and says so for a beat. */
export function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <StepModalIconButton
      label={copied ? "Link copied" : "Copy link"}
      className="left-3"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          showToast("Couldn't copy the link.");
        }
      }}
    >
      {copied ? (
        <IconCheck size={15} stroke={2.25} className="text-emerald-500" />
      ) : (
        <IconLink size={15} stroke={2} />
      )}
    </StepModalIconButton>
  );
}

/** The it's-done step: a springy check, a word, and a way out. */
export function SuccessStep({
  title,
  body,
  doneLabel = "Done",
  onDone,
}: {
  title: string;
  body: string;
  doneLabel?: string;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col items-center px-6 pt-10 pb-6 text-center">
      <motion.span
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 22 }}
        className="text-emerald-500"
      >
        <IconCircleCheckFilled size={44} />
      </motion.span>
      <h2 className="mt-4 w-full break-words text-[15px] font-semibold tracking-tight">
        {title}
      </h2>
      <p className="mt-1.5 max-w-xs break-words text-[13px] leading-relaxed text-muted-foreground">
        {body}
      </p>
      <Button className="mt-5 h-10 w-full" onClick={onDone}>
        {doneLabel}
      </Button>
    </div>
  );
}

/** The fine print under a step's main action. */
export function StepHint({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "warn";
  children: React.ReactNode;
}) {
  return (
    <p
      className={`mt-2.5 text-center text-[11.5px] leading-snug break-words ${
        tone === "warn"
          ? "text-amber-600 dark:text-amber-400"
          : "text-muted-foreground/70"
      }`}
    >
      {children}
    </p>
  );
}
