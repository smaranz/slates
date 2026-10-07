/* The askUserQuestion form's shared shapes — mirrored from the backend's
   questionSpecValidator / questionAnswerValidator (convex/validators.ts).
   The composer morphs into the steps, the thread card replays them, and
   the serializer below turns answers into the follow-up message text. */

export type QuestionOption = {
  label: string;
  description?: string;
};

export type QuestionSpec = {
  id: string;
  prompt: string;
  /** Short topic label for the step chip ("Approach", "Colors"). */
  header?: string;
  type: "single" | "multi" | "text" | "attachment";
  options?: QuestionOption[];
  /** Choice steps grow a "Something else…" free-text row. Defaults on. */
  allowOther?: boolean;
  placeholder?: string;
};

export type QuestionAnswer = {
  id: string;
  /** Chosen option labels (single keeps exactly one). */
  selected?: string[];
  /** Free text — a text step's answer or the "Something else…" row. */
  text?: string;
  /** Names of the files attached for an attachment step. */
  attachments?: string[];
  skipped?: boolean;
};

/** The composer's question payload: `key` identifies the phase instance so
 * a dismissed form stays dismissed until a different question arrives. */
export type ComposerQuestion = {
  key: string;
  questions: QuestionSpec[];
};

type QuestionPhaseLike = {
  kind: string;
  pending?: boolean;
  answered?: boolean;
  questions?: QuestionSpec[];
};

type MessageLike = {
  id: string;
  role: "user" | "assistant";
  status?: string;
  phases?: QuestionPhaseLike[];
};

/** The question the composer should morph into: only the thread's latest
 * message can carry one — the moment anything follows it, the conversation
 * has moved on and the form is moot. */
export function findPendingQuestion(
  messages: MessageLike[] | undefined,
): { messageId: string; questions: QuestionSpec[] } | null {
  const last = messages?.[messages.length - 1];
  if (!last || last.role !== "assistant" || last.status !== "complete") {
    return null;
  }
  for (let i = (last.phases?.length ?? 0) - 1; i >= 0; i -= 1) {
    const phase = last.phases![i];
    if (
      phase.kind === "question" &&
      !phase.pending &&
      !phase.answered &&
      (phase.questions?.length ?? 0) > 0
    ) {
      return { messageId: last.id, questions: phase.questions! };
    }
  }
  return null;
}

/** One question's answer as prose — selections joined, free text appended,
 * attachment steps describing what rode along on the message. */
function answerText(question: QuestionSpec, answer?: QuestionAnswer): string {
  const parts: string[] = [];
  if (answer?.selected?.length) parts.push(answer.selected.join(", "));
  if (answer?.text?.trim()) parts.push(answer.text.trim());
  if (question.type === "attachment") {
    const names = answer?.attachments ?? [];
    parts.push(
      names.length > 0
        ? `(attached: ${names.join(", ")})`
        : "(no files attached)",
    );
  }
  return parts.length > 0 ? parts.join(" — ") : "(skipped)";
}

/** The follow-up message body. A lone question sends its answer bare; a
 * multi-step form sends one labelled line per question. */
export function serializeAnswers(
  questions: QuestionSpec[],
  answers: QuestionAnswer[],
): string {
  const byId = new Map(answers.map((answer) => [answer.id, answer]));
  if (questions.length === 1) {
    return answerText(questions[0], byId.get(questions[0].id));
  }
  return questions
    .map((question) => {
      const label = question.header?.trim() || question.prompt.trim();
      return `${label}: ${answerText(question, byId.get(question.id))}`;
    })
    .join("\n");
}
