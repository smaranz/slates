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

export type TutorEvent =
  /** A chunk of the answer itself. */
  | { t: "delta"; v: string }
  /** A chunk of the model's reasoning, when the model exposes it. */
  | { t: "reasoning"; v: string }
  /** A tool the model has just called. */
  | { t: "tool"; name: string; label: string }
  /** That tool returning. `ok` is false when it failed. */
  | { t: "tool_done"; name: string; label: string; ok: boolean }
  /** A step boundary — one model turn ended and another began. */
  | { t: "step" }
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
};

export function toolLabel(name: string): string {
  if (TOOL_LABELS[name]) return TOOL_LABELS[name];
  // "mcp__server__do_thing" → "do thing"
  const tail = name.split("__").pop() ?? name;
  return tail.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
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
