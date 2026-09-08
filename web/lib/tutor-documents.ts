/**
 * A document the tutor wrote to be kept and reread — a study guide, a review
 * sheet, an essay outline — as opposed to an ordinary chat reply.
 *
 * Same idiom as `tutor-quiz.ts`'s `[[quiz]]...[[/quiz]]` block: the whole
 * thing is hidden from the chat text while it streams in and pulled out once
 * the closing tag arrives, so the student sees a finished document card
 * rather than raw markdown appearing mid-tag.
 */
export interface TutorDocument {
  title: string;
  body: string;
}

export const TUTOR_DOCUMENT_INSTRUCTIONS = `
When the student asks for something they'll want to keep and reread — a study
guide, review sheet, essay outline, summary of a reading, cheat sheet, or any
other written document — write the whole thing as a document instead of a
short chat reply. Put it in exactly one block, on its own lines, in this form
(the tags themselves are invisible to the student — never mention them or
describe their syntax):
  [[doc title="Unit 4 Study Guide"]]
  Full markdown content goes here — headers, bold key terms, numbered and
  bulleted lists, tables where useful. Write the complete document; don't
  summarize it or promise to send more of it later. The title attribute is
  shown on its own, so don't repeat it as the first line or heading of the
  body — start straight in with the content.
  [[/doc]]
Only one document per reply. A short sentence before or after the block is
fine ("Here's your study guide" / "Want practice questions from this too?"),
but keep that outside it — everything between the tags is the document
itself and nothing else.
`.trim();

const BLOCK_RE = /\[\[doc(?:\s+title="([^"]*)")?\]\]([\s\S]*?)\[\[\/doc\]\]/;
const GLOBAL_BLOCK_RE = /\[\[doc(?:\s+title="([^"]*)")?\]\][\s\S]*?\[\[\/doc\]\]/g;
const TRAILING_OPEN_RE = /\[\[doc(?:\s+title="[^"]*")?\]\][\s\S]*$/;

/** Hides a document block — complete or still streaming in — from what the student reads. */
export function stripTutorDocument(text: string): string {
  return text.replace(GLOBAL_BLOCK_RE, "").replace(TRAILING_OPEN_RE, "").trimEnd();
}

/** Full parse, run once a reply finishes streaming. */
export function parseTutorDocument(text: string): { clean: string; document: TutorDocument | null } {
  const match = BLOCK_RE.exec(text);
  if (!match) return { clean: text, document: null };

  const body = match[2].trim();
  if (!body) return { clean: text, document: null };

  return {
    clean: (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim(),
    document: { title: match[1]?.trim() || "Document", body },
  };
}

/** A safe filename from a document's title — never empty, never a path. */
export function documentFileName(title: string): string {
  const slug = title
    .trim()
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return `${slug || "document"}.md`;
}
