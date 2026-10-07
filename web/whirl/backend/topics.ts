/* What a Whirl query depends on, named the same way on both sides.

   The server says "these topics changed" after every write and every agent
   event; each live query on the client knows its own topics and refetches
   when one of them is named. Coarse on purpose — a refetch is a local
   round trip, and a missed update is a stale screen. */

export const ALL = "*";

export function threadTopic(threadId: string): string {
  return `thread:${threadId}`;
}

export function topicsFor(name: string, args: unknown): string[] {
  const group = name.split(".")[0] ?? name;
  const a = (args ?? {}) as Record<string, unknown>;
  const threadId = typeof a.threadId === "string" ? a.threadId : null;
  if (threadId && (group === "messages" || group === "messageQueue" || group === "threads")) {
    return [threadTopic(threadId)];
  }
  return [group];
}
