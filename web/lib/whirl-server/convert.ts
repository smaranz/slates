import "server-only";

import type { ChatEvent } from "@/lib/agent/types";

/**
 * An agent chat, read as Whirl messages.
 *
 * The agents write an event log: what the student said, text the agent
 * wrote, its thinking, every tool it ran, drafts waiting for approval, files
 * it sent. Whirl draws a conversation as user messages and assistant replies,
 * each reply carrying "phases" — things that happened mid-answer, pinned to
 * the point in the text where they happened (contentOffset). So a reply here
 * is every event one agent produced between two student messages, its text
 * joined into the body and everything else turned into phases.
 */

export interface AgentRef {
  id: string;
  name: string;
  hue: number;
}

export type WirePhase = Record<string, unknown> & { kind: string; contentOffset?: number; pending?: boolean };

export interface WireMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  status: "thinking" | "streaming" | "complete" | "stopped" | "error";
  phases?: WirePhase[];
  attachments?: { id: string; name: string; size: number; type: string; url?: string }[];
  /** Which agent wrote this reply — group chats have several. */
  agent?: AgentRef;
  /** Event ids this message was built from, for rollback and branching. */
  eventIds: string[];
}

/** The reply a student message gets is named after it, so the page can show it before the agent starts. */
export function replyIdFor(userEventId: string): string {
  return `a_${userEventId}`;
}

const IMAGE_TYPE: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

export function toMessages(
  events: ChatEvent[],
  agents: Map<string, AgentRef>,
  busy: "working" | "queued" | undefined,
  answers: Record<string, unknown[]>,
): WireMessage[] {
  const out: WireMessage[] = [];
  let reply: WireMessage | null = null;
  let lastUserId: string | null = null;
  let replyAgent: string | null = null;
  let firstReplyAfterUser = true;
  /** Questions still waiting on the student: answered once anything is said after them. */
  const openQuestions: WirePhase[] = [];

  const startReply = (at: number, agentId: string | null, firstId: string) => {
    const id = firstReplyAfterUser && lastUserId ? replyIdFor(lastUserId) : `a_${firstId}`;
    firstReplyAfterUser = false;
    reply = {
      id,
      role: "assistant",
      content: "",
      createdAt: at,
      status: "complete",
      phases: [],
      eventIds: [],
      ...(agentId && agents.get(agentId) ? { agent: agents.get(agentId) } : {}),
    };
    replyAgent = agentId;
    out.push(reply);
    return reply;
  };

  const replyFor = (event: ChatEvent, agentId: string | null): WireMessage => {
    // A different agent speaking in a group starts its own reply.
    if (!reply || (agentId && replyAgent && agentId !== replyAgent)) return startReply(event.at, agentId, event.id);
    if (agentId && !replyAgent) {
      replyAgent = agentId;
      if (agents.get(agentId)) reply.agent = agents.get(agentId);
    }
    return reply;
  };

  const phase = (message: WireMessage, value: WirePhase) => {
    message.phases!.push({ ...value, contentOffset: message.content.length });
  };

  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    if (event.type === "user") {
      for (const q of openQuestions.splice(0)) q.answered = true;
      out.push({
        id: event.id,
        role: "user",
        content: event.text === "(image)" && event.images?.length ? "" : event.text,
        createdAt: event.at,
        status: "complete",
        eventIds: [event.id],
        ...(event.images?.length
          ? {
              attachments: event.images.map((name) => ({
                id: name,
                name,
                size: 0,
                type: IMAGE_TYPE[name.split(".").pop() ?? ""] ?? "image/png",
                url: `/api/agent/file?name=${encodeURIComponent(name)}`,
              })),
            }
          : {}),
      });
      reply = null;
      replyAgent = null;
      lastUserId = event.id;
      firstReplyAfterUser = true;
      continue;
    }

    const agentId = "agentId" in event ? event.agentId : event.type === "handoff" ? event.from : null;
    const message = replyFor(event, agentId === "tutor" ? null : agentId);
    message.eventIds.push(event.id);

    switch (event.type) {
      case "agent": {
        if (event.text.trim() === "PASS" && !event.streaming) break;
        const gap = message.content && !message.content.endsWith("\n") ? "\n\n" : "";
        message.content += gap + event.text;
        if (event.streaming) message.status = "streaming";
        break;
      }
      case "thinking": {
        const next = events[i + 1];
        phase(message, {
          kind: "thought",
          text: event.text,
          durationMs: next ? Math.max(0, next.at - event.at) : event.streaming ? Date.now() - event.at : 0,
          pending: event.streaming === true,
        });
        break;
      }
      case "tool":
        phase(message, { kind: "agentTool", eventId: event.id, label: event.label, detail: event.detail, status: event.status, pending: event.status === "running" });
        break;
      case "approval":
        phase(message, { kind: "approval", eventId: event.id, approval: event.action, status: event.status, result: event.result });
        break;
      case "voice":
        phase(message, { kind: "voice", file: event.file, transcript: event.transcript });
        break;
      case "file":
        phase(message, { kind: "file", file: event.file, name: event.name, size: event.size, note: event.note });
        break;
      case "learned":
        phase(message, { kind: "learned", learned: event.items });
        break;
      case "handoff":
        phase(message, { kind: "handoff", from: agents.get(event.from)?.name ?? (event.from === "tutor" ? "Tutor" : "Agent"), to: agents.get(event.to)?.name ?? "Agent", text: event.text });
        break;
      case "notice":
        phase(message, { kind: "notice", text: event.text, tone: event.tone ?? "info" });
        break;
      case "question": {
        const q: WirePhase = {
          kind: "question",
          questions: [
            {
              id: event.id,
              prompt: event.question,
              type: event.options.length ? "single" : "text",
              ...(event.options.length ? { options: event.options.map((label) => ({ label })) } : {}),
              allowOther: true,
            },
          ],
          ...(answers[event.id] ? { answers: answers[event.id], answered: true } : {}),
        };
        phase(message, q);
        if (!answers[event.id]) openQuestions.push(q);
        break;
      }
    }
  }

  // The newest reply is still being written while an agent works on this chat.
  if (busy) {
    const last = out[out.length - 1];
    if (!last || last.role === "user") {
      // Nothing from the agent yet: a placeholder under the id the page is expecting.
      out.push({
        id: last ? replyIdFor(last.id) : `a_pending`,
        role: "assistant",
        content: "",
        createdAt: (last?.createdAt ?? Date.now()) + 1,
        status: "thinking",
        phases: [],
        eventIds: [],
      });
    } else if (last.status === "complete") {
      last.status = last.content ? "streaming" : "thinking";
    }
  }
  for (const message of out) if (message.phases && !message.phases.length) delete message.phases;
  return out;
}
