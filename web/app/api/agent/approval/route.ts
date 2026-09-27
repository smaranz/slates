import { addNote, post } from "@/lib/agent/engine";
import { getEvent } from "@/lib/agent/store";
import { sendApproved } from "@/lib/agent/tools";
import { isChatId, type ChatEvent } from "@/lib/agent/types";

/** The student's answer to a draft card: send it (optionally edited) or discard it. */

export const dynamic = "force-dynamic";

type Approval = Extract<ChatEvent, { type: "approval" }>;

function describe(event: Approval): string {
  return event.action.kind === "message"
    ? `message to ${event.action.recipients.map((r) => r.name).join(", ")} ("${event.action.subject}")`
    : `reply in thread ${event.action.threadId}${event.action.subject ? ` ("${event.action.subject}")` : ""}`;
}

export async function POST(request: Request) {
  let body: { chatId?: string; eventId?: string; decision?: string; subject?: string; body?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const chatId = body.chatId ?? "";
  const found = isChatId(chatId) ? getEvent(chatId, body.eventId ?? "") : undefined;
  if (!found || found.type !== "approval") return Response.json({ error: "That draft doesn't exist." }, { status: 404 });
  if (found.status !== "pending" && found.status !== "failed") return Response.json({ error: "That draft was already handled." }, { status: 409 });

  if (body.decision === "discard") {
    const next: Approval = { ...found, status: "denied" };
    post(chatId, next);
    addNote(found.agentId, `The student discarded your draft ${describe(found)}.`);
    return Response.json({ event: next });
  }
  if (body.decision !== "send") return Response.json({ error: "Choose send or discard." }, { status: 400 });

  const text = typeof body.body === "string" && body.body.trim() ? body.body.trim().slice(0, 20_000) : found.action.body;
  const action: Approval["action"] = found.action.kind === "message"
    ? { ...found.action, body: text, subject: typeof body.subject === "string" && body.subject.trim() ? body.subject.trim().slice(0, 300) : found.action.subject }
    : { ...found.action, body: text };
  const sending: Approval = { ...found, action, status: "sending", result: undefined };
  post(chatId, sending);
  try {
    const result = await sendApproved(action);
    const sent: Approval = { ...sending, status: "sent", result };
    post(chatId, sent);
    addNote(found.agentId, `The student approved and sent your draft ${describe(sent)}.`);
    return Response.json({ event: sent });
  } catch (error) {
    const failed: Approval = { ...sending, status: "failed", result: error instanceof Error ? error.message : String(error) };
    post(chatId, failed);
    return Response.json({ event: failed }, { status: 502 });
  }
}
