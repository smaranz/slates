"use client";

import { useEffect, useState } from "react";
import { IconDownload, IconFileFilled, IconFolderFilled } from "@tabler/icons-react";

import type { SentFile } from "@/lib/agent/types";
import { ChoiceCapsules } from "@whirl/components/settings/choice-capsules";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@whirl/components/ui/dialog";
import { formatSize } from "@whirl/lib/attachments";
import { formatRelative } from "@whirl/lib/relative-time";

/* Files: what agents sent you (they land in Downloads on the Mac app too),
   and the shared workspace folder on the host where they keep their work. */

type WorkspaceFile = { path: string; name: string; size: number; at: number };

export function AgentFiles({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [tab, setTab] = useState<"sent" | "workspace">("sent");
  const [sent, setSent] = useState<SentFile[] | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceFile[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const url = tab === "sent" ? "/api/agent/outbox?since=0" : "/api/agent/outbox?workspace=1";
    fetch(url, { cache: "no-store" })
      .then((r) => r.json() as Promise<{ files?: unknown[] }>)
      .then((data) => {
        if (!alive) return;
        if (tab === "sent") setSent(((data.files ?? []) as SentFile[]).slice().sort((a, b) => b.at - a.at));
        else setWorkspace((data.files ?? []) as WorkspaceFile[]);
      })
      .catch(() => {
        if (alive) (tab === "sent" ? setSent : setWorkspace)([]);
      });
    return () => {
      alive = false;
    };
  }, [open, tab]);

  const rows =
    tab === "sent"
      ? (sent ?? []).map((f) => ({ key: f.id, name: f.name, sub: [formatSize(f.size), `from ${f.from}`, formatRelative(f.at)].join(" · "), href: `/api/agent/outbox?id=${encodeURIComponent(f.id)}` }))
      : (workspace ?? []).map((f) => ({ key: f.path, name: f.name, sub: [f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "workspace", formatSize(f.size), formatRelative(f.at)].join(" · "), href: `/api/agent/outbox?path=${encodeURIComponent(f.path)}` }));
  const loading = tab === "sent" ? sent === null : workspace === null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80dvh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Files</DialogTitle>
        </DialogHeader>
        <div className="mt-2">
          <ChoiceCapsules
            value={tab}
            onChange={setTab}
            options={[
              { value: "sent", label: "Sent to you", icon: IconFileFilled },
              { value: "workspace", label: "Workspace", icon: IconFolderFilled },
            ]}
          />
        </div>
        <div className="-mx-2 mt-3 min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              {tab === "sent" ? "Nothing yet. When an agent makes you a file, it shows up here." : "The workspace is empty."}
            </p>
          ) : (
            rows.map((row) => (
              <div key={row.key} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-accent/60">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground-soft">
                  <IconFileFilled size={15} />
                </span>
                <a href={row.href} target="_blank" rel="noreferrer" className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{row.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{row.sub}</div>
                </a>
                <a
                  href={`${row.href}&download=1`}
                  download
                  aria-label={`Download ${row.name}`}
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <IconDownload size={15} />
                </a>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
