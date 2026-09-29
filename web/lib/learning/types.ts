/**
 * What Slates' helpers keep between chats and what they learn in one, in
 * shapes the browser can import too.
 */

export interface MemoryEntry {
  id: string;
  text: string;
  at: number;
  /** Who saved it: an agent's name, "Tutor", or "You". */
  by?: string;
}

/** One change a helper made to what it remembers or knows how to do. */
export interface Learned {
  kind: "memory" | "skill";
  action: "added" | "updated" | "removed" | "created" | "patched";
  /** Memory only: the student profile every helper shares, or the helper's own notes. */
  book?: "student" | "self";
  /** The entry as saved, or the skill's name. */
  text: string;
}

export interface MemoryBookView {
  entries: MemoryEntry[];
  limit: number;
  used: number;
}

/** A line for the chat, in the student's words rather than the tool's. */
export function describeLearned(item: Learned): string {
  if (item.kind === "skill") return `${item.action === "created" ? "Learned a skill" : "Improved a skill"}: ${item.text}`;
  if (item.book === "student") {
    if (item.action === "removed") return `Forgot: ${item.text}`;
    return `${item.action === "updated" ? "Updated what it knows" : "Remembered"}: ${item.text}`;
  }
  if (item.action === "removed") return `Dropped a note: ${item.text}`;
  return `${item.action === "updated" ? "Updated its notes" : "Noted for itself"}: ${item.text}`;
}
