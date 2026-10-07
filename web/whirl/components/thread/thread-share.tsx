"use client";

import { useState } from "react";
import {
  IconArrowUpRight,
  IconCircleCheckFilled,
  IconCopy,
  IconLink,
  IconLoader2,
  IconMarkdown,
  IconShare2,
  IconWorld,
} from "@tabler/icons-react";
import type { Id } from "@whirl/backend/convex/_generated/dataModel";

import { ConfirmDialog } from "@whirl/components/confirm-dialog";
import { TranscriptHandoffDialog } from "@whirl/components/share/transcript-handoff-dialog";
import { Button } from "@whirl/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@whirl/components/ui/popover";
import { threadSharePath, threadShareUrl } from "@whirl/lib/share";
import { useThreadActions, useThreads } from "@whirl/lib/threads";
import { runMutation as run, showToast } from "@whirl/lib/toasts";
import { TOOLBAR_PILL_CLASS } from "./toolbar-pill";

/* The thread share control: one pill that reads "Share" until a public
   link exists, then "Shared". The popover holds both faces — an explainer
   with a create button, and the manage view (link, copy, open, revoke).
   Revoking confirms first; the link dies immediately and re-sharing mints
   a fresh token.

   The freshly-minted token rides in local state until the thread list
   query echoes it back, so the manage view never flickers empty. Keyed by
   threadId in the toolbar — a thread hop resets the bridge. */

const COPY_FLASH_MS = 1600;

export function ThreadShare({ threadId }: { threadId: string }) {
  /* Shares the sidebar's thread-list subscription. */
  const threads = useThreads(true);
  const thread = threads?.find((entry) => entry.id === threadId);
  const { share, unshare } = useThreadActions();

  const [localShareId, setLocalShareId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmingStop, setConfirmingStop] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  const shareId = thread?.shareId ?? localShareId;
  const shared = shareId !== null && shareId !== undefined;

  const createLink = async () => {
    setCreating(true);
    try {
      const result = await share(threadId as Id<"threads">);
      setLocalShareId(result.shareId);
    } catch {
      showToast("Couldn't create a share link. Try again?");
    } finally {
      setCreating(false);
    }
  };

  const copyLink = (id: string) => {
    navigator.clipboard
      .writeText(threadShareUrl(id))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), COPY_FLASH_MS);
      })
      .catch(() => {
        /* Clipboard may be blocked (insecure context); the visible URL is
           still there to select by hand. */
      });
  };

  const stopSharing = () => {
    setLocalShareId(null);
    run(unshare(threadId as Id<"threads">));
    showToast("Sharing stopped. That link won't work anymore.");
  };

  return (
    <>
      <Popover>
        <PopoverTrigger
          aria-label={shared ? "Manage the share link" : "Share this conversation"}
          className={TOOLBAR_PILL_CLASS}
        >
          {shared ? (
            <IconLink size={15} stroke={2} />
          ) : (
            <IconShare2 size={15} stroke={2} />
          )}
          {shared ? "Shared" : "Share"}
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={6}
          className="w-[min(20rem,calc(100vw-1.5rem))] p-3"
        >
          {shared ? (
            <div className="flex flex-col">
              <div className="flex items-start gap-2.5">
                <IconWorld
                  size={17}
                  className="mt-0.5 shrink-0 text-muted-foreground"
                />
                <div className="min-w-0">
                  <div className="text-[13.5px]/5 font-medium">
                    Anyone with the link can view
                  </div>
                  <div className="mt-0.5 text-[12.5px]/4.5 text-muted-foreground">
                    A live, read-only copy of this conversation — documents
                    and visualizations included.
                  </div>
                </div>
              </div>
              <div className="mt-3 flex h-9 items-center gap-1 rounded-lg bg-well pr-1 pl-2.5 shadow-[inset_0_0_0_1px_var(--well-outline),inset_0_1px_0_0_var(--well-highlight)]">
                <span className="min-w-0 flex-1 truncate text-[12.5px]/4 text-muted-foreground select-all">
                  {threadShareUrl(shareId).replace(/^https?:\/\//, "")}
                </span>
                <button
                  type="button"
                  aria-label="Copy share link"
                  title={copied ? "Copied" : "Copy link"}
                  onClick={() => copyLink(shareId)}
                  className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.06]"
                >
                  {copied ? (
                    <IconCircleCheckFilled
                      size={15}
                      className="text-emerald-500"
                    />
                  ) : (
                    <IconCopy size={15} stroke={2} />
                  )}
                </button>
              </div>
              <div className="mt-2.5 flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    nativeButton={false}
                    render={
                      <a
                        href={threadSharePath(shareId)}
                        target="_blank"
                        rel="noopener noreferrer"
                      />
                    }
                  >
                    Open
                    <IconArrowUpRight size={14} stroke={2} />
                  </Button>
                  {/* Hand-off commands + the raw markdown link — for
                      resuming elsewhere, not for reading. */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setTranscriptOpen(true)}
                  >
                    <IconMarkdown size={14} stroke={2} />
                    Transcript
                  </Button>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setConfirmingStop(true)}
                >
                  Stop sharing
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col">
              <div className="text-[13.5px]/5 font-medium">
                Share this conversation
              </div>
              <p className="mt-1 text-[12.5px]/4.5 text-muted-foreground">
                Creates a public link to a live, read-only view — messages,
                documents, and visualizations. Thinking, sources, and
                attachments stay private.
              </p>
              <Button
                className="mt-3 w-full"
                disabled={creating}
                onClick={createLink}
              >
                {creating ? (
                  <IconLoader2 size={15} className="animate-spin" />
                ) : (
                  <IconLink size={15} stroke={2} />
                )}
                Create link
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {typeof shareId === "string" && (
        <TranscriptHandoffDialog
          shareId={shareId}
          open={transcriptOpen}
          onOpenChange={setTranscriptOpen}
        />
      )}

      <ConfirmDialog
        open={confirmingStop}
        onOpenChange={setConfirmingStop}
        title="Stop sharing this conversation?"
        message="The link stops working right away for everyone who has it. Sharing again later creates a brand-new link."
        confirmLabel="Stop sharing"
        destructive
        onConfirm={stopSharing}
      />
    </>
  );
}
