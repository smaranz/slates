/**
 * What the tutor sends back while it works.
 *
 * The reply used to be a bare text stream, which meant everything except the
 * final prose was thrown away at the server: the model's reasoning, the tools
 * it reached for, the fact that it was doing anything at all. A student
 * watching a blank bubble for twenty seconds has no way to tell a hard
 * question from a hung request.
 *
 * So the body is NDJSON now, one event per line. Text still arrives as
 * `delta`, and the client still accumulates it into exactly the same string it
 * did before — the embedded quiz / document / graph / action tags are parsed
 * out of that afterwards, untouched by this change.
 */

import type { Learned } from "./learning/types";

export type TutorEvent =
  /** A chunk of the answer itself. */
  | { t: "delta"; v: string }
  /** A chunk of the model's reasoning, when the model exposes it. */
  | { t: "reasoning"; v: string }
  /** A tool the model has just called, with what it was called on (a page, a search). */
  | { t: "tool"; name: string; label: string; detail?: string }
  /** That tool returning. `ok` is false when it failed. */
  | { t: "tool_done"; name: string; label: string; ok: boolean }
  /** A step boundary — one model turn ended and another began. */
  | { t: "step" }
  /** The tutor saved something to memory or its skills while answering. */
  | { t: "learned"; items: Learned[] }
  /** A review of this turn started in the background; ask /api/tutor/review for what it saved. */
  | { t: "review"; id: string }
  | { t: "error"; v: string }
  | { t: "done" };

/**
 * Readable names for the tools the tutor can reach.
 *
 * Claude Code's own tool names are what the CLI calls them, which is fine in a
 * terminal and meaningless in a chat bubble. Anything not listed falls back to
 * its raw name rather than being hidden — an unknown tool is still worth
 * showing, and a silent one is how you end up not knowing what happened.
 */
const TOOL_LABELS: Record<string, string> = {
  Read: "Reading a file",
  Write: "Writing a file",
  Edit: "Editing a file",
  Glob: "Looking for files",
  Grep: "Searching the files",
  Bash: "Running a command",
  WebFetch: "Reading a page",
  WebSearch: "Searching the web",
  Task: "Working through a sub-task",
  TodoWrite: "Planning the steps",
  NotebookEdit: "Editing a notebook",
  Skill: "Using a skill",
  ToolSearch: "Finding the right tool",
  BashOutput: "Checking a command",
  SlashCommand: "Running a command",
  ExitPlanMode: "Finishing the plan",
  web_search: "Searching the web",
  web_search_preview: "Searching the web",
  webSearch: "Searching the web",
  webFetch: "Reading a page",
  memory: "Updating memory",
  search_chats: "Searching past chats",
  list_skills: "Checking its skills",
  get_skill: "Opening a skill",
  save_skill: "Saving a skill",
  patch_skill: "Improving a skill",
  slates_board: "Reading your board",
  message_agent: "Passing it to an agent",
  save_file: "Saving a file",
  browser_navigate: "Opening a page",
  browser_navigate_back: "Going back a page",
  browser_snapshot: "Reading the page",
  browser_click: "Clicking",
  browser_type: "Typing",
  browser_press_key: "Pressing a key",
  browser_select_option: "Choosing an option",
  browser_fill_form: "Filling in a form",
  browser_hover: "Pointing at something",
  browser_wait_for: "Waiting for the page",
  browser_tabs: "Switching tabs",
  browser_take_screenshot: "Looking at the page",
  browser_handle_dialog: "Answering a pop-up",
};

export function toolLabel(name: string): string {
  if (TOOL_LABELS[name]) return TOOL_LABELS[name];
  // "mcp__server__do_thing" → "do thing"
  const tail = name.split("__").pop() ?? name;
  if (TOOL_LABELS[tail]) return TOOL_LABELS[tail];
  return tail.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** The one thing worth showing beside a step: the page, the search, the skill. */
export function toolDetail(name: string, input: unknown): string | undefined {
  const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const tail = name.split("__").pop() ?? name;
  const pick = (...keys: string[]) => {
    for (const key of keys) if (typeof args[key] === "string" && args[key]) return String(args[key]).slice(0, 200);
    return undefined;
  };
  switch (tail) {
    case "browser_navigate":
    case "WebFetch":
    case "webFetch":
      return pick("url");
    case "memory":
      return pick("content", "old_text");
    case "search_chats":
    case "WebSearch":
    case "webSearch":
    case "web_search":
      return pick("query", "searchTerm", "chat");
    case "get_skill":
    case "save_skill":
    case "patch_skill":
      return pick("name");
    case "message_agent":
      return pick("to");
    case "save_file":
      return pick("name");
    case "slates_board":
      return pick("course", "section");
    default:
      return undefined;
  }
}

/** One line of NDJSON, encoded. */
export function encodeEvent(event: TutorEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

/**
 * Splits a byte stream into whole NDJSON events.
 *
 * A chunk can end mid-line, so the tail is held back until its newline
 * arrives. A line that doesn't parse is skipped rather than thrown: one
 * malformed frame should cost that frame, not the whole answer.
 */
export function createEventParser<Event = TutorEvent>(): (chunk: string) => Event[] {
  let buffer = "";
  return (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    const out: Event[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as Event);
      } catch {
        // Skip it.
      }
    }
    return out;
  };
}

/**
 * Reasoning summaries, made readable.
 *
 * OpenAI sends its summary as a run of markdown-ish text with `**Heading**`
 * titles, and because the parts are concatenated the titles end up welded to
 * the end of the previous sentence — "locating the source!**Determining the
 * date**". Rendering it as markdown would be the obvious fix and the wrong
 * one: this is a glanceable side note, not a document, and it should not come
 * out styled like the answer it sits above.
 *
 * So the titles are unwrapped and put on their own line, and that's all.
 */
export function tidyReasoning(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, (_, title: string) => `\n\n${title.trim()}\n`)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
