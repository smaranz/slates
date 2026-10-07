import { jsonEqual } from "./json-equal";
import type { ChatMessage } from "./messages";

/* Convex deserializes a query result fresh on every update, so a phase
   landing on the tail reply hands back brand-new objects for every message
   in the thread — including the fifty that didn't change. Downstream that
   reads as "everything changed": each row re-renders, each one rebuilds its
   render plan, and the cost of a single tool step scales with how long the
   conversation is.

   So reconcile identities once, at the data layer. Messages that are
   structurally identical to the previous snapshot keep their previous
   object reference, which is what makes React.memo and useMemo downstream
   actually bite. Comparing scalars is orders of magnitude cheaper than
   re-rendering the subtrees they feed, and the walk short-circuits on the
   one message that genuinely moved. */
export function reconcileMessageIdentities(
  previous: ChatMessage[] | undefined,
  next: ChatMessage[],
): ChatMessage[] {
  if (!previous || previous.length === 0) return next;

  const byId = new Map(previous.map((message) => [message.id, message]));
  let changed = previous.length !== next.length;
  const reconciled = next.map((message, index) => {
    const before = byId.get(message.id);
    if (before && jsonEqual(before, message)) {
      /* Same content, but possibly a new position — the row can still skip
         its own work, while the array counts as changed. */
      if (previous[index] !== before) changed = true;
      return before;
    }
    changed = true;
    return message;
  });

  /* Nothing moved at all: hand back the very same array, so consumers
     keyed on the list stay put too. */
  return changed ? reconciled : previous;
}
