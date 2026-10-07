import {
  IconBrowser,
  IconChartBubble,
  IconFile,
  IconFileCode,
  IconFilePencil,
  IconLayoutDashboard,
  IconWand,
  type Icon,
} from "@tabler/icons-react";

import type { LiveDocument, LiveHtmlArtifact } from "@whirl/lib/live-artifacts";
import type { MessagePhase } from "@whirl/lib/messages";

/**
 * The one lifecycle every artifact chat card moves through, so documents,
 * inline visualizations and full pages all agree on what "still working"
 * means — including the stretch where the message phase has finalized but
 * the live row is still streaming or the background builder is still
 * generating.
 */
export type ArtifactCardState = "working" | "complete" | "failed" | "hidden";

/* The message phase is the document card's source of truth: the row can
   briefly flip complete before the tool result finalizes the phase, and
   late deltas can still settle behind it. `messageTerminal` is the
   backstop for a phase stranded pending by a crashed turn — once the
   message settles nothing more is coming, so the card settles too. */
export function deriveDocumentCardState(
  phase: MessagePhase,
  messageTerminal = false,
): ArtifactCardState {
  if (phase.pending) {
    if (messageTerminal) return phase.documentId ? "complete" : "hidden";
    return "working";
  }
  /* Failures never surface in the chat: a fully-missed edit drops its
     pending card server-side, and a stale failed phase renders nothing. */
  if (phase.ok === false || !phase.documentId) return "hidden";
  return "complete";
}

export function deriveHtmlCardState(
  phase: MessagePhase,
  live: LiveHtmlArtifact | null | undefined,
  messageTerminal = false,
): ArtifactCardState {
  const status = live?.status;
  const loadingRow = Boolean(phase.htmlId) && live === undefined;
  if (loadingRow) return "working";
  /* Working while: the phase is in flight and the row hasn't settled, or
     the row itself reports work. Trust the row's status over the slower
     phase flag — EXCEPT once the message has settled: nothing more is
     coming, so a row stranded in a live status (a crashed turn mid-write)
     must not shimmer forever. Show whatever content made it, or nothing. */
  const working =
    (Boolean(phase.pending) && status !== "complete" && status !== "failed") ||
    status === "streaming" ||
    status === "pending" ||
    status === "generating";
  if (working && !messageTerminal) return "working";
  if (status === "failed") {
    /* Only the full-page card surfaces failure; a failed inline viz hides. */
    return (phase.mode ?? live?.kind) === "full" ? "failed" : "hidden";
  }
  if (phase.ok === false || !phase.htmlId) return "hidden";
  /* A locked artifact has no body on purpose (a shared transcript withholds
     one that reads the owner's live data) — it still gets a card, which says
     so, rather than vanishing as if it were never there. */
  if (live?.dataLocked) return "complete";
  if (!live || !live.content) return "hidden";
  return "complete";
}

/* Whimsical rotating labels for working cards. The first entry of each
   pool is the canonical one. */
const DOCUMENT_CREATE_VERBS = [
  "Writing a document",
  "Wrangling paragraphs",
  "Finding the words",
  "Dotting the i's",
  "Inking the pages",
];

const DOCUMENT_EDIT_VERBS = [
  "Updating the document",
  "Polishing the prose",
  "Rearranging sentences",
  "Trimming the margins",
];

const CODE_CREATE_VERBS = [
  "Writing a code file",
  "Warming up the compiler",
  "Naming the variables",
  "Chasing the semicolons",
];

const CODE_EDIT_VERBS = [
  "Updating the code",
  "Refactoring the bits",
  "Taming the diff",
  "Polishing the functions",
];

const VIZ_CREATE_VERBS = [
  "Drawing a visualization",
  "Plotting the points",
  "Mixing the colors",
  "Connecting the dots",
  "Sharpening the crayons",
];

const VIZ_EDIT_VERBS = [
  "Updating the visualization",
  "Nudging the pixels",
  "Tweaking the palette",
  "Redrawing the lines",
];

const PAGE_CREATE_VERBS = [
  "Building the page",
  "Stacking the divs",
  "Pouring the foundation",
  "Painting the pixels",
  "Hanging the header",
];

const PAGE_EDIT_VERBS = [
  "Updating the page",
  "Rearranging the furniture",
  "Repainting the walls",
];

const APP_CREATE_VERBS = [
  "Building something interactive",
  "Wiring up the state",
  "Assembling the components",
  "Teaching it to react",
  "Hooking up the hooks",
];

const APP_EDIT_VERBS = [
  "Updating the app",
  "Rewiring the components",
  "Adjusting the state",
];

/* An edit whose artifact kind hasn't resolved yet (the row is still
   loading) — the pool swaps to the specific one once it's known. */
const EDIT_UNKNOWN_VERBS = [
  "Making edits",
  "Rolling up sleeves",
  "Warming up the tools",
];

export function documentWorkingLook(
  phase: MessagePhase,
  live?: LiveDocument | null,
): {
  icon: Icon;
  verbs: string[];
} {
  const isEdit = (phase.op ?? "create") === "edit";
  if (live?.format === "code") {
    return {
      icon: IconFileCode,
      verbs: isEdit ? CODE_EDIT_VERBS : CODE_CREATE_VERBS,
    };
  }
  return {
    icon: isEdit ? IconFilePencil : IconFile,
    verbs: isEdit ? DOCUMENT_EDIT_VERBS : DOCUMENT_CREATE_VERBS,
  };
}

export function htmlWorkingLook(
  phase: MessagePhase,
  live: LiveHtmlArtifact | null | undefined,
): { icon: Icon; verbs: string[] } {
  const isEdit = (phase.op ?? "create") === "edit";
  const mode = phase.mode ?? live?.kind;
  /* React artifacts get their own pool regardless of mode — "stacking the
     divs" is the wrong picture for something with state. The row resolves a
     beat after the phase does, so this only kicks in once it's known. */
  if (live?.runtime === "react") {
    return isEdit
      ? { icon: IconWand, verbs: APP_EDIT_VERBS }
      : { icon: IconLayoutDashboard, verbs: APP_CREATE_VERBS };
  }
  if (mode === "full") {
    return isEdit
      ? { icon: IconWand, verbs: PAGE_EDIT_VERBS }
      : { icon: IconBrowser, verbs: PAGE_CREATE_VERBS };
  }
  if (mode === "inline") {
    return isEdit
      ? { icon: IconWand, verbs: VIZ_EDIT_VERBS }
      : { icon: IconChartBubble, verbs: VIZ_CREATE_VERBS };
  }
  return { icon: IconWand, verbs: EDIT_UNKNOWN_VERBS };
}
