"use client";

/* Bridges quote affordances into the composer. The chat face registers an
   insert handler (module-level, mirrors lib/toasts.ts); document selections
   and selected message text can then hand it a formatted quote. */

type QuoteInsertFn = (quote: string) => boolean;

let insertFn: QuoteInsertFn | null = null;

/** The chat face registers (and tears down) its insert handler here. */
export function registerQuoteInsert(fn: QuoteInsertFn | null) {
  insertFn = fn;
}

/** Insert an already-formatted message quote into the mounted composer. */
export function insertComposerQuote(quote: string): boolean {
  return insertFn?.(quote) ?? false;
}

/**
 * Drop a text selection from a whirl-authored document into the composer,
 * naming the source document (and its id) and quoting the selection so the
 * model can target it with editDocument. Returns false when no composer is
 * mounted to receive it.
 */
export function addDocumentSelection({
  documentId,
  title,
  selectedText,
}: {
  documentId: string;
  title: string;
  selectedText: string;
}): boolean {
  const trimmed = selectedText.trim();
  if (!trimmed) return false;
  const quote = [
    `Selection from the document "${title}" (document id: ${documentId}):`,
    "",
    ...trimmed.split("\n").map((line) => `> ${line}`),
    "",
    "",
  ].join("\n");
  return insertComposerQuote(quote);
}
