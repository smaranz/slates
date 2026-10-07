"use client";

import { useState } from "react";
import {
  IconAlertTriangle,
  IconArrowForwardUp,
  IconBulbFilled,
  IconDownload,
  IconFileFilled,
  IconInfoCircle,
  IconMailFilled,
  IconMicrophoneFilled,
} from "@tabler/icons-react";

import { Button } from "@whirl/components/ui/button";
import { formatSize } from "@whirl/lib/attachments";
import type { MessagePhase } from "@whirl/lib/messages";
import { showToast } from "@whirl/lib/toasts";
import { cn } from "@whirl/lib/utils";
import { useView } from "@whirl/lib/view";

/* The agent layer's cards inside a reply: what an agent did that the
   student should see or act on, beyond its words. Same quiet card language
   as Whirl's own artifact cards — a bordered well, an icon, a line or two. */

const CARD = "my-2 flex flex-col gap-2 rounded-xl border border-border bg-card px-3.5 py-3 text-[13.5px]/5";

function Head({ icon, title, sub }: { icon: React.ReactNode; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground-soft">{icon}</span>
      <div className="min-w-0">
        <div className="truncate font-medium">{title}</div>
        {sub && <div className="truncate text-xs text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}

/** A draft message or reply an agent wrote — nothing is sent until the student says so. */
function ApprovalCard({ phase }: { phase: MessagePhase }) {
  const { threadId } = useView();
  const [busy, setBusy] = useState(false);
  const action = phase.approval;
  if (!action) return null;
  const status = phase.status;
  const to = action.kind === "message" ? action.recipients.map((r) => r.name).join(", ") : "the conversation";

  const decide = async (decision: "send" | "discard") => {
    if (!threadId || !phase.eventId) return;
    setBusy(true);
    try {
      const response = await fetch("/api/agent/approval", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatId: threadId, eventId: phase.eventId, decision }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok && data.error) throw new Error(data.error);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "That didn't go through.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={CARD}>
      <Head
        icon={<IconMailFilled size={15} />}
        title={action.kind === "message" ? (action.subject || "Schoology message") : "Reply on Schoology"}
        sub={`Draft to ${to}`}
      />
      <div className="max-h-48 overflow-y-auto rounded-lg bg-well px-3 py-2 text-[13px]/5 whitespace-pre-wrap text-foreground-soft">{action.body}</div>
      {status === "pending" || status === "failed" ? (
        <div className="flex items-center gap-2">
          {status === "failed" && <span className="flex-1 truncate text-xs text-destructive">{phase.result ?? "Sending failed."}</span>}
          <span className="flex-1" />
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void decide("discard")}>
            Discard
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void decide("send")}>
            {status === "failed" ? "Try again" : "Send"}
          </Button>
        </div>
      ) : (
        <div className={cn("text-xs", status === "sent" ? "text-muted-foreground" : "text-muted-foreground/80")}>
          {status === "sending" ? "Sending…" : status === "sent" ? "Sent." : status === "denied" ? "Discarded." : ""}
        </div>
      )}
    </div>
  );
}

function FileCard({ phase }: { phase: MessagePhase }) {
  if (!phase.file) return null;
  const url = `/api/agent/outbox?id=${encodeURIComponent(phase.file)}`;
  return (
    <div className={cn(CARD, "flex-row items-center")}>
      <div className="min-w-0 flex-1">
        <Head icon={<IconFileFilled size={15} />} title={phase.name ?? "File"} sub={[phase.size ? formatSize(phase.size) : null, phase.note].filter(Boolean).join(" · ") || "Sent to your devices"} />
      </div>
      <Button size="sm" variant="secondary" render={<a href={`${url}&download=1`} download />}>
        <IconDownload size={14} />
        Download
      </Button>
    </div>
  );
}

function VoiceCard({ phase }: { phase: MessagePhase }) {
  if (!phase.file) return null;
  return (
    <div className={CARD}>
      <Head icon={<IconMicrophoneFilled size={15} />} title="Voice memo" sub={phase.transcript?.slice(0, 120)} />
      <audio controls preload="none" src={`/api/agent/file?name=${encodeURIComponent(phase.file)}`} className="h-9 w-full" />
    </div>
  );
}

function HandoffRow({ phase }: { phase: MessagePhase }) {
  return (
    <div className="my-1.5 flex items-start gap-2 text-[13px]/5 text-muted-foreground">
      <IconArrowForwardUp size={15} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <span className="font-medium text-foreground-soft">
          {phase.from} → {phase.to}
        </span>
        {phase.text && <div className="line-clamp-3 whitespace-pre-wrap">{phase.text}</div>}
      </div>
    </div>
  );
}

function NoticeRow({ phase }: { phase: MessagePhase }) {
  const error = phase.tone === "error";
  return (
    <div
      className={cn(
        "my-1.5 flex items-start gap-2 rounded-lg px-3 py-2 text-[13px]/5",
        error ? "bg-(--destructive-soft) text-destructive shadow-[inset_0_0_0_1px_var(--destructive-outline)]" : "bg-muted/60 text-muted-foreground",
      )}
    >
      {error ? <IconAlertTriangle size={15} className="mt-0.5 shrink-0" /> : <IconInfoCircle size={15} className="mt-0.5 shrink-0" />}
      <span className="min-w-0">{phase.text}</span>
    </div>
  );
}

function LearnedRow({ phase }: { phase: MessagePhase }) {
  const items = phase.learned ?? [];
  if (!items.length) return null;
  return (
    <div className="my-1.5 flex items-start gap-2 text-[13px]/5 text-muted-foreground">
      <IconBulbFilled size={15} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        {items.map((item, i) => (
          <div key={i} className="truncate">
            {item.kind === "skill"
              ? `${item.action === "created" ? "Learned a skill" : "Improved a skill"}: ${item.text}`
              : item.action === "removed"
                ? `Forgot: ${item.text}`
                : `${item.book === "student" ? "Remembered" : "Noted"}: ${item.text}`}
          </div>
        ))}
      </div>
    </div>
  );
}

export const AGENT_CARD_KINDS = new Set(["approval", "file", "voice", "handoff", "notice", "learned"]);

export function AgentPhaseCard({ phase }: { phase: MessagePhase }) {
  switch (phase.kind) {
    case "approval":
      return <ApprovalCard phase={phase} />;
    case "file":
      return <FileCard phase={phase} />;
    case "voice":
      return <VoiceCard phase={phase} />;
    case "handoff":
      return <HandoffRow phase={phase} />;
    case "notice":
      return <NoticeRow phase={phase} />;
    case "learned":
      return <LearnedRow phase={phase} />;
    default:
      return null;
  }
}
