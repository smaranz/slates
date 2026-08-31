import type { Bucket } from "./types";

const BUCKETS: Bucket[] = ["tonight", "soon", "week"];

export type TutorAction =
  | { kind: "mark_done"; id: string }
  | { kind: "mark_active"; id: string }
  | { kind: "mark_todo"; id: string }
  | { kind: "move_bucket"; id: string; bucket: Bucket }
  | { kind: "toggle_timer"; id: string };

/**
 * Every action the tutor can take on the student's behalf. Deliberately
 * limited to local, reversible state Slates already lets the student edit by
 * hand — never the real Schoology write path (`saveDraft`/`turnIn`), which
 * stays a manual, human-confirmed action. See lib/store.tsx's own safety
 * split between local marks and `sendToSchoology`.
 */
export const TUTOR_ACTION_INSTRUCTIONS = `
You can act on the student's board — but only when they clearly ask for that
specific thing, never speculatively. Put one action per line, on its own
line, in exactly this form (the tag itself is invisible to the student):
  [[do:mark_done id=<assignment id>]]
  [[do:mark_active id=<assignment id>]]
  [[do:mark_todo id=<assignment id>]]
  [[do:move_bucket id=<assignment id> bucket=tonight|soon|week]]
  [[do:toggle_timer id=<assignment id>]]
Assignment ids are given in brackets before each title in your context, e.g.
"[482913] Lab report". These only touch Slates' own local tracker — never a
real Schoology submission, which the student always does by hand.
`.trim();

const TAG_RE = /\[\[do:(\w+)((?:\s+\w+=\S+)*)\]\]/g;
const TRAILING_PARTIAL_RE = /\[\[do:[^\]]*$/;

function parseParams(raw: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const match of raw.matchAll(/(\w+)=(\S+)/g)) {
    params[match[1]] = match[2];
  }
  return params;
}

function toAction(kind: string, params: Record<string, string>): TutorAction | null {
  const id = params.id;
  if (!id) return null;
  switch (kind) {
    case "mark_done":
    case "mark_active":
    case "mark_todo":
      return { kind, id };
    case "toggle_timer":
      return { kind: "toggle_timer", id };
    case "move_bucket":
      return BUCKETS.includes(params.bucket as Bucket)
        ? { kind: "move_bucket", id, bucket: params.bucket as Bucket }
        : null;
    default:
      return null;
  }
}

/** Strips action tags out of streamed text, returning what the student should read. */
export function stripTutorActions(text: string): string {
  return text.replace(TAG_RE, "").replace(TRAILING_PARTIAL_RE, "").trimEnd();
}

/** Full parse, run once a reply finishes streaming. */
export function parseTutorActions(text: string): { clean: string; actions: TutorAction[] } {
  const actions: TutorAction[] = [];
  for (const match of text.matchAll(TAG_RE)) {
    const action = toAction(match[1], parseParams(match[2]));
    if (action) actions.push(action);
  }
  return { clean: stripTutorActions(text), actions };
}

export function describeTutorAction(action: TutorAction, title: string): string {
  switch (action.kind) {
    case "mark_done":
      return `Marked "${title}" done`;
    case "mark_active":
      return `Marked "${title}" in progress`;
    case "mark_todo":
      return `Marked "${title}" not started`;
    case "move_bucket":
      return `Moved "${title}" to ${action.bucket}`;
    case "toggle_timer":
      return `Toggled the timer on "${title}"`;
  }
}
