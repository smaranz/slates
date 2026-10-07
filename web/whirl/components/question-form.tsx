"use client";

import { useRef, useState } from "react";
import {
  IconArrowLeft,
  IconCheck,
  IconPaperclip,
  IconX,
} from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";

import type { FileLike } from "@whirl/lib/attachments";
import { EASE_OUT, pinRasterPath, SHED_BLUR } from "@whirl/lib/motion";
import type {
  ComposerQuestion,
  QuestionAnswer,
  QuestionSpec,
} from "@whirl/lib/questions";
import type { AttachmentDraft } from "@whirl/lib/use-attachments";
import { cn } from "@whirl/lib/utils";
import { ComposerAttachments } from "./composer-attachments";
import { SquishButton } from "./squish-button";

/* The composer's question face: whirl asked something via askUserQuestion
   and the pill morphs into this stepper — one step per question, radio or
   checkbox rows for choices (with a "Something else…" free-text row),
   a short text field, or an attach zone. Done hands the answers back to
   the composer, which sends them as the follow-up message. */

/** Step pages slide toward the travel direction, like the store modal. */
const stepVariants = {
  initial: (direction: number) => ({
    opacity: 0,
    x: 16 * direction,
    filter: "blur(4px)",
  }),
  animate: {
    opacity: 1,
    x: 0,
    filter: "blur(0px)",
    transitionEnd: SHED_BLUR,
  },
  exit: (direction: number) => ({
    opacity: 0,
    x: -16 * direction,
    filter: "blur(4px)",
  }),
};

const STEP_TRANSITION = { duration: 0.22, ease: EASE_OUT } as const;

type StepDraft = {
  selected: string[];
  otherOn: boolean;
  otherText: string;
  text: string;
};

const EMPTY_DRAFT: StepDraft = {
  selected: [],
  otherOn: false,
  otherText: "",
  text: "",
};

/** The slice of useAttachments the form drives — the instance itself lives
 * in the composer so window-level drops can reach it there too. */
export type QuestionFormAttachments = {
  drafts: AttachmentDraft[];
  addFiles: (files: Iterable<File>) => void;
  remove: (id: string) => void;
};

export function QuestionForm({
  question,
  attachments,
  rejectionFor,
  onDismiss,
  onSubmit,
}: {
  question: ComposerQuestion;
  attachments: QuestionFormAttachments;
  rejectionFor: (file: FileLike) => string | null;
  onDismiss: () => void;
  /** Receives the final answers; the composer resolves uploads + sends. */
  onSubmit: (answers: QuestionAnswer[]) => void | Promise<void>;
}) {
  const { questions } = question;
  const [step, setStep] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, StepDraft>>({});
  const [submitting, setSubmitting] = useState(false);
  const directionRef = useRef(1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const current = questions[Math.min(step, questions.length - 1)];
  const draft = drafts[current.id] ?? EMPTY_DRAFT;
  const multiStep = questions.length > 1;
  const lastStep = step === questions.length - 1;

  const patchDraft = (id: string, updates: Partial<StepDraft>) =>
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? EMPTY_DRAFT), ...updates },
    }));

  const goTo = (next: number) => {
    directionRef.current = next > step ? 1 : -1;
    setStep(next);
  };

  const hasInvalidFiles = attachments.drafts.some(
    (file) => file.status === "error" || rejectionFor(file) !== null,
  );

  const canAdvance = (() => {
    const other = draft.otherOn && draft.otherText.trim().length > 0;
    switch (current.type) {
      case "single":
      case "multi":
        return draft.selected.length > 0 || other;
      case "text":
        return draft.text.trim().length > 0;
      case "attachment":
        return !hasInvalidFiles;
    }
  })();

  const buildAnswers = (): QuestionAnswer[] =>
    questions.map((entry) => {
      const own = drafts[entry.id] ?? EMPTY_DRAFT;
      if (entry.type === "text") {
        const text = own.text.trim();
        return text ? { id: entry.id, text } : { id: entry.id, skipped: true };
      }
      if (entry.type === "attachment") {
        const names = attachments.drafts
          .filter((file) => file.status !== "error")
          .map((file) => file.name);
        return names.length > 0
          ? { id: entry.id, attachments: names }
          : { id: entry.id, skipped: true };
      }
      const other = own.otherOn ? own.otherText.trim() : "";
      if (own.selected.length === 0 && !other) {
        return { id: entry.id, skipped: true };
      }
      return {
        id: entry.id,
        ...(own.selected.length > 0 ? { selected: own.selected } : {}),
        ...(other ? { text: other } : {}),
      };
    });

  const advance = async () => {
    if (!canAdvance || submitting) return;
    if (!lastStep) {
      goTo(step + 1);
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(buildAnswers());
    } catch {
      /* The composer already surfaced the failure (toast); everything
         chosen stays put for another go. */
      setSubmitting(false);
    }
  };

  const chooseOption = (label: string) => {
    if (current.type === "single") {
      patchDraft(current.id, { selected: [label], otherOn: false });
      return;
    }
    patchDraft(current.id, {
      selected: draft.selected.includes(label)
        ? draft.selected.filter((entry) => entry !== label)
        : [...draft.selected, label],
    });
  };

  const stepLabel = multiStep
    ? `${step + 1} of ${questions.length}${
        current.header ? ` · ${current.header}` : ""
      }`
    : (current.header ?? "Quick question");

  return (
    <div className="p-3">
      <div className="flex items-center justify-between pb-1 pl-1">
        <span className="text-[12.5px]/4 font-medium text-muted-foreground">
          {stepLabel}
        </span>
        <button
          type="button"
          aria-label="Dismiss and type your own reply"
          title="Dismiss and type your own reply"
          onClick={onDismiss}
          className="flex size-7 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-[background-color,color] duration-150 hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.06]"
        >
          <IconX size={15} stroke={2.5} />
        </button>
      </div>

      <AnimatePresence
        mode="popLayout"
        initial={false}
        custom={directionRef.current}
      >
        <motion.div
          key={current.id}
          custom={directionRef.current}
          variants={stepVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={STEP_TRANSITION}
          transformTemplate={pinRasterPath}
        >
          <p className="px-1 pb-2.5 text-[15px]/6 font-medium text-foreground">
            {current.prompt}
          </p>

          {(current.type === "single" || current.type === "multi") && (
            <div
              role={current.type === "single" ? "radiogroup" : "group"}
              aria-label={current.prompt}
              className="flex flex-col gap-1"
            >
              {(current.options ?? []).map((option) => (
                <ChoiceRow
                  key={option.label}
                  type={current.type as "single" | "multi"}
                  label={option.label}
                  description={option.description}
                  selected={draft.selected.includes(option.label)}
                  onClick={() => chooseOption(option.label)}
                />
              ))}
              {current.allowOther !== false && (
                <ChoiceRow
                  type={current.type as "single" | "multi"}
                  label="Something else…"
                  selected={draft.otherOn}
                  onClick={() =>
                    current.type === "single"
                      ? patchDraft(current.id, {
                          selected: [],
                          otherOn: true,
                        })
                      : patchDraft(current.id, { otherOn: !draft.otherOn })
                  }
                >
                  {draft.otherOn && (
                    <input
                      autoFocus
                      value={draft.otherText}
                      placeholder="Tell whirl what you have in mind"
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) =>
                        patchDraft(current.id, {
                          otherText: event.target.value,
                        })
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void advance();
                        }
                      }}
                      className="mt-1 w-full bg-transparent text-sm caret-foreground outline-none placeholder:text-muted-foreground"
                    />
                  )}
                </ChoiceRow>
              )}
            </div>
          )}

          {current.type === "text" && (
            <input
              autoFocus
              value={draft.text}
              placeholder={current.placeholder ?? "Type your answer"}
              onChange={(event) =>
                patchDraft(current.id, { text: event.target.value })
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void advance();
                }
              }}
              className="w-full rounded-xl px-3 py-2.5 text-[15px]/6 caret-foreground shadow-[inset_0_0_0_1px_var(--well-outline)] outline-none transition-shadow duration-150 placeholder:text-muted-foreground focus:shadow-[inset_0_0_0_1px_var(--border)]"
            />
          )}

          {current.type === "attachment" && (
            <div>
              <div className="flex items-center gap-2.5 px-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="raised flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-4 text-[13.5px]/4 font-medium text-muted-foreground transition-[background-color,color,scale] duration-150 hover:text-foreground active:scale-95"
                >
                  <IconPaperclip size={15} />
                  Attach files
                </button>
                <span className="text-[12.5px]/4 text-muted-foreground">
                  or drop them anywhere
                </span>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(event) => {
                  if (event.target.files?.length) {
                    attachments.addFiles(event.target.files);
                  }
                  event.target.value = "";
                }}
              />
              {attachments.drafts.length > 0 && (
                <div className="pt-2">
                  <ComposerAttachments
                    drafts={attachments.drafts}
                    rejectionFor={rejectionFor}
                    onRemove={attachments.remove}
                  />
                </div>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="flex items-center justify-between pt-3">
        <button
          type="button"
          onClick={() => goTo(step - 1)}
          className={cn(
            "flex h-9 cursor-pointer items-center gap-1 rounded-full px-3 text-[13.5px]/4 font-medium text-muted-foreground transition-[background-color,color,opacity] duration-150 hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.06]",
            step === 0 && "pointer-events-none opacity-0",
          )}
          aria-hidden={step === 0}
          tabIndex={step === 0 ? -1 : 0}
        >
          <IconArrowLeft size={15} stroke={2.5} />
          Back
        </button>
        <SquishButton
          onClick={() => void advance()}
          disabled={!canAdvance || submitting}
          className="h-9 rounded-full px-4 py-0 text-[13.5px]/4 disabled:cursor-default disabled:opacity-40"
        >
          {submitting ? "Sending…" : lastStep ? "Done" : "Next"}
          {!submitting && lastStep && <IconCheck size={15} stroke={2.5} />}
        </SquishButton>
      </div>
    </div>
  );
}

/** One selectable row: a radio dot or checkbox, the label, an optional
 * clarifying line, and (for "Something else…") an inline text input. */
function ChoiceRow({
  type,
  label,
  description,
  selected,
  onClick,
  children,
}: {
  type: "single" | "multi";
  label: string;
  description?: string;
  selected: boolean;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      role={type === "single" ? "radio" : "checkbox"}
      aria-checked={selected}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "flex w-full cursor-pointer items-start gap-2.5 rounded-xl px-3 py-2 text-left transition-[background-color] duration-150",
        /* Selection is a quiet tint — the primary ink lives in the radio
           dot / checkbox, never a full-row fill. */
        selected
          ? "bg-[color-mix(in_oklch,var(--well),var(--foreground)_7%)]"
          : "hover:bg-[color-mix(in_oklch,var(--well),var(--foreground)_4%)]",
      )}
    >
      {type === "single" ? (
        <span
          aria-hidden
          className={cn(
            "mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border transition-[border-color] duration-150",
            selected ? "border-primary" : "border-border",
          )}
        >
          {selected && <span className="size-2 rounded-full bg-primary" />}
        </span>
      ) : (
        <span
          aria-hidden
          className={cn(
            "mt-1 flex size-4 shrink-0 items-center justify-center rounded-[5px] border transition-[background-color,border-color] duration-150",
            selected ? "border-primary bg-primary" : "border-border",
          )}
        >
          {selected && (
            <IconCheck
              size={12}
              stroke={3.5}
              className="text-primary-foreground"
            />
          )}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">
          {label}
        </span>
        {description && (
          <span className="mt-0.5 block text-[12.5px]/4 text-muted-foreground">
            {description}
          </span>
        )}
        {children}
      </span>
    </div>
  );
}
