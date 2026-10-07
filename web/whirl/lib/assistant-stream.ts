"use client";

/* Stream bookkeeping for assistant turns. Generation is server-driven (the
   send/retry mutations schedule it backend-side — W-134), so every tab reads
   the reply through the reactive messages.getStreamBody query; nothing here
   drives a connection anymore, and a turn survives whatever happens to the
   tab that asked for it.

   What remains is the stop contract: the typewriter reports the exact text
   frame it has painted, and stop freezes the message at that frame instead
   of whatever the server has already streamed past it. */

const displayedStreamText = new Map<string, string>();

/** Last text actually painted by the typewriter, not merely received from
 * the subscription. Stop uses this exact snapshot so buffered characters
 * cannot keep appearing after the user clicks the button. */
export function rememberDisplayedAssistantText(streamId: string, text: string) {
  displayedStreamText.set(streamId, text);
}

/** Forget a settled stream's bookkeeping. */
export function clearAssistantStream(streamId: string) {
  displayedStreamText.delete(streamId);
}

/** The exact text on screen for a stream being stopped — empty when the
 * typewriter never painted a frame. */
export function stopAssistantStream(streamId: string): string {
  const displayed = displayedStreamText.get(streamId) ?? "";
  displayedStreamText.delete(streamId);
  return displayed;
}
