"use client";

import { IconMessageQuestion, IconPaperclip } from "@tabler/icons-react";

import type { MessagePhase } from "@whirl/lib/messages";
import type { QuestionAnswer, QuestionSpec } from "@whirl/lib/questions";

/* The thread's record of an askUserQuestion form: what whirl asked, and —
   once the user hits Done in the composer's form face — what they chose.
   While unanswered the form itself lives in the composer, so this card
   stays a quiet summary rather than a second set of controls. */

export function QuestionCard({ phase }: { phase: MessagePhase }) {
  const questions = phase.questions ?? [];
  if (questions.length === 0) return null;
  const answers = new Map(
    (phase.answers ?? []).map((answer) => [answer.id, answer]),
  );

  return (
    <div className="mb-2 w-full max-w-md rounded-[20px] bg-well px-4 py-3 shadow-[inset_0_0_0_1px_var(--well-outline),inset_0_1px_0_0_var(--well-highlight)]">
      <div className="flex items-center gap-1.5 text-[12.5px]/4 font-medium text-muted-foreground">
        <IconMessageQuestion size={14} stroke={2} />
        {phase.answered ? "Asked you" : "Asking you"}
      </div>
      <div className="mt-2.5 flex flex-col gap-3">
        {questions.map((question) => (
          <div key={question.id}>
            <p className="text-sm font-medium text-foreground">
              {question.prompt}
            </p>
            {phase.answered && (
              <AnswerLine question={question} answer={answers.get(question.id)} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** One question's recorded answer: chosen options as primary-ink chips,
 * free text quoted, attachment names listed — or a muted "Skipped". */
function AnswerLine({
  question,
  answer,
}: {
  question: QuestionSpec;
  answer?: QuestionAnswer;
}) {
  const selected = answer?.selected ?? [];
  const text = answer?.text?.trim();
  const files = answer?.attachments ?? [];
  const empty = selected.length === 0 && !text && files.length === 0;

  if (empty) {
    return (
      <p className="mt-1 text-[12.5px]/4 text-muted-foreground">Skipped</p>
    );
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {selected.map((label) => (
        <span
          key={label}
          className="rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground"
        >
          {label}
        </span>
      ))}
      {text && (
        <span className="text-[13px]/5 text-foreground">
          {selected.length > 0 ? `— ${text}` : `“${text}”`}
        </span>
      )}
      {files.length > 0 && (
        <span className="flex items-center gap-1 text-[12.5px]/4 text-muted-foreground">
          <IconPaperclip size={13} />
          {files.join(", ")}
        </span>
      )}
    </div>
  );
}
